'use strict';
// A credential exactly as certification-service issues it (VC 2.0 shape,
// EduAgentXCompetencyCredential, https issuer) must verify end to end.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { issueCredential } = require('../../certification-service/evidence');
const { verifyCredential } = require('../src/verifier');
const { statusStore } = require('../src/statusStore');

const ISSUER = 'https://eduagentx.example/issuers/eduagentx';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

const evidence = {
  subjectId: 'synthetic-agent-learner-dev', subjectFingerprint: 'sha256:abc', packageId: 'ai-safety', packageVersion: '1.0.0',
  mode: 'standard', scores: { overallPercent: 91, tierPercents: { recall: 90, applied: 92, adversarial: 90 }, itemOutcomes: [] },
  safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] },
  examinationEvidence: { examinationId: crypto.randomUUID() },
};

function issue(now = () => new Date().toISOString()) {
  return issueCredential(evidence, { privateKey: privateKeyPem, keyId: `${ISSUER}#dev-ed25519-1`, issuer: ISSUER, now });
}

test.beforeEach(() => { process.env.CREDENTIAL_ISSUER = `did:example:eduagentx-dev-2026,${ISSUER}`; });

test('certification-issued credential verifies VALID once registered', () => {
  const issued = issue();
  statusStore.register(issued.credentialId);
  const report = verifyCredential(issued.compactJws, publicKeyPem, statusStore);
  assert.equal(report.overall, 'VALID', JSON.stringify(report.reasonCodes));
  assert.equal(report.credentialPolicy.status, 'PASS');
  assert.equal(report.issuerPolicy.status, 'PASS');
});

test('status registered by UUID is found through the full VC id', () => {
  const issued = issue();
  statusStore.register(issued.credentialId);
  statusStore.suspend(issued.credential.id, 'investigation');
  assert.equal(statusStore.getStatus(issued.credentialId), 'suspended');
  const report = verifyCredential(issued.compactJws, publicKeyPem, statusStore);
  assert.equal(report.overall, 'INVALID');
  assert.ok(report.reasonCodes.includes('SUSPENDED'));
});

test('unregistered certification credential is INDETERMINATE, not VALID', () => {
  const issued = issue();
  const report = verifyCredential(issued.compactJws, publicKeyPem, statusStore);
  assert.equal(report.overall, 'INDETERMINATE');
});

test('validUntil in the past is reported as expired', () => {
  const issued = issue(() => new Date(Date.now() - 400 * 86400000).toISOString());
  statusStore.register(issued.credentialId);
  const report = verifyCredential(issued.compactJws, publicKeyPem, statusStore);
  assert.equal(report.time.status, 'FAIL');
  assert.ok(report.reasonCodes.includes('EXPIRED'));
});

test('a tampered certification credential fails the signature check', () => {
  const issued = issue();
  statusStore.register(issued.credentialId);
  const [header, payload, signature] = issued.compactJws.split('.');
  const edited = JSON.parse(Buffer.from(payload, 'base64url').toString());
  edited.credentialSubject.competency.scores.overallPercent = 100;
  const forged = `${header}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`;
  assert.equal(verifyCredential(forged, publicKeyPem, statusStore).overall, 'INVALID');
});
