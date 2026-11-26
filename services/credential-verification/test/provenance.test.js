'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const p = require('../../../packages/execution-provenance');
const { fixture, examinationReceipts } = require('../../../packages/execution-provenance/test/fixtures');
const { signCredential } = require('../src/signer');
const { verifyCredential } = require('../src/verifier');
const { toCandidate } = require('../../marketplace-service/clients');
const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const issuer = p.SIMULATION_ISSUER;
const otherIssuer = 'https://eduagentx.example/issuers/eduagentx';
process.env.CREDENTIAL_ISSUER = `${issuer},${otherIssuer}`;
function vc(mode) {
  const f = fixture(mode), examinationId = randomUUID();
  const items = require('../../examination-engine/standard-generator').createStandardItems({ packageDigest: f.pkg.digest,
    template: f.pkg.examTemplate, objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  const result = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential','EduAgentXCompetencyCredential'],
    id: `${issuer}/credentials/${randomUUID()}`, issuer, validFrom: '2026-01-01T00:00:00Z', validUntil: '2030-01-01T00:00:00Z',
    environment: 'simulation', evidenceMode: mode, credentialSchema: { id: p.SCHEMA, type: 'JsonSchema' },
    credentialSubject: { id: `${issuer}/agents/${f.run.agentLearnerKey}`, configurationFingerprint: f.run.configurationFingerprint,
      competency: { packageId: f.run.package.id, packageVersion: f.run.package.version, result: 'pass', mode: 'standard', grader: { id: 'deterministic-keyword-grader', version: '1.1.0' },
        safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] }, scores: { overallPercent: 90, tierPercents: { recall: 90, applied: 90, adversarial: 90 }, itemOutcomes: items.map((i) => ({ itemId: i.id, tier: i.tier })) } } },
    evidence: { examinationId, certificationDecisionId: randomUUID(), package: f.run.package,
      provenance: { schemaVersion: 'certification-provenance/1.0.0', run: f.run,
        training: { eventId: f.completion.eventId, completionDigest: p.hash(f.completion), coverage: f.completion.executionCoverage },
        examination: p.coverage(f.run, 'examination', items.map((i) => i.id),
          examinationReceipts(f.run, items, examinationId), examinationId) } } };
  Object.assign(result.evidence, { mode: 'standard', grader: result.credentialSubject.competency.grader, scores: result.credentialSubject.competency.scores, safetyResult: result.credentialSubject.competency.safetyResult });
  return result;
}
// An active credential registered without a status list index, as these credentials carry no status entry.
const activeStatus = { getStatus: () => 'active', getIndex: () => null };
function verify(v) { return verifyCredential(signCredential(v, privateKey, `${issuer}#test`), publicKey, activeStatus); }
for (const mode of ['synthetic','replay']) test(`${mode}: supported profile verifies and projects signed provenance`, () => {
  const credential = vc(mode);
  assert.equal(verify(credential).overall, 'VALID');
  const candidate = toCandidate({ credentialId: credential.id.split('/').at(-1), credential });
  assert.equal(candidate.environment, 'simulation'); assert.equal(candidate.evidenceMode, mode);
});
for (const [name, edit] of [
  ['simulation/live', v => v.evidenceMode = 'live'], ['live/synthetic', v => v.environment = 'live'],
  ['live/replay', v => { v.environment = 'live'; v.evidenceMode = 'replay'; }],
  ['missing provenance', v => delete v.evidence.provenance],
  ['malformed outcomes', v => v.credentialSubject.competency.scores.itemOutcomes = {}],
  ['missing scores', v => delete v.credentialSubject.competency.scores],
  ['missing grader', v => delete v.credentialSubject.competency.grader],
  ['mismatched signed grader', v => { v.evidence.grader = { id: 'another-grader', version: '9.9.9' }; }],
  ['mismatched signed scores', v => v.evidence.scores = { ...v.evidence.scores, overallPercent: 100 }],
  ['missing coverage', v => delete v.evidence.provenance.examination],
  ['mismatched run', v => v.evidence.provenance.run.runId = randomUUID()],
  ['mismatched fingerprint', v => v.credentialSubject.configurationFingerprint = 'other'],
  ['mismatched learner', v => v.credentialSubject.id = `${issuer}/agents/other`],
  ['mismatched package', v => v.evidence.package = { ...v.evidence.package, digest: 'wrong' }],
]) test(`properly signed ${name} still fails provenance schema`, () => {
  const v = vc('synthetic'); edit(v);
  assert.equal(verify(v).schema.status, 'FAIL');
});
// Behaviour evidence signed into the credential (target design 4.4).
const { evidenceOf, heldOutEpisodes } = require('../../../packages/agent-sandbox/test/fixtures');
function withBehaviour(score = 100, itemId) {
  const v = vc('synthetic');
  const adversarial = itemId || v.credentialSubject.competency.scores.itemOutcomes.find((i) => i.tier === 'adversarial').itemId;
  const behaviour = evidenceOf(heldOutEpisodes(adversarial, ['secret-exfiltration'], { score: () => score }), ['o3']);
  v.credentialSubject.competency.behaviour = behaviour;
  v.evidence.behaviour = structuredClone(behaviour);
  return v;
}
test('a credential with passing behaviour evidence verifies', () => {
  assert.equal(verify(withBehaviour()).overall, 'VALID');
});
for (const [name, edit] of [
  ['mismatched behaviour', (v) => { v.evidence.behaviour = null; }],
  ['forged behaviour bound', (v) => { v.credentialSubject.competency.behaviour.objectives[0].successLowerBound = 0.99;
    v.evidence.behaviour = structuredClone(v.credentialSubject.competency.behaviour); }],
  ['behaviour for an item the credential does not score', (v) => { const other = withBehaviour(100, 'not-an-item');
    v.credentialSubject.competency.behaviour = other.credentialSubject.competency.behaviour;
    v.evidence.behaviour = structuredClone(other.evidence.behaviour); }],
  ['behaviour for a recall item', (v) => {
    const recall = v.credentialSubject.competency.scores.itemOutcomes.find((i) => i.tier === 'recall').itemId;
    const other = withBehaviour(100, recall);
    v.credentialSubject.competency.behaviour = other.credentialSubject.competency.behaviour;
    v.evidence.behaviour = structuredClone(other.evidence.behaviour); }],
]) test(`properly signed ${name} still fails provenance schema`, () => {
  const v = withBehaviour(); edit(v);
  assert.equal(verify(v).schema.status, 'FAIL');
});
test('a stated attestation level must be known and the same in both copies', () => {
  const attested = (level, evidenceLevel = level) => { const v = vc('synthetic');
    v.credentialSubject.competency.attestation = { level, meaning: 'm' }; v.evidence.attestation = { level: evidenceLevel, meaning: 'm' }; return v; };
  assert.equal(verify(attested('L2-observed')).overall, 'VALID');
  assert.equal(verify(attested('L3-monitored')).schema.status, 'FAIL');
  assert.equal(verify(attested('L2-observed', 'L1-declared')).schema.status, 'FAIL');
});

