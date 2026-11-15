'use strict';

// Signed W3C Bitstring Status Lists (assurance audit D2): a third party can
// check a credential's revocation or suspension from a signed list, without
// calling this service's status API.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { LIST_BITS, decodeList, encodeList, statusListCredential } = require('../src/status-list');
const { verifyJws } = require('../src/signer');

test('a list sets exactly the bits of the given indices, left-most bit first, in a gzip multibase string', () => {
  const encoded = encodeList([0, 9, LIST_BITS - 1]);
  assert.equal(encoded[0], 'u', 'multibase base64url');
  const bits = decodeList(encoded);
  assert.equal(bits.length, LIST_BITS / 8);
  assert.equal(bits[0], 0b10000000);
  assert.equal(bits[1], 0b01000000);
  assert.equal(bits[bits.length - 1], 0b00000001);
  assert.equal(bits.reduce((count, byte) => count + byte.toString(2).replaceAll('0', '').length, 0), 3);
});

// One running service with a status key and a credential key, shared by the route tests below.
let service = null;
let cleanup = () => {};
test.after(() => cleanup());
async function startService() {
  if (service) return service;
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-list-'));
  const status = generateKeyPairSync('ed25519'), credential = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(dir, 'status.pem'), status.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(dir, 'status-public.pem'), status.publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(path.join(dir, 'credential-public.pem'), credential.publicKey.export({ type: 'spki', format: 'pem' }));
  const env = { STATUS_LIST_PRIVATE_KEY_PATH: path.join(dir, 'status.pem'), STATUS_LIST_PUBLIC_KEY_PATH: path.join(dir, 'status-public.pem'),
    STATUS_LIST_KEY_ID: 'https://issuer.example/i#status-1', STATUS_LIST_BASE_URL: 'https://issuer.example/status-lists',
    STATUS_LIST_ISSUER: 'https://issuer.example/i', CREDENTIAL_ISSUER: 'https://issuer.example/i',
    CREDENTIAL_PUBLIC_KEY_PATH: path.join(dir, 'credential-public.pem'), CREDENTIAL_KEY_ID: 'https://issuer.example/i#key-1',
    CREDENTIAL_INTERNAL_KEY: 'status-list-test-key', CREDENTIAL_STATUS_PATH: '' };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const { app } = require('../src/index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  cleanup = () => { server.close(); fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-key': 'status-list-test-key' }, body: JSON.stringify(body) });
  const { signCredential } = require('../src/signer');
  const sign = (extra, keys, kid) => signCredential({ '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'],
    issuer: 'https://issuer.example/i', validFrom: '2026-11-16T00:00:00.000Z', credentialSubject: { id: 'x' }, ...extra },
  keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), kid);
  const verify = async (jws) => (await fetch(`${base}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jws }) })).json();
  service = { base, post, sign, verify, status, credential };
  return service;
}

test('a revoked credential\'s bit is set in the signed revocation list, which verifies with the published status key', async () => {
  const { base, post, status } = await startService();
  assert.equal((await post('/status/register', { credentialId: 'cred-list-a', statusListIndex: 42 })).status, 201);
  assert.equal((await post('/status/revoke', { credentialId: 'cred-list-a', reason: 'test' })).status, 200);
  const reply = await fetch(`${base}/status-lists/revocation`);
  assert.equal(reply.headers.get('content-type').startsWith('application/vc+jwt'), true);
  const checked = verifyJws(await reply.text(), status.publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(checked.valid, true);
  const bits = decodeList(checked.credential.credentialSubject.encodedList);
  assert.equal(bits[42 >> 3] & (0x80 >> (42 % 8)), 0x80 >> (42 % 8));
  const jwks = await (await fetch(`${base}/.well-known/jwks.json`)).json();
  assert.deepEqual(jwks.keys.filter((key) => key.kid === 'https://issuer.example/i#status-1').map((key) => key.purpose), ['status-list']);
  assert.equal((await fetch(`${base}/status-lists/other`)).status, 404);
});

test('one status list index belongs to one credential', async () => {
  const { post } = await startService();
  assert.equal((await post('/status/register', { credentialId: 'cred-index-a', statusListIndex: 77 })).status, 201);
  assert.equal((await post('/status/register', { credentialId: 'cred-index-b', statusListIndex: 77 })).status, 409);
});

test('a credential signed with the status-list key is invalid', async () => {
  const { sign, verify, status } = await startService();
  const report = await verify(sign({}, status, 'https://issuer.example/i#status-1'));
  assert.deepEqual([report.signature.status, report.overall, report.reasonCodes], ['FAIL', 'INVALID', ['KEY_PURPOSE_MISMATCH']]);
});

test('a credential whose own status entry names another index than it was registered with fails', async () => {
  const { post, sign, verify, credential } = await startService();
  await post('/status/register', { credentialId: 'cred-entry-a', statusListIndex: 51 });
  const report = await verify(sign({ id: 'cred-entry-a', credentialStatus: [{ type: 'BitstringStatusListEntry', statusPurpose: 'revocation',
    statusListIndex: '50' }] }, credential, 'https://issuer.example/i#key-1'));
  assert.equal(report.signature.status, 'PASS');
  assert.ok(report.reasonCodes.includes('STATUS_ENTRY_MISMATCH'), JSON.stringify(report));
});

test('a legacy credential registered without an index and carrying no entry passes the entry check', async () => {
  const { post, sign, verify, credential } = await startService();
  await post('/status/register', { credentialId: 'cred-legacy' });
  const report = await verify(sign({ id: 'cred-legacy' }, credential, 'https://issuer.example/i#key-1'));
  assert.equal(report.reasonCodes.includes('STATUS_ENTRY_MISMATCH'), false, JSON.stringify(report));
  assert.equal(report.revocation.status, 'PASS');
});

test('a status list whose configured issuer is not trusted is not served', async () => {
  const { base } = await startService();
  const saved = process.env.STATUS_LIST_ISSUER;
  process.env.STATUS_LIST_ISSUER = 'https://elsewhere.example/i';
  try {
    assert.equal((await fetch(`${base}/status-lists/revocation`)).status, 503);
  } finally { process.env.STATUS_LIST_ISSUER = saved; }
});

test('an index outside the list is refused', () => {
  assert.throws(() => encodeList([LIST_BITS]), /status list index/);
  assert.throws(() => encodeList([-1]), /status list index/);
});

test('the status list credential names its purpose and list, and verifies with the status key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signed = statusListCredential({ purpose: 'revocation', listUrl: 'https://issuer.example/status-lists/revocation',
    issuer: 'https://issuer.example/i', indices: [3], validFrom: '2026-11-16T00:00:00.000Z',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'https://issuer.example/i#status-1' });
  const checked = verifyJws(signed.compactJws, publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(checked.valid, true, JSON.stringify(checked));
  const vc = signed.credential;
  assert.deepEqual(vc.type, ['VerifiableCredential', 'BitstringStatusListCredential']);
  assert.equal(vc.credentialSubject.type, 'BitstringStatusList');
  assert.equal(vc.credentialSubject.statusPurpose, 'revocation');
  assert.equal(vc.id, 'https://issuer.example/status-lists/revocation');
  assert.equal(decodeList(vc.credentialSubject.encodedList)[0], 0b00010000);
  assert.throws(() => statusListCredential({ purpose: 'other' }), /purpose/);
});
