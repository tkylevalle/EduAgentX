'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID, generateKeyPairSync, createHash } = require('node:crypto');
const { issueCredential } = require('../../certification-service/evidence');
const { verifyCredential } = require('../../credential-verification/src/verifier');
const { toCandidate, createLifecycleSource, createRegistrySource, askSource } = require('../clients');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ format: 'pem', type: 'spki' });

function fixture({ legacy = false } = {}) {
  const decisionId = randomUUID(), examinationId = randomUUID();
  const pkg = { id: 'ai-safety', version: '1.0.0', digest: 'sha256:package' };
  const issued = issueCredential({ subjectId: 'learner/a b', subjectFingerprint: `sha256:${'a'.repeat(64)}`,
    packageId: pkg.id, packageVersion: pkg.version, mode: 'standard',
    scores: { overallPercent: 90, tierPercents: { adversarial: 90 } },
    examinationEvidence: { examinationId, package: pkg },
  }, { privateKey, keyId: 'test-origin-key', ...(legacy ? {} : { decisionId }) });
  return { issued, candidate: toCandidate(issued), body: { apiVersion: 'v1', origin: {
    schemaVersion: 'certification-origin/1.0.0', outcome: 'certified', credentialId: issued.credentialId,
    decisionId, examinationId, subjectId: 'learner/a b', configurationFingerprint: `sha256:${'a'.repeat(64)}`,
    credentialDigest: `sha256:${createHash('sha256').update(issued.compactJws).digest('hex')}`,
  } } };
}

