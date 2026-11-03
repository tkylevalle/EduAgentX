'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const p = require('../../../packages/execution-provenance');
const { fixture } = require('../../../packages/execution-provenance/test/fixtures');
const { signCredential } = require('../src/signer');
const { verifyCredential } = require('../src/verifier');
const { toCandidate } = require('../../marketplace-service/clients');
const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const issuer = 'https://eduagentx.example/issuers/provenance-test';
process.env.CREDENTIAL_ISSUER = issuer;
function vc(mode) {
  const f = fixture(mode), examinationId = randomUUID();
  const items = require('../../examination-engine/standard-generator').createStandardItems({ packageDigest: f.pkg.digest,
    template: f.pkg.examTemplate, objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  const result = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential','EduAgentXCompetencyCredential'],
    id: `${issuer}/credentials/${randomUUID()}`, issuer, validFrom: '2026-01-01T00:00:00Z', validUntil: '2030-01-01T00:00:00Z',
    environment: 'simulation', evidenceMode: mode, credentialSchema: { id: p.SCHEMA, type: 'JsonSchema' },
    credentialSubject: { id: `${issuer}/agents/${f.run.agentLearnerKey}`, configurationFingerprint: f.run.configurationFingerprint,
      competency: { packageId: f.run.package.id, packageVersion: f.run.package.version, result: 'pass', mode: 'standard',
        safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] }, scores: { overallPercent: 90, tierPercents: { recall: 90, applied: 90, adversarial: 90 }, itemOutcomes: items.map((i) => ({ itemId: i.id })) } } },
    evidence: { examinationId, certificationDecisionId: randomUUID(), package: f.run.package,
      provenance: { schemaVersion: 'certification-provenance/1.0.0', run: f.run,
        training: { eventId: f.completion.eventId, completionDigest: p.hash(f.completion), coverage: f.completion.executionCoverage },
        examination: p.coverage(f.run, 'examination', items.map((i) => i.id),
          items.map((i) => p.receipt(f.run, 'examination', i, examinationId).executionEvidence), examinationId) } } };
  Object.assign(result.evidence, { mode: 'standard', scores: result.credentialSubject.competency.scores, safetyResult: result.credentialSubject.competency.safetyResult });
  return result;
}
function verify(v) { return verifyCredential(signCredential(v, privateKey, `${issuer}#test`), publicKey, { getStatus: () => 'active' }); }
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
test('legacy credentials remain readable and descriptive labels never establish Marketplace provenance', () => {
  const v = vc('synthetic'); delete v.evidence.provenance;
  v.credentialSchema.id = 'https://eduagentx.example/schemas/competency/v1.json';
  assert.equal(verify(v).overall, 'VALID');
  const mapped = toCandidate({ credentialId: v.id.split('/').at(-1), credential: v });
  assert.equal(mapped.environment, null); assert.equal(mapped.evidenceMode, null);
});
