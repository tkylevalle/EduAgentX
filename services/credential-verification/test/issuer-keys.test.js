'use strict';

// The issuer publishes its keys (assurance audit D3): a JWKS with the active
// and retired verification keys, so a third party can check a credential's
// signature without asking this service to verify it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { issuerJwks, publicKeyForKid } = require('../src/issuer-keys');

function keyFile(dir, name) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const file = path.join(dir, `${name}.pem`);
  fs.writeFileSync(file, publicKey.export({ type: 'spki', format: 'pem' }));
  return { file, publicKey, privateKey };
}

function withKeys(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issuer-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const active = keyFile(dir, 'active'), testKey = keyFile(dir, 'test'), retired = keyFile(dir, 'retired');
  const env = { CREDENTIAL_PUBLIC_KEY_PATH: active.file, CREDENTIAL_KEY_ID: 'https://issuer.example/i#key-2',
    CREDENTIAL_TEST_PUBLIC_KEY_PATH: testKey.file, CREDENTIAL_TEST_KEY_ID: 'https://issuer.example/i-test#test-1',
    CREDENTIAL_RETIRED_KEYS: JSON.stringify([{ kid: 'https://issuer.example/i#key-1', path: retired.file, retiredAt: '2026-11-01T00:00:00.000Z' }]) };
  return { env, active, testKey, retired };
}

test('the JWKS lists every configured key with its id and status, and never private material', (t) => {
  const { env, active } = withKeys(t);
  const jwks = issuerJwks(env);
  assert.deepEqual(jwks.keys.map((key) => [key.kid, key.status]), [
    ['https://issuer.example/i#key-2', 'active'], ['https://issuer.example/i-test#test-1', 'active'], ['https://issuer.example/i#key-1', 'retired']]);
  for (const key of jwks.keys) {
    assert.deepEqual([key.kty, key.crv, key.alg, key.use], ['OKP', 'Ed25519', 'EdDSA', 'sig']);
    assert.equal(Object.hasOwn(key, 'd'), false);
  }
  assert.equal(jwks.keys[0].x, active.publicKey.export({ format: 'jwk' }).x);
  assert.equal(jwks.keys[2].retiredAt, '2026-11-01T00:00:00.000Z');
});

test('a key id selects its key, and a retired key verifies only what it signed before retirement', (t) => {
  const { env, retired } = withKeys(t);
  const before = publicKeyForKid('https://issuer.example/i#key-1', '2026-10-01T00:00:00.000Z', env);
  assert.equal(before, fs.readFileSync(retired.file, 'utf8'));
  assert.equal(publicKeyForKid('https://issuer.example/i#key-1', '2026-11-02T00:00:00.000Z', env), null);
  assert.equal(publicKeyForKid('https://issuer.example/i#unknown', '2026-10-01T00:00:00.000Z', env), null);
});

test('verification checks a signature with the published key its kid names, retired keys only before retirement', async (t) => {
  const { env, retired } = withKeys(t);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  const { app } = require('../src/index');
  const { signCredential } = require('../src/signer');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const pem = retired.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const verify = async (validFrom) => {
    const jws = signCredential({ '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'],
      issuer: 'https://issuer.example/i', validFrom, credentialSubject: { id: 'x' } }, pem, 'https://issuer.example/i#key-1');
    const reply = await fetch(`http://127.0.0.1:${server.address().port}/verify`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jws }) });
    return (await reply.json()).signature.status;
  };
  assert.equal(await verify('2026-10-01T00:00:00.000Z'), 'PASS');
  assert.notEqual(await verify('2026-11-05T00:00:00.000Z'), 'PASS');
});

// A verify batch carries up to 500 credentials: the keys are resolved once for
// the request, not once per credential.
test('a verify batch reads each key file once and reports a broken key setup once', async (t) => {
  const { env, retired } = withKeys(t);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  const { app } = require('../src/index');
  const { signCredential } = require('../src/signer');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const pem = retired.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jws = signCredential({ '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'],
    issuer: 'https://issuer.example/i', validFrom: '2026-10-01T00:00:00.000Z', credentialSubject: { id: 'x' } }, pem, 'https://issuer.example/i#key-1');
  const batch = () => fetch(`http://127.0.0.1:${server.address().port}/verify/batch`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jws: Array.from({ length: 5 }, () => jws) }) }).then((reply) => reply.json());
  const reads = t.mock.method(fs, 'readFileSync');
  const passed = await batch();
  assert.deepEqual(passed.results.map((item) => item.report.signature.status), Array(5).fill('PASS'));
  assert.equal(reads.mock.calls.filter((call) => call.arguments[0] === retired.file).length, 1);
  process.env.CREDENTIAL_RETIRED_KEYS = '{not json';
  const logged = t.mock.method(console, 'error', () => {});
  const failed = await batch();
  assert.deepEqual(failed.results.map((item) => item.httpStatus), Array(5).fill(503));
  assert.equal(logged.mock.calls.length, 1);
});

test('two configured keys may not share one kid', (t) => {
  const { env } = withKeys(t);
  assert.throws(() => issuerJwks({ ...env, CREDENTIAL_TEST_KEY_ID: env.CREDENTIAL_KEY_ID }), /share one kid/);
});

test('a missing key file or a malformed retired list is refused, not skipped', (t) => {
  const { env } = withKeys(t);
  assert.throws(() => issuerJwks({ ...env, CREDENTIAL_PUBLIC_KEY_PATH: '/no/such/key.pem' }), /issuer key/);
  assert.throws(() => issuerJwks({ ...env, CREDENTIAL_RETIRED_KEYS: '{not json' }), /CREDENTIAL_RETIRED_KEYS/);
});
