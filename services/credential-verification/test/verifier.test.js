'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signCredential } = require('../src/signer');
const { verifyCredential } = require('../src/verifier');
const { statusStore } = require('../src/statusStore');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

// Override trusted issuer for tests
process.env.CREDENTIAL_ISSUER = 'did:example:eduagentx-dev-2026';

function makeCredential(overrides = {}) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'CompetencyCredential'],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: 'did:example:eduagentx-dev-2026',
    issuanceDate: new Date().toISOString(),
    credentialSubject: { id: 'agent-001', competency: 'AI Safety' },
    ...overrides,
  };
}

test('valid credential returns VALID overall', () => {
  const cred = makeCredential();
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  statusStore.register(cred.id);
  const report = verifyCredential(jws, publicKeyPem, statusStore);
  assert.strictEqual(report.overall, 'VALID');
  assert.strictEqual(report.signature.status, 'PASS');
  assert.strictEqual(report.issuerPolicy.status, 'PASS');
});

test('tampered credential returns INVALID', () => {
  const cred = makeCredential();
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  const parts = jws.split('.');
  const tampered = `${parts[0]}.${Buffer.from('{"tampered":true}').toString('base64url')}.${parts[2]}`;
  const report = verifyCredential(tampered, publicKeyPem, statusStore);
  assert.strictEqual(report.overall, 'INVALID');
  assert.ok(report.reasonCodes.includes('SIGNATURE_INVALID') || report.reasonCodes.includes('SIGNATURE_ERROR'));
});

test('suspended credential returns INVALID', () => {
  const cred = makeCredential();
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  statusStore.register(cred.id);
  statusStore.suspend(cred.id, 'test suspension');
  const report = verifyCredential(jws, publicKeyPem, statusStore);
  assert.strictEqual(report.suspension.status, 'FAIL');
  assert.ok(report.reasonCodes.includes('SUSPENDED'));
});

test('suspension is reversible', () => {
  const cred = makeCredential();
  statusStore.register(cred.id);
  statusStore.suspend(cred.id, 'temporary');
  statusStore.reinstate(cred.id, 'reinstated');
  assert.strictEqual(statusStore.getStatus(cred.id), 'active');
  assert.strictEqual(statusStore.getHistory(cred.id).length, 3);
});

test('revocation is irreversible', () => {
  const cred = makeCredential();
  statusStore.register(cred.id);
  statusStore.revoke(cred.id, 'misconduct');
  assert.throws(() => statusStore.reinstate(cred.id), /irreversible/);
  assert.strictEqual(statusStore.getStatus(cred.id), 'revoked');
});

test('unknown issuer returns INVALID', () => {
  const cred = makeCredential({ issuer: 'did:example:unknown-issuer' });
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  const report = verifyCredential(jws, publicKeyPem, null);
  assert.ok(report.reasonCodes.includes('UNTRUSTED_ISSUER'));
});

test('missing status store returns INDETERMINATE', () => {
  const cred = makeCredential();
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  const report = verifyCredential(jws, publicKeyPem, null);
  assert.strictEqual(report.suspension.status, 'INDETERMINATE_STATUS');
  assert.strictEqual(report.revocation.status, 'INDETERMINATE_STATUS');
});

test('each check reported separately', () => {
  const cred = makeCredential();
  const jws = signCredential(cred, privateKeyPem, 'did:example:test#key-1');
  const report = verifyCredential(jws, publicKeyPem, null);
  for (const key of ['signature', 'schema', 'time', 'suspension', 'revocation', 'issuerPolicy', 'credentialPolicy']) {
    assert.ok(key in report, `missing check: ${key}`);
    assert.ok('status' in report[key], `${key} missing status`);
  }
});