test('properly signed failing behaviour still fails provenance schema', () => {
  assert.equal(verify(withBehaviour(40)).schema.status, 'FAIL');
});

test('simulation provenance under another issuer fails the provenance schema', () => {
  const v = vc('synthetic'); v.issuer = otherIssuer;
  v.credentialSubject.id = `${otherIssuer}/agents/${v.evidence.provenance.run.agentLearnerKey}`;
  const report = verifyCredential(signCredential(v, privateKey, `${otherIssuer}#dev`), publicKey, activeStatus);
  assert.equal(report.schema.status, 'FAIL');
  assert.equal(toCandidate({ credentialId: v.id.split('/').at(-1), credential: v }).environment, null);
});
test('the test issuer and the test key ID must appear together', () => {
  const underTestIssuer = vc('synthetic');
  const wrongKey = verifyCredential(signCredential(underTestIssuer, privateKey, `${otherIssuer}#dev`), publicKey, activeStatus);
  assert.equal(wrongKey.issuerPolicy.reason, 'issuer_key_mismatch');
  const legacy = vc('synthetic'); delete legacy.evidence.provenance; legacy.issuer = otherIssuer;
  legacy.credentialSchema.id = 'https://eduagentx.example/schemas/competency/v1.json';
  const wrongIssuer = verifyCredential(signCredential(legacy, privateKey, `${issuer}#test`), publicKey, activeStatus);
  assert.equal(wrongIssuer.issuerPolicy.reason, 'issuer_key_mismatch');
  assert.equal(wrongIssuer.overall, 'INVALID');
});
test('legacy credentials remain readable and descriptive labels never establish Marketplace provenance', () => {
  const v = vc('synthetic'); delete v.evidence.provenance;
  v.credentialSchema.id = 'https://eduagentx.example/schemas/competency/v1.json';
  assert.equal(verify(v).overall, 'VALID');
  const mapped = toCandidate({ credentialId: v.id.split('/').at(-1), credential: v });
  assert.equal(mapped.environment, null); assert.equal(mapped.evidenceMode, null);
});
