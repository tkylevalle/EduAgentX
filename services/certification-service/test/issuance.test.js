'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync, verify, randomUUID, createHash } = require('node:crypto');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');

const KEY = 'certification-test-secret';
const ORIGIN_KEY = 'marketplace-origin-test-secret';
const HEADERS = { 'x-internal-service-key': KEY, 'x-actor-subject': 'examination-engine', 'x-actor-role': 'examination-engine' };
const ORIGIN_HEADERS = { 'x-internal-service-key': ORIGIN_KEY,
  'x-actor-subject': 'marketplace-service', 'x-actor-role': 'marketplace' };
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
}), appOptions = {}) {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store, examinationEvidence: getEvidence, packageTrust,
    internalKey: KEY, originReadKey: ORIGIN_KEY, privateKey, keyId: 'https://eduagentx.example/issuers/eduagentx#test',
    clock: () => '2026-10-17T06:01:00.000Z', ...appOptions }));
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

test('origin read binds the immutable issued decision, examination, subject, fingerprint and exact signed bytes', async (t) => {
  const ctx = await boot(t);
  const issued = await ctx.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'origin' });
  const { credentialId, credential, compactJws } = issued.body.credential;
  const saved = await ctx.store.findByAttempt(evidence().attemptId);
  assert.equal(credential.evidence.certificationDecisionId, saved.decisionId);
  const [, payload] = compactJws.split('.');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).evidence.certificationDecisionId, saved.decisionId);
  const read = await ctx.get(`/internal/credential-origins/${credentialId}`, ORIGIN_HEADERS);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { apiVersion: 'v1', origin: {
    schemaVersion: 'certification-origin/1.0.0', outcome: 'certified', credentialId,
    decisionId: saved.decisionId, examinationId: evidence().attemptId,
    subjectId: evidence().agentLearnerKey, configurationFingerprint: evidence().configurationFingerprint,
    credentialDigest: `sha256:${createHash('sha256').update(compactJws).digest('hex')}`,
  } });
  // No credential dump, scores, answers, prompts, rationale or secret material.
  assert.equal(JSON.stringify(read.body).includes(compactJws), false);
  assert.deepEqual(await ctx.store.counts(), { decisions: 1, credentials: 1 });
});

test('origin lookup refuses missing/wrong keys, unauthorized roles and subjects, and the general issuer key', async (t) => {
  const ctx = await boot(t);
  const path = `/internal/credential-origins/${randomUUID()}`;
  for (const headers of [{}, { ...ORIGIN_HEADERS, 'x-internal-service-key': '' },
    { ...ORIGIN_HEADERS, 'x-internal-service-key': 'wrong' },
    { ...ORIGIN_HEADERS, 'x-internal-service-key': KEY },
    { ...ORIGIN_HEADERS, 'x-actor-role': 'gateway' }, { ...ORIGIN_HEADERS, 'x-actor-role': 'agent' },
    { ...ORIGIN_HEADERS, 'x-actor-subject': '' }, { ...ORIGIN_HEADERS, 'x-actor-subject': 'another-service' }]) {
    assert.equal((await ctx.get(path, headers)).status, 403);
  }
});

test('Marketplace origin key cannot enumerate credentials or read other issuer routes or issue decisions', async (t) => {
  const ctx = await boot(t);
  for (const path of ['/internal/credentials', '/internal/credential-origins',
    '/internal/kpi/issuance', `/internal/decisions/by-examination/${evidence().attemptId}`])
    assert.equal((await ctx.get(path, ORIGIN_HEADERS)).status, 403);
  assert.equal((await ctx.call('/internal/decisions', {
    examinationId: evidence().attemptId, idempotencyKey: 'forbidden-origin-write',
  }, ORIGIN_HEADERS)).status, 403);
  assert.equal((await ctx.call(`/internal/credential-origins/${randomUUID()}`, {}, ORIGIN_HEADERS)).status, 403);
  assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
});

test('origin read is exact-selector only: unknown ID is absent and broad/malformed selectors are refused', async (t) => {
  const ctx = await boot(t);
  assert.equal((await ctx.get(`/internal/credential-origins/${randomUUID()}`, ORIGIN_HEADERS)).status, 404);
  for (const selector of ['all', '*', 'not-a-uuid', `${randomUUID()}?limit=100`, `${randomUUID()}?subject=agent-1`])
    assert.equal((await ctx.get(`/internal/credential-origins/${selector}`, ORIGIN_HEADERS)).status, 400);
});