async function upstream(t, response) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (response === 'hang') return;
    if (response === 'invalid-json') return res.end('not-json');
    res.writeHead(response.status ?? 200, { 'content-type': 'application/json', ...(response.headers || {}) });
    res.end(JSON.stringify(response.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { seen, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function ask(t, candidate, response, config = {}) {
  const remote = await upstream(t, response);
  const source = createLifecycleSource({ baseUrl: remote.baseUrl, internalKey: 'origin-read-key',
    timeoutMs: response === 'hang' ? 80 : 1000, ...config });
  return { remote, answer: await askSource('certification-service', () => source.isLifecycleOrigin(candidate,
    { correlationId: 'origin-correlation' }), { timeoutMs: 1500 }) };
}

test('origin client checks exact signed bindings using only the scoped read endpoint', async (t) => {
  const { candidate, body } = fixture();
  const { remote, answer } = await ask(t, candidate, { body });
  assert.deepEqual(answer, { value: true, outcome: 'answered' });
  assert.equal(remote.seen.length, 1);
  const read = remote.seen[0];
  assert.equal(read.method, 'GET');
  assert.equal(read.url, `/internal/credential-origins/${candidate.credentialId}`);
  assert.equal(read.headers['x-internal-service-key'], 'origin-read-key');
  assert.equal(read.headers['x-actor-subject'], 'marketplace-service');
  assert.equal(read.headers['x-actor-role'], 'marketplace');
  assert.equal(read.headers['x-correlation-id'], 'origin-correlation');
});

for (const [field, value] of [
  ['credentialId', randomUUID()], ['decisionId', randomUUID()], ['examinationId', randomUUID()],
  ['subjectId', 'someone-else'], ['configurationFingerprint', `sha256:${'b'.repeat(64)}`],
  ['credentialDigest', `sha256:${'c'.repeat(64)}`],
]) {
  test(`origin client rejects issuer ${field} mismatch`, async (t) => {
    const { candidate, body } = fixture();
    body.origin[field] = value;
    assert.deepEqual((await ask(t, candidate, { body })).answer, { value: false, outcome: 'answered' });
  });
}

test('origin client rejects unknown credentials and unavailable/unauthorized/malformed authority', async (t) => {
  const { candidate, body } = fixture();
  const cases = [
    [{ status: 404, body: { error: 'origin_not_found' } }, false, 'answered'],
    [{ status: 403, body: {} }, null, 'source_unavailable'],
    [{ status: 503, body: {} }, null, 'source_unavailable'],
    ['hang', null, 'timeout'], ['invalid-json', null, 'contract_violation'],
    [{ body: {} }, null, 'contract_violation'], [{ body: [] }, null, 'contract_violation'],
    [{ body: null }, null, 'contract_violation'], [{ body: false }, null, 'contract_violation'],
    [{ body: { ...body, apiVersion: 'v2' } }, null, 'contract_violation'],
    ...['schemaVersion', 'outcome', 'credentialId', 'decisionId', 'examinationId', 'subjectId',
      'configurationFingerprint', 'credentialDigest'].map((field) => {
      const malformed = structuredClone(body); delete malformed.origin[field];
      return [{ body: malformed }, null, 'contract_violation'];
    }),
    [{ body: { ...body, origin: { ...body.origin, outcome: 'failed' } } }, null, 'contract_violation'],
    [{ body: { ...body, origin: { ...body.origin, decisionId: 'not-an-id' } } }, null, 'contract_violation'],
  ];
  for (const [response, value, outcome] of cases)
    assert.deepEqual((await ask(t, candidate, response)).answer, { value, outcome });
});

test('origin client fails closed on connection refusal and refuses redirects without leaking the read key', async (t) => {
  const { candidate, body } = fixture();
  const target = await upstream(t, { body });
  const redirect = await ask(t, candidate, { status: 302, headers: { location: target.baseUrl }, body: {} });
  assert.equal(redirect.answer.value, null);
  assert.equal(target.seen.length, 0);
  // Scope the new redirect prohibition to origin. Existing authority clients
  // retain their baseline behavior rather than receiving unrelated hardening.
  const registry = await upstream(t, { body: { registration: { agentLearnerKey: candidate.agentLearnerKey,
    status: 'active', configurationFingerprint: candidate.configurationFingerprint } } });
  const registryRedirect = await upstream(t, { status: 302, headers: { location: registry.baseUrl }, body: {} });
  assert.equal(await createRegistrySource({ baseUrl: registryRedirect.baseUrl })
    .getCurrentFingerprint(candidate.agentLearnerKey), candidate.configurationFingerprint);
  assert.equal(registry.seen.length, 1);
  const dead = await upstream(t, { body });
  await new Promise((resolve) => dead.server.close(resolve));
  const source = createLifecycleSource({ baseUrl: dead.baseUrl, internalKey: 'origin-read-key', timeoutMs: 80 });
  assert.deepEqual(await askSource('issuer', () => source.isLifecycleOrigin(candidate)),
    { value: null, outcome: 'source_unavailable' });
});

test('no configuration or invalid credential selector never performs an issuer lookup', async (t) => {
  const { candidate, body } = fixture();
  for (const config of [{ internalKey: undefined }, { baseUrl: undefined }]) {
    const { remote, answer } = await ask(t, candidate, { body }, config);
    assert.deepEqual(answer, { value: null, outcome: 'source_not_available' });
    assert.equal(remote.seen.length, 0);
  }
  const { remote, answer } = await ask(t, { ...candidate, credentialId: '*' }, { body });
  assert.deepEqual(answer, { value: null, outcome: 'contract_violation' });
  assert.equal(remote.seen.length, 0);
});

test('unsigned event fields cannot borrow origin from the unchanged signed credential', async (t) => {
  const { candidate, body } = fixture();
  for (const patch of [{ agentLearnerKey: 'spoofed' }, { configurationFingerprint: 'sha256:spoofed' },
    { overallPercent: 100 }, { environment: 'live', evidenceMode: 'live' },
    { environment: 'simulation', evidenceMode: 'synthetic' }, { environment: 'simulation', evidenceMode: 'replay' },
    { environment: 'simulation', evidenceMode: 'live' }, { environment: 'simulation', evidenceMode: 'fallback' },
    { package: { ...candidate.package, digest: 'changed' } }]) {
    const { answer } = await ask(t, { ...candidate, ...patch }, { body });
    assert.equal(answer.value, false);
  }
});

test('signed-value edits fail verification and cannot match the issuer artifact digest', async (t) => {
  const { issued, body } = fixture();
  const [header, , signature] = issued.compactJws.split('.');
  const changed = { ...issued.credential, environment: 'live', evidenceMode: 'live' };
  const compactJws = `${header}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
  assert.equal(verifyCredential(compactJws, publicPem).signature.status, 'FAIL');
  const candidate = toCandidate({ ...issued, credential: changed, compactJws });
  assert.equal((await ask(t, candidate, { body })).answer.value, false);
});

test('legacy artifacts remain unchanged and cannot acquire a signed decision binding or provenance', async (t) => {
  const { issued, candidate, body } = fixture({ legacy: true });
  const original = issued.compactJws;
  assert.equal(candidate.environment, null);
  assert.equal(candidate.evidenceMode, null);
  assert.deepEqual((await ask(t, candidate, { body })).answer, { value: null, outcome: 'contract_violation' });
  assert.equal(issued.compactJws, original);
});
