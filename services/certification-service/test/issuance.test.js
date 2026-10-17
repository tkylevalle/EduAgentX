'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, verify } = require('node:crypto');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');

const KEY = 'certification-test-secret';
const HEADERS = { 'x-internal-service-key': KEY, 'x-actor-subject': 'examination-engine', 'x-actor-role': 'examination-engine' };
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function evidence(overrides = {}) {
  return { attemptId: '6c3181d2-27c6-49e7-a196-75c1750efb79', status: 'complete',
    responseCollectionComplete: true, sequence: 32, agentLearnerKey: 'agent-1',
    configurationFingerprint: `sha256:${'a'.repeat(64)}`,
    package: { id: 'ai-safety', version: '1.2.0', digest: `sha256:${'b'.repeat(64)}` },
    mode: 'standard', template: { id: 'exam-template', version: '3.0.0', digest: `sha256:${'e'.repeat(64)}` },
    tierWeights: { recall: 20, applied: 40, adversarial: 40 },
    rubric: { id: 'ai-safety-rubric', version: '2.0.0', digest: `sha256:${'c'.repeat(64)}` },
    formDigest: `sha256:${'d'.repeat(64)}`, result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true },
    assessment: { schemaVersion: 'examination-assessment/1.0.0', passed: true, overallPercent: 90,
      tierPercents: { recall: 90, applied: 90, adversarial: 90 }, criticalViolationRuleIds: [], failureReasons: [],
      itemOutcomes: [...Array.from({ length: 5 }, (_, i) => ({ itemId: `r${i}`, tier: 'recall' })),
        ...Array.from({ length: 6 }, (_, i) => ({ itemId: `a${i}`, tier: 'applied' })),
        ...Array.from({ length: 4 }, (_, i) => ({ itemId: `v${i}`, tier: 'adversarial' }))]
        .map((item) => ({ ...item, score: 90, criticalViolationRuleIds: [], malformed: false })) },
    completedAt: '2026-10-17T06:00:59.000Z', ...overrides };
}

async function boot(t, getEvidence = async () => evidence(), packageTrust = async () => ({
  examTemplate: { overallPassPercent: 80, adversarialPassPercent: 70, failOnCriticalViolation: true },
})) {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store, examinationEvidence: getEvidence, packageTrust,
    internalKey: KEY, privateKey, keyId: 'https://eduagentx.example/issuers/eduagentx#test',
    clock: () => '2026-10-17T06:01:00.000Z' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, call: (path, body, headers = HEADERS) => request(server, path, body, headers),
    get: (path, headers = HEADERS) => request(server, path, undefined, headers, 'GET') };
}

function request(server, path, body, headers, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let raw = ''; res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('issues a signed project credential bound to a complete passing evidence record', async (t) => {
  const ctx = await boot(t);
  const response = await ctx.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'issue-1' });
  assert.equal(response.status, 201);
  assert.equal(response.body.outcome, 'issued');
  const [header, payload, signature] = response.body.credential.compactJws.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'EdDSA');
  assert.equal(verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  const credential = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(credential.credentialSubject.configurationFingerprint, evidence().configurationFingerprint);
  assert.equal(credential.evidence.rubric.digest, evidence().rubric.digest);
  assert.equal(credential.evidence.safetyResult.passed, true);
  assert.equal(credential.evidence.mode, 'standard');
  assert.deepEqual(await ctx.store.counts(), { decisions: 1, credentials: 1 });
  const kpi = await ctx.get('/internal/kpi/issuance');
  assert.equal(kpi.body.targetMs, 5000);
  assert.equal(kpi.body.acceptanceMaximumMs, 8000);
  assert.equal(kpi.body.targetMet, true);
  assert.ok(kpi.body.processingP95Ms >= 0);
  assert.ok(kpi.body.p95Ms <= 8000);
});

test('a package under critical quarantine cannot receive a new credential', async (t) => {
  const ctx = await boot(t, async () => evidence(), async () => false);
  const response = await ctx.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'quarantined' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'package_quarantined');
  assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
});

test('uncertain evidence fails closed, while a saved replay survives an evidence-source outage', async (t) => {
  const unavailable = await boot(t, async () => { throw Object.assign(new Error('offline'), { code: 'evidence_offline', status: 503 }); });
  const noDecision = await unavailable.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'uncertain' });
  assert.equal(noDecision.status, 503);
  assert.deepEqual(await unavailable.store.counts(), { decisions: 0, credentials: 0 });

  let online = true;
  const ctx = await boot(t, async () => {
    if (!online) throw Object.assign(new Error('offline'), { code: 'evidence_offline', status: 503 });
    return evidence();
  });
  const command = { examinationId: evidence().attemptId, idempotencyKey: 'durable-replay' };
  const issued = await ctx.call('/internal/decisions', command);
  online = false;
  const replay = await ctx.call('/internal/decisions', command);
  assert.equal(replay.body.outcome, 'replay');
  assert.equal(replay.body.credential.compactJws, issued.body.credential.compactJws);
});

test('an idempotency identity cannot be reused for a different examination', async (t) => {
  const ctx = await boot(t, async (id) => evidence({ attemptId: id }));
  const firstId = evidence().attemptId;
  const secondId = '6c3181d2-27c6-49e7-a196-75c1750efb80';
  assert.equal((await ctx.call('/internal/decisions', { examinationId: firstId, idempotencyKey: 'reused' })).status, 201);
  const conflict = await ctx.call('/internal/decisions', { examinationId: secondId, idempotencyKey: 'reused' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');
  assert.deepEqual(await ctx.store.counts(), { decisions: 1, credentials: 1 });
});

test('failed, incomplete, unsafe, malformed and system-aborted evidence cannot issue', async (t) => {
  const bad = [
    { status: 'agent_failed' }, { responseCollectionComplete: false },
    { assessment: { ...evidence().assessment, passed: false } },
    { assessment: { ...evidence().assessment, criticalViolationRuleIds: ['safety-stop'] } },
    { assessment: { ...evidence().assessment, overallPercent: 70,
      tierPercents: { recall: 70, applied: 70, adversarial: 70 },
      itemOutcomes: evidence().assessment.itemOutcomes.map((item) => ({ ...item, score: 70 })) } },
    { result: { schemaVersion: 'bad', valid: true, passed: true } },
    { assessment: null },
  ];
  for (const [i, overrides] of bad.entries()) {
    const isolated = await boot(t, async () => evidence(overrides));
    const result = await isolated.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: `bad-${i}` });
    assert.equal(result.status, 409, JSON.stringify(overrides));
    assert.deepEqual(await isolated.store.counts(), { decisions: 0, credentials: 0 });
  }
});

test('retries and concurrent duplicate events preserve one original outcome and credential', async (t) => {
  const ctx = await boot(t);
  const command = { examinationId: evidence().attemptId, idempotencyKey: 'issue-replay' };
  const [first, second] = await Promise.all([
    ctx.call('/internal/decisions', command), ctx.call('/internal/decisions', command),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.credential.credentialId, second.body.credential.credentialId);
  const retry = await ctx.call('/internal/decisions', command);
  assert.equal(retry.body.outcome, 'replay');
  assert.equal(retry.body.credential.compactJws, first.body.credential.compactJws);
  assert.deepEqual(await ctx.store.counts(), { decisions: 1, credentials: 1 });
});

test('internal issuer boundary rejects non-engine callers', async (t) => {
  const ctx = await boot(t);
  const response = await ctx.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'x' },
    { ...HEADERS, 'x-actor-role': 'agent' });
  assert.equal(response.status, 403);
});
