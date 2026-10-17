'use strict';

const { createHash, randomUUID, sign } = require('node:crypto');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });

function validatedEvidence(attempt, trustedPackage = null) {
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
      assessment.schemaVersion !== 'examination-assessment/1.0.0' ||
      !Number.isFinite(Date.parse(completedAt)) || assessment.overallPercent < 0 || assessment.overallPercent > 100 ||
      ['recall','applied','adversarial'].some((tier) => !Number.isFinite(assessment.tierPercents[tier]) ||
        assessment.tierPercents[tier] < 0 || assessment.tierPercents[tier] > 100 ||
        assessment.tierPercents[tier] !== tierScores[tier]) || assessment.overallPercent !== recomputedOverall ||
      attempt.result.schemaVersion !== 'examination-result/1.0.0' ||
      Object.keys(attempt.result).sort().join(',') !== 'passed,schemaVersion,valid')
    throw fail('examination_evidence_malformed');
  if (mode === 'standard' && (!template || !text(template.id) || !text(template.version)))
    throw fail('examination_evidence_malformed');
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
  const safetyResult = { passed: true, criticalViolationRuleIds: [], failureReasons: [] };
  const scores = { overallPercent: assessment.overallPercent, tierPercents: assessment.tierPercents,
    itemOutcomes: assessment.itemOutcomes };
  return {
    examinationId: attemptId, subjectId: agentLearnerKey, subjectFingerprint: configurationFingerprint,
    packageId: pkg.id, packageVersion: pkg.version, packageDigest: pkg.digest,
    templateId: templateEvidence.id, templateVersion: templateEvidence.version, templateDigest: templateEvidence.digest,
    rubricId: rubric.id, rubricVersion: rubric.version, rubricDigest: rubric.digest,
    mode, scores, safetyResult,
    examinationEvidence: { examinationId: attemptId, formDigest, result: attempt.result,
      completedAt, sequence: attempt.sequence, package: pkg, mode, template: templateEvidence,
      rubric: { id: rubric.id, version: rubric.version, digest: rubric.digest }, scores, safetyResult,
      ...(assessmentPolicy ? { passingPolicy: { overallPassPercent: assessmentPolicy.overallPassPercent,
        adversarialPassPercent: assessmentPolicy.adversarialPassPercent,
        failOnCriticalViolation: assessmentPolicy.failOnCriticalViolation !== false } } : {}) },
    decidedAt: completedAt,
  };
}

function issueCredential(evidence, { privateKey, keyId, issuer = 'https://eduagentx.example/issuers/eduagentx',
  credentialBase = 'https://eduagentx.example/credentials', now = () => new Date().toISOString(), validityDays = 365 }) {
  if (!privateKey || !text(keyId)) throw fail('signing_not_configured', 503);
  const credentialId = randomUUID();
  const issuedAt = now();
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://eduagentx.example/contexts/competency/v1'],
    id: `${credentialBase}/${credentialId}`,
    type: ['VerifiableCredential', 'EduAgentXCompetencyCredential'],
    issuer,
    validFrom: issuedAt,
    validUntil: new Date(Date.parse(issuedAt) + validityDays * 86400000).toISOString(),
    credentialSubject: { id: `${issuer}/agents/${encodeURIComponent(evidence.subjectId)}`,
      configurationFingerprint: evidence.subjectFingerprint,
      competency: { packageId: evidence.packageId, packageVersion: evidence.packageVersion,
        result: 'pass', mode: evidence.mode, scores: evidence.scores, safetyResult: evidence.safetyResult } },
    credentialSchema: { id: 'https://eduagentx.example/schemas/competency/v1.json', type: 'JsonSchema' },
    evidence: { type: 'EduAgentXAssessmentEvidence', ...evidence.examinationEvidence },
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