for (const status of ['agent_failed', 'system_aborted']) {
  test(`${status} examination cannot establish issued origin`, async (t) => {
    const ctx = await boot(t, async () => evidence({ status }));
    assert.equal((await ctx.call('/internal/decisions', {
      examinationId: evidence().attemptId, idempotencyKey: status,
    })).status, 409);
    assert.equal((await ctx.get(`/internal/credential-origins/${randomUUID()}`, ORIGIN_HEADERS)).status, 404);
    assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
  });
}

test('evidence returned for a different examination cannot be issued under the requested selector', async (t) => {
  const ctx = await boot(t, async () => evidence({ attemptId: randomUUID() }));
  const refused = await ctx.call('/internal/decisions', { examinationId: evidence().attemptId, idempotencyKey: 'mismatch' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'examination_evidence_mismatch');
  assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
});

test('conflicting source replay preserves the original signed decision and origin without rereading evidence', async (t) => {
  let reads = 0;
  const ctx = await boot(t, async () => { reads++; return evidence({ agentLearnerKey: reads === 1 ? 'agent-1' : 'spoofed' }); });
  const command = { examinationId: evidence().attemptId, idempotencyKey: 'immutable-origin' };
  const first = await ctx.call('/internal/decisions', command);
  const path = `/internal/credential-origins/${first.body.credential.credentialId}`;
  const origin = await ctx.get(path, ORIGIN_HEADERS);
  const replay = await ctx.call('/internal/decisions', command);
  assert.equal(reads, 1);
  assert.deepEqual(replay.body.credential, first.body.credential);
  assert.deepEqual((await ctx.get(path, ORIGIN_HEADERS)).body, origin.body);
});

test('caller provenance cannot be supplied on the issuance command', async (t) => {
  const ctx = await boot(t);
  const refused = await ctx.call('/internal/decisions', {
    examinationId: evidence().attemptId, idempotencyKey: 'spoofed-provenance', environment: 'live', evidenceMode: 'live',
  });
  assert.equal(refused.status, 400);
  assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
});

test('missing or reused issuer key configuration refuses origin reads', async (t) => {
  for (const originReadKey of [null, KEY]) {
    const ctx = await boot(t, undefined, undefined, { originReadKey });
    assert.equal((await ctx.get(`/internal/credential-origins/${randomUUID()}`,
      { ...ORIGIN_HEADERS, 'x-internal-service-key': originReadKey || ORIGIN_KEY })).status, 403);
  }
});

test('origin storage uncertainty returns unavailable without exposing errors or writing a decision', async (t) => {
  const ctx = await boot(t);
  ctx.store.findOriginByCredential = async () => { throw new Error('private-storage-details'); };
  const response = await ctx.get(`/internal/credential-origins/${randomUUID()}`, ORIGIN_HEADERS);
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'certification_unavailable');
  assert.equal(JSON.stringify(response.body).includes('private-storage-details'), false);
  assert.deepEqual(await ctx.store.counts(), { decisions: 0, credentials: 0 });
});


