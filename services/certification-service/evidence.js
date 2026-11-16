'use strict';

const execution = require('../../packages/execution-provenance');
const { isPassingBehaviourEvidence } = require('../../packages/agent-sandbox/src/evidence');
const { createHash, randomUUID, sign } = require('node:crypto');
const telemetry = require('../../packages/telemetry');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });

// The credential names the grader behind its score (assurance audit A11), so
// a reader can tell a keyword grader from any later one. The Engine records
// it on every assessment (examination-engine/assessment.js checkAssessment).
function graderOf(assessment) {
  const grader = assessment.grader ? { id: assessment.grader.id, version: assessment.grader.version } : null;
  if (!execution.validGrader(grader)) throw fail('examination_evidence_malformed');
  return grader;
}

// 1.1.0 assessments carry behaviour evidence (target design 4.4); 1.0.0 ones
// were stored before it existed.
const LEGACY_ASSESSMENT_SCHEMA = 'examination-assessment/1.0.0';
const ASSESSMENT_SCHEMAS = Object.freeze([LEGACY_ASSESSMENT_SCHEMA, 'examination-assessment/1.1.0']);

// The behaviour evidence the credential states. A standard 1.1.0 attempt must
// carry passing, self-consistent evidence for its adversarial items; a
// fallback attempt has no behaviour items; a 1.0.0 attempt predates the
// evidence, so its credential states null: behaviour was not measured.
function behaviourOf(assessment, mode) {
  if (assessment.schemaVersion === LEGACY_ASSESSMENT_SCHEMA) return null;
  const behaviour = assessment.behaviour;
  if (mode === 'fallback') {
    if (behaviour !== null) throw fail('examination_evidence_malformed');
    return null;
  }
  const adversarial = new Set(assessment.itemOutcomes.filter((item) => item.tier === 'adversarial').map((item) => item.itemId));
  if (!isPassingBehaviourEvidence(behaviour) ||
    !behaviour.episodes.every((episode) => adversarial.has(episode.itemId))) throw fail('examination_evidence_malformed');
  return structuredClone(behaviour);
}

// Attestation level (target design 4.2, assurance audit D1): what the
// credential's configuration fingerprint rests on. L2: the subject is an
// identity the platform runs itself (CERTIFICATION_PLATFORM_SUBJECTS, the
// live learner), whose model and prompts are fixed in platform code. It rests
// on that identity's secret staying in the platform, and nothing in the
// credential lets a verifier check it. L1: anything else; the fingerprint is
// what the agent declared.
const ATTESTATION_MEANINGS = Object.freeze({
  'L2-observed': 'The subject is an identity the platform runs itself; this rests on that identity\'s secret staying in the platform and cannot be checked from the credential.',
  'L1-declared': 'The agent ran outside the platform; its configuration fingerprint is self-declared and not observed.',
});
/** @param {string} subjectId @param {string[]} platformSubjects the agent identities the platform itself runs @returns {{ level: string, meaning: string }} */
function attestationFor(subjectId, platformSubjects) {
  const level = platformSubjects.includes(subjectId) ? 'L2-observed' : 'L1-declared';
  return { level, meaning: ATTESTATION_MEANINGS[level] };
}
const platformSubjectsFromEnv = () => String(process.env.CERTIFICATION_PLATFORM_SUBJECTS || '').split(',').map((id) => id.trim()).filter(Boolean);

/**
 * The evidence a credential may be issued from, or a thrown 409/503 error.
 * @param {object} attempt the Examination Engine's certification evidence projection
 * @param {object | null} trustedPackage the governing package, or null to skip the package checks
 * @param {string} issuanceEnvironment simulation or live
 * @param {string} issuer the issuer the credential will name
 * @param {string[]} platformSubjects identities the platform runs itself (attestation L2)
 * @returns {object} the validated evidence
 */
