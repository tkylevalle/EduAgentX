'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { signCredential, verifyJws, PROJECT_TRUST_NOTICE } = require('../src/signer');

// Generate ephemeral test keypair
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const KEY_ID = 'did:example:test#key-1';

const credential = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'CompetencyCredential'],
  id: 'urn:uuid:test-001',
  issuer: 'did:example:eduagentx-dev-2026',
  issuanceDate: new Date().toISOString(),
  credentialSubject: { id: 'agent-001', competency: 'AI Safety' },
};

test('signs and verifies credential successfully', () => {
  const jws = signCredential(credential, privateKeyPem, KEY_ID);
  assert.ok(typeof jws === 'string');
  assert.strictEqual(jws.split('.').length, 3);
  const result = verifyJws(jws, publicKeyPem);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.credential._notice, PROJECT_TRUST_NOTICE);
});

test('tampered payload fails verification', () => {
  const jws = signCredential(credential, privateKeyPem, KEY_ID);
  const parts = jws.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...credential, issuer: 'evil-issuer' })).toString('base64url');
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  const result = verifyJws(tampered, publicKeyPem);
  assert.strictEqual(result.valid, false);
});

test('wrong public key fails verification', () => {
  const jws = signCredential(credential, privateKeyPem, KEY_ID);
  const { publicKey: wrongKey } = crypto.generateKeyPairSync('ed25519');
  const wrongPem = wrongKey.export({ type: 'spki', format: 'pem' });
  const result = verifyJws(jws, wrongPem);
  assert.strictEqual(result.valid, false);
});

test('disallowed algorithm rejected', () => {
  const parts = signCredential(credential, privateKeyPem, KEY_ID).split('.');
  const badHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KEY_ID })).toString('base64url');
  assert.throws(() => verifyJws(`${badHeader}.${parts[1]}.${parts[2]}`, publicKeyPem), /disallowed algorithm/);
});

test('invalid JWS format throws', () => {
  assert.throws(() => verifyJws('not.a.valid.jws.format', publicKeyPem), /invalid JWS format/);
});