const provenance = require('../../../packages/execution-provenance');
const { fixture: provenanceFixture } = require('../../../packages/execution-provenance/test/fixtures');
function authoritativeEvidence(mode) {
  const f = provenanceFixture(mode, 'agent-1');
  const e = evidence({ package: structuredClone(f.run.package), configurationFingerprint: f.run.configurationFingerprint });
  const items = require('../../examination-engine/standard-generator').createStandardItems({ packageDigest: f.pkg.digest,
    template: f.pkg.examTemplate, objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  e.assessment.itemOutcomes = items.map((i) => ({ itemId: i.id, tier: i.tier, score: 90, criticalViolationRuleIds: [], malformed: false }));
  e.schemaVersion = 'certification-evidence/1.1.0';
  e.provenanceProfile = provenance.RUN;
  e.provenance = { schemaVersion: 'certification-provenance/1.0.0', run: f.run,
    training: { eventId: f.completion.eventId, completionDigest: provenance.hash(f.completion), coverage: f.completion.executionCoverage },
    examination: provenance.coverage(f.run, 'examination', items.map((i) => i.id),
      items.map((i) => provenance.receipt(f.run, 'examination', i, e.attemptId).executionEvidence), e.attemptId) };
  return e;
}
for (const mode of ['synthetic','replay']) {
  test(`authoritative ${mode} is validated, persisted, signed and replayed without a second decision`, async (t) => {
    const source = authoritativeEvidence(mode);
    const c = await boot(t, async () => source, async () => provenanceFixture('synthetic', 'agent-1').pkg, { issuanceEnvironment: 'simulation', issuer: provenance.SIMULATION_ISSUER, keyId: `${provenance.SIMULATION_ISSUER}#test` });
    const body = { examinationId: source.attemptId, idempotencyKey: 'provenance' };
    const issued = await c.call('/internal/decisions', body);
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const vc = issued.body.credential.credential;
    assert.equal(vc.environment, 'simulation'); assert.equal(vc.evidenceMode, mode);
    assert.deepEqual(vc.evidence.provenance, source.provenance);
    assert.equal(provenance.credentialProvenance(vc), true);
    const row = await c.store.findByAttempt(source.attemptId);
    assert.deepEqual(row.evidence.examinationEvidence.provenance, source.provenance);
    assert.equal((await c.call('/internal/decisions', body)).body.credential.compactJws, issued.body.credential.compactJws);
    source.provenance.run.evidenceMode = 'live';
    assert.equal((await c.call('/internal/decisions', body)).body.credential.compactJws, issued.body.credential.compactJws);
    assert.deepEqual(await c.store.counts(), { decisions: 1, credentials: 1 });
    const { verifyCredential } = require('../../credential-verification/src/verifier');
    const oldIssuer = process.env.CREDENTIAL_ISSUER;
    process.env.CREDENTIAL_ISSUER = vc.issuer;
    try {
      const key = publicKey.export({ type: 'spki', format: 'pem' });
      const status = { getStatus: () => 'active' };
      assert.equal(verifyCredential(issued.body.credential.compactJws, key, status).overall, 'VALID');
      for (const edit of [v => v.environment = 'live', v => v.evidenceMode = 'live', v => v.evidence.provenance.run.runId = randomUUID()]) {
        const v = structuredClone(vc); edit(v);
        const parts = issued.body.credential.compactJws.split('.'); parts[1] = Buffer.from(JSON.stringify(v)).toString('base64url');
        assert.equal(verifyCredential(parts.join('.'), key, status).overall, 'INVALID');
      }
    } finally { if (oldIssuer === undefined) delete process.env.CREDENTIAL_ISSUER; else process.env.CREDENTIAL_ISSUER = oldIssuer; }
  });
}
for (const [name, edit] of [
  ['missing profile data', e => delete e.provenance],
  ['removed profile cannot downgrade', e => { delete e.provenance; delete e.provenanceProfile; }],
  ['unsupported evidence version', e => e.schemaVersion = 'unknown/1'],
  ['unsupported version', e => e.provenanceProfile = 'future/9'],
  ['incomplete coverage', e => e.provenance.examination.itemCount--],
  ['wrong assessed item coverage', e => e.provenance.examination.itemIdsDigest = provenance.hash(['other'])],
  ['wrong learner', e => e.provenance.run.agentLearnerKey = 'other'],
  ['wrong fingerprint', e => e.provenance.run.configurationFingerprint = 'other'],
  ['wrong package', e => e.provenance.run.package.digest = 'other'],
  ['coherent source with wrong package digest', e => { e.package = { ...e.package, digest: 'wrong' }; e.provenance.run.package = { ...e.package }; }],
  ['invalid pair', e => e.provenance.run.environment = 'live'],
  ['unsupported policy', e => e.provenance.run.policyVersion = 'arbitrary'],
  ['malformed coverage', e => delete e.provenance.training.coverage],
]) test(`Certification rejects ${name} before persistence`, async (t) => {
  const source = authoritativeEvidence('synthetic'); edit(source);
  const c = await boot(t, async () => source, async () => provenanceFixture('synthetic', 'agent-1').pkg, { issuanceEnvironment: 'simulation' });
  const r = await c.call('/internal/decisions', { examinationId: source.attemptId, idempotencyKey: name });
  assert.equal(r.status, 409); assert.deepEqual(await c.store.counts(), { decisions: 0, credentials: 0 });
});
test('simulation provenance is refused before persistence under any issuer but the test issuer', async (t) => {
  const source = authoritativeEvidence('synthetic');
  const c = await boot(t, async () => source, async () => provenanceFixture('synthetic', 'agent-1').pkg,
    { issuanceEnvironment: 'simulation', issuer: 'https://eduagentx.example/issuers/eduagentx' });
  assert.equal((await c.call('/internal/decisions', { examinationId: source.attemptId, idempotencyKey: 'other-issuer' })).status, 409);
  assert.deepEqual(await c.store.counts(), { decisions: 0, credentials: 0 });
});
test('simulation provenance cannot select a live-only or unconfigured issuer environment', async (t) => {
  for (const issuanceEnvironment of ['live', undefined]) {
    const source = authoritativeEvidence('replay');
    const c = await boot(t, async () => source, async () => provenanceFixture('synthetic', 'agent-1').pkg, { issuanceEnvironment });
    assert.equal((await c.call('/internal/decisions', { examinationId: source.attemptId, idempotencyKey: 'key-isolation' })).status, 409);
    assert.deepEqual(await c.store.counts(), { decisions: 0, credentials: 0 });
  }
});