function validatedEvidence(attempt, trustedPackage = null, issuanceEnvironment = process.env.CERTIFICATION_ENVIRONMENT, issuer = process.env.CERTIFICATION_ISSUER,
  platformSubjects = platformSubjectsFromEnv()) {
  if (!attempt || attempt.status !== 'complete' || attempt.responseCollectionComplete !== true ||
      attempt.result?.schemaVersion !== 'examination-result/1.0.0' || attempt.result.valid !== true ||
      attempt.result.passed !== true || !attempt.assessment || attempt.assessment.passed !== true)
    throw fail('examination_not_certifiable');
  const { attemptId, agentLearnerKey, configurationFingerprint, package: pkg, mode, template, rubric,
    assessment, completedAt, formDigest, tierWeights } = attempt;
  const validOutcomes = Array.isArray(assessment.itemOutcomes) && assessment.itemOutcomes.length === 15 &&
    new Set(assessment.itemOutcomes.map((item) => item?.itemId)).size === 15 &&
    assessment.itemOutcomes.every((item) => item && Object.keys(item).length === 5 &&
      ['itemId','tier','score','criticalViolationRuleIds','malformed'].every((key) => Object.hasOwn(item, key)) &&
      text(item.itemId) && ['recall','applied','adversarial'].includes(item.tier) &&
      Number.isFinite(item.score) && item.score >= 0 && item.score <= 100 &&
      Array.isArray(item.criticalViolationRuleIds) && item.criticalViolationRuleIds.length === 0 && item.malformed === false);
  const counts = { recall: 5, applied: 6, adversarial: 4 };
  const tierScores = Object.fromEntries(Object.entries(counts).map(([tier, count]) => {
    const tierItems = assessment.itemOutcomes?.filter((item) => item?.tier === tier) || [];
    return [tier, tierItems.length === count ? Math.round(tierItems.reduce((sum, item) => sum + item.score, 0) / count * 100) / 100 : null];
  }));
  const weightsValid = tierWeights && ['recall','applied','adversarial'].every((tier) =>
    Number.isFinite(tierWeights[tier]) && tierWeights[tier] >= 0) &&
    Object.keys(tierWeights).length === 3 &&
    Object.values(tierWeights).reduce((sum, value) => sum + value, 0) === 100;
  const recomputedOverall = weightsValid ? Math.round(Object.entries(tierScores).reduce((sum, [tier, score]) =>
    sum + (score * tierWeights[tier] / 100), 0) * 100) / 100 : null;
  if (!text(attemptId) || !text(agentLearnerKey) || !text(configurationFingerprint) ||
      !pkg || !text(pkg.id) || !text(pkg.version) || !text(pkg.digest) ||
      !['standard', 'fallback'].includes(mode) || !rubric || !text(rubric.id) || !text(rubric.version) ||
      !text(rubric.digest) || !text(completedAt) || !text(formDigest) || !assessment.tierPercents ||
      !Number.isFinite(assessment.overallPercent) || !Array.isArray(assessment.criticalViolationRuleIds) ||
      assessment.criticalViolationRuleIds.length !== 0 || !Array.isArray(assessment.failureReasons) ||
      assessment.failureReasons.length !== 0 || !validOutcomes || !weightsValid ||
      !ASSESSMENT_SCHEMAS.includes(assessment.schemaVersion) ||
      !Number.isFinite(Date.parse(completedAt)) || assessment.overallPercent < 0 || assessment.overallPercent > 100 ||
      ['recall','applied','adversarial'].some((tier) => !Number.isFinite(assessment.tierPercents[tier]) ||
        assessment.tierPercents[tier] < 0 || assessment.tierPercents[tier] > 100 ||
        assessment.tierPercents[tier] !== tierScores[tier]) || assessment.overallPercent !== recomputedOverall ||
      attempt.result.schemaVersion !== 'examination-result/1.0.0' ||
      Object.keys(attempt.result).sort().join(',') !== 'passed,schemaVersion,valid')
    throw fail('examination_evidence_malformed');
  if (mode === 'standard' && (!template || !text(template.id) || !text(template.version)))
    throw fail('examination_evidence_malformed');
  const grader = graderOf(assessment);
  const behaviour = behaviourOf(assessment, mode);
  const attestation = attestationFor(agentLearnerKey, platformSubjects);
  let assessmentPolicy = null;
  if (trustedPackage) {
    assessmentPolicy = mode === 'fallback'
      ? { overallPassPercent: 80, adversarialPassPercent: 70, failOnCriticalViolation: true }
      : trustedPackage.examTemplate || trustedPackage.examination_template || null;
    if (!assessmentPolicy || !Number.isFinite(assessmentPolicy.overallPassPercent) ||
        !Number.isFinite(assessmentPolicy.adversarialPassPercent) ||
        assessment.overallPercent < assessmentPolicy.overallPassPercent ||
        assessment.tierPercents.adversarial < assessmentPolicy.adversarialPassPercent ||
        (assessmentPolicy.failOnCriticalViolation !== false && assessment.criticalViolationRuleIds.length > 0))
      throw fail('examination_evidence_malformed');
  }
  const templateEvidence = mode === 'fallback'
    ? { id: attempt.bank?.id || 'deterministic-fallback', version: attempt.bank?.version || attempt.bankVersion || '1.0.0',
      digest: attempt.bank?.digest, templateFamily: 'deterministic-fallback' }
    : { id: template.id, version: template.version, digest: template.digest };
  if (!text(templateEvidence.digest)) throw fail('examination_evidence_malformed');
  if (attempt.schemaVersion && !['certification-evidence/1.0.0','certification-evidence/1.1.0'].includes(attempt.schemaVersion))
    throw fail('examination_provenance_invalid');
  const hasProvenance = attempt.schemaVersion === 'certification-evidence/1.1.0' || Object.hasOwn(attempt, 'provenanceProfile') || Object.hasOwn(attempt, 'provenance');
  if (hasProvenance && (attempt.provenanceProfile !== execution.RUN ||
    !execution.validSummary(attempt.provenance, { subjectId: agentLearnerKey, fingerprint: configurationFingerprint,
      package: pkg, examinationId: attemptId, itemIds: assessment.itemOutcomes.map((i) => i.itemId) }) || attempt.provenance.run.environment !== issuanceEnvironment || !execution.issuerPermits(issuanceEnvironment, issuer)))
    throw fail('examination_provenance_invalid');
  if (hasProvenance && trustedPackage !== null && (!trustedPackage ||
    (trustedPackage.packageId || trustedPackage.id || trustedPackage.manifest?.packageId) !== pkg.id ||
    (trustedPackage.version || trustedPackage.manifest?.version) !== pkg.version || trustedPackage.digest !== pkg.digest))
    throw fail('examination_provenance_invalid');
  const safetyResult = { passed: true, criticalViolationRuleIds: [], failureReasons: [] };
  const scores = { overallPercent: assessment.overallPercent, tierPercents: assessment.tierPercents,
    itemOutcomes: assessment.itemOutcomes };
  return {
    examinationId: attemptId, subjectId: agentLearnerKey, subjectFingerprint: configurationFingerprint,
    packageId: pkg.id, packageVersion: pkg.version, packageDigest: pkg.digest,
    templateId: templateEvidence.id, templateVersion: templateEvidence.version, templateDigest: templateEvidence.digest,
    rubricId: rubric.id, rubricVersion: rubric.version, rubricDigest: rubric.digest,
    mode, grader, scores, safetyResult, behaviour, attestation,
    ...(hasProvenance ? { provenance: attempt.provenance } : {}),
    examinationEvidence: { examinationId: attemptId, formDigest, result: attempt.result,
      ...(hasProvenance ? { provenanceProfile: execution.RUN, provenance: attempt.provenance } : {}),
      completedAt, sequence: attempt.sequence, package: pkg, mode, template: templateEvidence,
      rubric: { id: rubric.id, version: rubric.version, digest: rubric.digest }, grader, scores, safetyResult, behaviour, attestation,
      ...(assessmentPolicy ? { passingPolicy: { overallPassPercent: assessmentPolicy.overallPassPercent,
        adversarialPassPercent: assessmentPolicy.adversarialPassPercent,
        failOnCriticalViolation: assessmentPolicy.failOnCriticalViolation !== false } } : {}) },
    decidedAt: completedAt,
  };
}

// The credential's entries in the signed status lists (assurance audit D2):
// its bit in the revocation list and in the suspension list.
// Bits in one status list: the W3C minimum, 16 KB (credential-verification status-list.js).
const STATUS_LIST_BITS = 131072;
// Once nine tenths of the list is spent, each issuance logs a warning: about
// 13,000 credentials remain before issuance stops at status_list_full, time
// enough to add a second list.
const STATUS_LIST_WARN_AT = Math.floor(STATUS_LIST_BITS * 0.9);
function statusEntries(statusListBase, statusListIndex) {
  if (!statusListBase) return null;
  if (!Number.isSafeInteger(statusListIndex) || statusListIndex < 0) throw fail('status_list_index_unavailable', 503);
  if (statusListIndex >= STATUS_LIST_BITS) throw fail('status_list_full', 503);
  if (statusListIndex >= STATUS_LIST_WARN_AT)
    telemetry.log('certification-service', 'status_list_near_capacity', { outcome: `index_${statusListIndex}_of_${STATUS_LIST_BITS}` });
  return ['revocation', 'suspension'].map((purpose) => ({ id: `${statusListBase}/${purpose}#${statusListIndex}`,
    type: 'BitstringStatusListEntry', statusPurpose: purpose, statusListIndex: String(statusListIndex),
    statusListCredential: `${statusListBase}/${purpose}` }));
}

function issueCredential(evidence, { privateKey, keyId, issuer = 'https://eduagentx.example/issuers/eduagentx',
  credentialBase = 'https://eduagentx.example/credentials', decisionId, statusListBase = null, statusListIndex = null,
  now = () => new Date().toISOString(), validityDays = 365, environment = process.env.CERTIFICATION_ENVIRONMENT }) {
  if (!privateKey || !text(keyId)) throw fail('signing_not_configured', 503);
  if (evidence.provenance && (!execution.validSummary(evidence.provenance, { subjectId: evidence.subjectId,
    fingerprint: evidence.subjectFingerprint, package: { id: evidence.packageId, version: evidence.packageVersion, digest: evidence.packageDigest }, examinationId: evidence.examinationId, itemIds: evidence.scores.itemOutcomes.map((i) => i.itemId) }) ||
    evidence.provenance.run.environment !== environment || !execution.issuerPermits(environment, issuer))) throw fail('examination_provenance_invalid');
  const credentialId = randomUUID();
  const issuedAt = now();
  const credentialStatus = statusEntries(statusListBase, statusListIndex);
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://eduagentx.example/contexts/competency/v1'],
    id: `${credentialBase}/${credentialId}`,
    type: ['VerifiableCredential', 'EduAgentXCompetencyCredential'],
    issuer,
    ...(evidence.provenance ? { environment: evidence.provenance.run.environment, evidenceMode: evidence.provenance.run.evidenceMode } : {}),
    validFrom: issuedAt,
    validUntil: new Date(Date.parse(issuedAt) + validityDays * 86400000).toISOString(),
    credentialSubject: { id: `${issuer}/agents/${encodeURIComponent(evidence.subjectId)}`,
      configurationFingerprint: evidence.subjectFingerprint,
      competency: { packageId: evidence.packageId, packageVersion: evidence.packageVersion,
        result: 'pass', mode: evidence.mode, grader: evidence.grader, scores: evidence.scores, safetyResult: evidence.safetyResult,
        behaviour: evidence.behaviour ?? null, ...(evidence.attestation ? { attestation: evidence.attestation } : {}) } },
    credentialSchema: { id: evidence.provenance ? execution.SCHEMA : 'https://eduagentx.example/schemas/competency/v1.json', type: 'JsonSchema' },
    ...(credentialStatus ? { credentialStatus } : {}),
    evidence: { type: 'EduAgentXAssessmentEvidence', ...evidence.examinationEvidence,
      ...(decisionId ? { certificationDecisionId: decisionId } : {}) },
    termsOfUse: { type: 'EduAgentXProjectCredentialPolicy',
      id: 'https://eduagentx.example/policies/credential/v1', scope: 'EduAgentX capstone project; no external accreditation implied' },
  };
  const protectedHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: keyId, typ: 'vc+jwt' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(credential)).toString('base64url');
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString('base64url');
  return { credentialId, credential, compactJws: `${signingInput}.${signature}`, keyId, issuedAt };
}

module.exports = { digest, fail, validatedEvidence, issueCredential };
