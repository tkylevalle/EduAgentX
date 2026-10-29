'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../index');
const { createMemoryStore, applyProjectionEvent } = require('../store');

const KEY = 'internal-test-key';
const OPERATOR = 'admin-client';
const NOW = '2026-10-18T00:00:00.000Z';
const PACKAGE = { id: 'pkg-ai-safety', version: '1.0.0', digest: 'sha256:package-1' };

const requestBody = (patch = {}) => ({
  domain: 'ai-agent-safety-secure-tool-use',
  requiredObjectiveIds: ['obj-prompt-injection', 'obj-tool-scope'],
  minOverallPercent: 85,
  minAdversarialPercent: 75,
  maxCredentialAgeDays: 90,
  allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation',
  title: 'Simulated secure tool-use reviewer',
  ...patch,
});

const issued = (agent, overrides = {}) => ({
  eventId: `evt-issued-${agent}`,
  eventType: 'credential.issued',
  credentialId: `cred-${agent}`,
  agentLearnerKey: agent,
  occurredAt: '2026-09-18T00:00:00.000Z',
  credential: {
    configurationFingerprint: `sha256:fp-${agent}`,
    package: { ...PACKAGE },
    overallPercent: 90,
    adversarialPercent: 80,
    assessmentMode: 'standard',
    environment: 'simulation',
    evidenceMode: 'synthetic',
    validFrom: '2026-09-18T00:00:00.000Z',
    validUntil: '2027-09-18T00:00:00.000Z',
  },
  ...overrides,
});

// Fake authoritative sources. Each answer can be changed, made to throw, or made to hang.
function fakeSources() {
  const state = { status: new Map(), throwFor: new Set(), hangFor: new Set(), calls: 0 };
  const guard = (credentialId) => {
    state.calls += 1;
    if (state.throwFor.has(credentialId)) throw new Error('verification down');
    if (state.hangFor.has(credentialId)) return new Promise(() => {});
    return null;
  };
  return {
    state,
    verification: { async verify(candidate) {
      if (state.beforeVerify) await state.beforeVerify();
      const blocked = guard(candidate.credentialId);
      if (blocked) return blocked;
      return { signature: 'valid', schema: 'valid', status: state.status.get(candidate.credentialId) || 'active' };
    } },
    registry: { async getCurrentFingerprint(agentLearnerKey) { return `sha256:fp-${agentLearnerKey}`; } },
    package: { async getPackage(id, version) {
      return id === PACKAGE.id && version === PACKAGE.version
        ? { digest: PACKAGE.digest, domain: 'ai-agent-safety-secure-tool-use',
          objectiveIds: ['obj-prompt-injection', 'obj-tool-scope', 'obj-escalation'] }
        : null;
    } },
    lifecycle: { async isLifecycleOrigin() { return true; } },
  };
}

async function boot(t, { internalKey = KEY, sourceTimeoutMs = 200 } = {}) {
  const ctx = { store: createMemoryStore(), sources: fakeSources() };
  let ids = 0;
  const app = createApp({ store: ctx.store, internalKey, sources: ctx.sources, clock: () => NOW, sourceTimeoutMs,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  ctx.call = (method, path, body, actor = OPERATOR, headers = { 'x-internal-service-key': KEY, 'x-actor-subject': actor }) =>
    send(server, method, path, body, headers);
  ctx.create = (key = 'create-1', body = requestBody()) =>
    ctx.call('POST', '/internal/capability-requests', { idempotencyKey: key, request: body });
  ctx.open = (id, version = 1) => ctx.call('POST', `/internal/capability-requests/${id}/open`, { version });
  ctx.close = (id) => ctx.call('POST', `/internal/capability-requests/${id}/close`, {});
  ctx.publish = (agent, key = `pub-${agent}`) => ctx.call('POST', '/internal/listings/publish', { idempotencyKey: key }, agent);
  ctx.withdraw = (agent, key = `wd-${agent}`) => ctx.call('POST', '/internal/listings/withdraw', { idempotencyKey: key }, agent);
  ctx.check = (id, key = 'check-1') => ctx.call('POST', `/internal/capability-requests/${id}/eligibility-checks`, { idempotencyKey: key });
  ctx.ingest = (event) => applyProjectionEvent(ctx.store, event, { now: NOW });
  // An open request plus listed, projected agents: the starting point for every check test.
  ctx.ready = async (agents = ['agent-a', 'agent-b', 'agent-c']) => {
    const created = await ctx.create();
    for (const agent of agents) { await ctx.ingest(issued(agent)); await ctx.publish(agent); }
    await ctx.open(created.body.request.id);
    return created.body.request.id;
  };
  return ctx;
}

function send(server, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path, agent: false,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const keysOf = (list) => list.map((item) => item.agentLearnerKey);
const codesOf = (item) => item.reasons.map((reason) => reason.code);

// --- authentication

test('the internal routes refuse a missing or wrong key and a missing actor with 401', async (t) => {
  const ctx = await boot(t);
  for (const headers of [{}, { 'x-actor-subject': OPERATOR }, { 'x-internal-service-key': 'wrong', 'x-actor-subject': OPERATOR },
    { 'x-internal-service-key': KEY }]) {
    const response = await ctx.call('GET', '/internal/capability-requests', undefined, OPERATOR, headers);
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.equal(response.body.error, 'unauthorized');
  }
});

test('without a configured internal key every internal route fails closed with 503', async (t) => {
  // null, not undefined: undefined would fall back to the default key in boot().
  const ctx = await boot(t, { internalKey: null });
  const response = await ctx.call('GET', '/internal/capability-requests');
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'marketplace_not_configured');
});

test('health reports ok, and 503 when the database is down', async (t) => {
  const ctx = await boot(t);
  assert.equal((await ctx.call('GET', '/health', undefined, null, {})).status, 200);
  ctx.store.health = async () => { throw new Error('down'); };
  assert.equal((await ctx.call('GET', '/health', undefined, null, {})).status, 503);
});

test('start() with missing config stays up and reports 503 with the missing names, not a crash', async (t) => {
  const { start } = require('../index');
  const server = start({ PORT: '0' });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const health = await send(server, 'GET', '/health', undefined, {});
  assert.equal(health.status, 503);
  assert.deepEqual(health.body.problems, ['missing:DATABASE_URL', 'missing:MARKETPLACE_INTERNAL_KEY',
    'missing:CURRICULUM_INTERNAL_KEY', 'schema_not_applied']);
  assert.equal(health.body.eventFeed, 'disabled');
  const internal = await send(server, 'GET', '/internal/capability-requests', undefined, {});
  assert.equal(internal.status, 503);
});

test('start() with an unreachable database reports schema_not_applied and keeps refusing internal calls', async (t) => {
  const { start } = require('../index');
  const server = start({ PORT: '0', DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    MARKETPLACE_INTERNAL_KEY: KEY, CURRICULUM_INTERNAL_KEY: 'k' });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const health = await send(server, 'GET', '/health', undefined, {});
  assert.equal(health.status, 503);
  assert.deepEqual(health.body.problems, ['schema_not_applied']);
  const internal = await send(server, 'GET', '/internal/capability-requests', undefined,
    { 'x-internal-service-key': KEY, 'x-actor-subject': OPERATOR });
  assert.equal(internal.status, 503);
});

// --- Capability Requests

test('create, version, open, close and inspect a Capability Request', async (t) => {
  const ctx = await boot(t);
  const created = await ctx.create();
  assert.equal(created.status, 201);
  const id = created.body.request.id;
  assert.equal(created.body.request.state.status, 'draft');
  assert.equal(created.body.request.marketplace, 'simulation');
  assert.equal(created.body.request.versions.length, 1);
  assert.match(created.body.request.versions[0].digest, /^sha256:/);

  const v2 = await ctx.call('POST', `/internal/capability-requests/${id}/versions`,
    { idempotencyKey: 'v2', request: requestBody({ minOverallPercent: 90 }) });
  assert.equal(v2.status, 201);
  assert.deepEqual(v2.body.request.versions.map((v) => v.version), [1, 2]);

  const opened = await ctx.open(id, 2);
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.request.state, { status: 'open', openVersion: 2 });
  assert.equal((await ctx.open(id, 2)).body.outcome, 'unchanged');

  const closed = await ctx.close(id);
  assert.deepEqual(closed.body.request.state, { status: 'closed', openVersion: null });
  // Closed wins: it cannot be reopened or given a new version.
  assert.equal((await ctx.open(id, 1)).body.error, 'request_closed');
  assert.equal((await ctx.call('POST', `/internal/capability-requests/${id}/versions`,
    { idempotencyKey: 'v3', request: requestBody() })).body.error, 'request_closed');

  const read = await ctx.call('GET', `/internal/capability-requests/${id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.request.events.map((e) => [e.eventType, e.version]), [['opened', 2], ['closed', null]]);
  const list = await ctx.call('GET', '/internal/capability-requests');
  assert.deepEqual(list.body.requests.map((r) => r.id), [id]);
  assert.equal((await ctx.call('GET', '/internal/capability-requests/00000000-0000-4000-8000-999999999999')).status, 404);
});

test('a new version never changes an older one', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.create()).body.request.id;
  const before = (await ctx.call('GET', `/internal/capability-requests/${id}`)).body.request.versions[0];
  await ctx.call('POST', `/internal/capability-requests/${id}/versions`,
    { idempotencyKey: 'v2', request: requestBody({ title: 'Changed title', minOverallPercent: 95 }) });
  const after = (await ctx.call('GET', `/internal/capability-requests/${id}`)).body.request.versions;
  assert.deepEqual(after[0], before);
  assert.notEqual(after[1].digest, before.digest);
});

test('an invalid request or body is refused before anything is written', async (t) => {
  const ctx = await boot(t);
  const bad = await ctx.create('bad', requestBody({ domain: 'ai-safety-fundamentals', ranking: 1 }));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.details, ['domain_unsupported', 'unexpected:ranking']);
  const extra = await ctx.call('POST', '/internal/capability-requests', { idempotencyKey: 'x', request: requestBody(), owner: 'me' });
  assert.deepEqual(extra.body.details, ['unexpected:owner']);
  assert.equal((await ctx.call('POST', '/internal/capability-requests', { request: requestBody() })).status, 400);
  assert.deepEqual((await ctx.call('GET', '/internal/capability-requests')).body.requests, []);
});

test('create replays with the same key and body, and a changed body gets 409', async (t) => {
  const ctx = await boot(t);
  const first = await ctx.create('same-key');
  const replay = await ctx.create('same-key');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.outcome, 'replay');
  assert.equal(replay.body.request.id, first.body.request.id);
  const changed = await ctx.create('same-key', requestBody({ minOverallPercent: 99 }));
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
  assert.equal((await ctx.call('GET', '/internal/capability-requests')).body.requests.length, 1);
});

test('version replays with the same key and body, and a changed body gets 409', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.create()).body.request.id;
  const path = `/internal/capability-requests/${id}/versions`;
  assert.equal((await ctx.call('POST', path, { idempotencyKey: 'v2', request: requestBody({ title: 'B' }) })).status, 201);
  const replay = await ctx.call('POST', path, { idempotencyKey: 'v2', request: requestBody({ title: 'B' }) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.request.versions.length, 2);
  assert.equal((await ctx.call('POST', path, { idempotencyKey: 'v2', request: requestBody({ title: 'C' }) })).status, 409);
});

test('a unique-key collision is retried once and then succeeds', async (t) => {
  const ctx = await boot(t);
  ctx.store.failNextWrite = 1;
  const created = await ctx.create();
  assert.equal(created.status, 201);
  assert.equal((await ctx.call('GET', '/internal/capability-requests')).body.requests.length, 1);
});

// --- listings

test('publish and withdraw act on the actor, never on an agent named in the body', async (t) => {
  const ctx = await boot(t);
  const named = await ctx.call('POST', '/internal/listings/publish', { idempotencyKey: 'p', agentLearnerKey: 'agent-z' }, 'agent-a');
  assert.equal(named.status, 400);
  assert.deepEqual(named.body.details, ['unexpected:agentLearnerKey']);

  const published = await ctx.publish('agent-a');
  assert.equal(published.status, 201);
  assert.equal(published.body.listing.agentLearnerKey, 'agent-a');
  assert.equal(published.body.listing.discoverable, true);
  assert.equal((await ctx.call('GET', '/internal/listings/agent-z')).body.listing.discoverable, false);

  assert.equal((await ctx.publish('agent-a')).body.outcome, 'replay');
  assert.equal((await ctx.call('POST', '/internal/listings/withdraw', { idempotencyKey: 'pub-agent-a' }, 'agent-a')).status, 409);
  await ctx.withdraw('agent-a');
  const read = await ctx.call('GET', '/internal/listings/agent-a');
  assert.equal(read.body.listing.discoverable, false);
  assert.deepEqual(read.body.listing.events.map((e) => [e.eventType, e.actor]), [['published', 'agent-a'], ['withdrawn', 'agent-a']]);
});

// --- eligibility checks

test('a check on a request that is not open is refused', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.create()).body.request.id;
  assert.equal((await ctx.check(id, 'draft')).body.error, 'request_not_open');
  await ctx.open(id);
  await ctx.close(id);
  const refused = await ctx.check(id, 'closed');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'request_not_open');
  assert.equal(ctx.sources.state.calls, 0);
});

test('a check where every candidate is valid returns them all, ordered by key only', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-c', 'agent-a', 'agent-b']);
  const result = await ctx.check(id);
  assert.equal(result.status, 201);
  assert.deepEqual(keysOf(result.body.eligible), ['agent-a', 'agent-b', 'agent-c']);
  assert.deepEqual(result.body.excluded, []);
  assert.equal(result.body.check.marketplace, 'simulation');
  assert.equal(result.body.check.version, 1);
  assert.match(result.body.check.requestDigest, /^sha256:/);
  assert.deepEqual(result.body.eligible[0].sources,
    { verification: 'answered', registry: 'answered', package: 'answered', lifecycleOrigin: 'answered', listing: 'marketplace' });
  // No score or rank is produced here; that belongs to #31.
  assert.ok(result.body.eligible.every((item) => !('score' in item) && !('rank' in item)));
  const replay = await ctx.check(id);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.check.checkId, result.body.check.checkId);
});

test('a non-discoverable agent is excluded with NOT_DISCOVERABLE', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-a', 'agent-b']);
  await ctx.withdraw('agent-b');
  const result = await ctx.check(id);
  assert.deepEqual(keysOf(result.body.eligible), ['agent-a']);
  assert.deepEqual(codesOf(result.body.excluded[0]), ['NOT_DISCOVERABLE']);
});

test('a source that throws or hangs excludes only that candidate as UNCHECKABLE', async (t) => {
  const ctx = await boot(t, { sourceTimeoutMs: 50 });
  const id = await ctx.ready();
  ctx.sources.state.throwFor.add('cred-agent-b');
  ctx.sources.state.hangFor.add('cred-agent-c');
  const result = await ctx.check(id);
  assert.equal(result.status, 201);
  assert.deepEqual(keysOf(result.body.eligible), ['agent-a']);
  assert.deepEqual(keysOf(result.body.excluded), ['agent-b', 'agent-c']);
  for (const item of result.body.excluded) {
    assert.ok(codesOf(item).includes('STATUS_UNCHECKABLE'), item.agentLearnerKey);
    assert.equal(item.sources.registry, 'answered');
  }
  assert.deepEqual(result.body.excluded.map((item) => item.sources.verification), ['source_unavailable', 'timeout']);
});

test('a close while sources are being called makes the check fail with 409 and stores nothing', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-a']);
  // The close goes through the real route; it could only finish here if the check held no lock.
  ctx.sources.state.beforeVerify = async () => { assert.equal((await ctx.close(id)).body.outcome, 'closed'); };
  const result = await ctx.check(id, 'racing-check');
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'request_not_open');
  assert.equal(await ctx.store.readCheckByKey(OPERATOR, 'racing-check'), null);
});

test('a new open version while sources are being called makes the check fail with 409', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-a']);
  await ctx.call('POST', `/internal/capability-requests/${id}/versions`, { idempotencyKey: 'v2', request: requestBody({ title: 'B' }) });
  ctx.sources.state.beforeVerify = async () => { await ctx.open(id, 2); };
  const result = await ctx.check(id, 'version-race');
  assert.equal(result.body.error, 'request_version_changed');
  assert.equal(await ctx.store.readCheckByKey(OPERATOR, 'version-race'), null);
});

test('a withdrawal while sources are being called is seen by the stored result', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-a', 'agent-b']);
  let once = false;
  ctx.sources.state.beforeVerify = async () => { if (!once) { once = true; await ctx.withdraw('agent-b'); } };
  const result = await ctx.check(id);
  assert.deepEqual(keysOf(result.body.eligible), ['agent-a']);
  assert.deepEqual(codesOf(result.body.excluded[0]), ['NOT_DISCOVERABLE']);
});

test('a status change between two checks changes the result and leaves the old check unchanged', async (t) => {
  const ctx = await boot(t);
  const id = await ctx.ready(['agent-a', 'agent-b']);
  const first = await ctx.check(id, 'check-1');
  assert.deepEqual(keysOf(first.body.eligible), ['agent-a', 'agent-b']);

  ctx.sources.state.status.set('cred-agent-b', 'suspended');
  const second = await ctx.check(id, 'check-2');
  assert.deepEqual(keysOf(second.body.eligible), ['agent-a']);
  assert.deepEqual(codesOf(second.body.excluded[0]), ['STATUS_SUSPENDED']);

  const old = await ctx.call('GET', `/internal/eligibility-checks/${first.body.check.checkId}`);
  assert.equal(old.status, 200);
  assert.deepEqual(old.body, { ...first.body, outcome: 'found', correlationId: old.body.correlationId });
  assert.equal((await ctx.call('GET', '/internal/eligibility-checks/00000000-0000-4000-8000-999999999999')).status, 404);
});

// --- projection

test('a duplicate projection event changes nothing', async (t) => {
  const ctx = await boot(t);
  await ctx.ingest(issued('agent-a'));
  const suspend = { eventId: 'evt-2', eventType: 'credential.suspended', credentialId: 'cred-agent-a',
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-01T00:00:00.000Z' };
  assert.equal((await ctx.ingest(suspend)).outcome, 'applied');
  await ctx.ingest({ ...suspend, eventId: 'evt-3', eventType: 'credential.reinstated', occurredAt: '2026-10-02T00:00:00.000Z' });
  assert.equal((await ctx.ingest(suspend)).outcome, 'duplicate');
  const [record] = await ctx.store.listProjection();
  assert.equal(record.status, 'active');
  assert.equal(record.lastEventId, 'evt-3');
});

test('an out-of-order projection event is ignored', async (t) => {
  const ctx = await boot(t);
  await ctx.ingest(issued('agent-a'));
  await ctx.ingest({ eventId: 'evt-late', eventType: 'credential.suspended', credentialId: 'cred-agent-a',
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-05T00:00:00.000Z' });
  const older = await ctx.ingest({ eventId: 'evt-early', eventType: 'credential.reinstated', credentialId: 'cred-agent-a',
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(older.outcome, 'ignored');
  assert.equal(older.reason, 'out_of_order');
  assert.equal((await ctx.store.listProjection())[0].status, 'suspended');
});

test('a revoked credential never returns to active', async (t) => {
  const ctx = await boot(t);
  await ctx.ingest(issued('agent-a'));
  await ctx.ingest({ eventId: 'evt-r', eventType: 'credential.revoked', credentialId: 'cred-agent-a',
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-01T00:00:00.000Z' });
  const reinstate = await ctx.ingest({ eventId: 'evt-back', eventType: 'credential.reinstated', credentialId: 'cred-agent-a',
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-02T00:00:00.000Z' });
  assert.equal(reinstate.reason, 'revoked_is_final');
  assert.equal((await ctx.store.listProjection())[0].status, 'revoked');
});

// #31: keep #30's eligibility routes unchanged; matching is a separate contract.
test('matching persists a replayable, private-content-free result with two honest lanes', async (t) => {
  const ctx = await boot(t); const id = await ctx.ready(['agent-a']);
  const near = issued('agent-near'); near.credential = { ...near.credential, overallPercent: 84, evidenceMode: 'replay', rawAnswers: 'PRIVATE' };
  await ctx.ingest(near); await ctx.publish('agent-near');
  const path = `/internal/capability-requests/${id}/matches`;
  const first = await ctx.call('POST', path, { idempotencyKey: 'match' });
  assert.equal(first.status, 201); const m = first.body.matchResult;
  assert.equal(m.totalEligible, 1); assert.equal(m.totalNearMatches, 1);
  assert.equal(m.nearMatches[0].lane, 'Not Eligible'); assert.ok(!JSON.stringify(m).includes('PRIVATE'));
  ctx.sources.state.status.set('cred-agent-a', 'revoked');
  const replay = await ctx.call('POST', path, { idempotencyKey: 'match' });
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.matchResult, m);
  const read = await ctx.call('GET', `/internal/match-results/${m.resultId}`);
  assert.deepEqual(read.body.matchResult, m);
  const fresh = await ctx.call('POST', path, { idempotencyKey: 'fresh' });
  assert.equal(fresh.body.matchResult.totalEligible, 0);
  assert.equal(fresh.body.matchResult.exclusionCounts.STATUS_REVOKED, 1);
  assert.equal((await ctx.call('GET', '/internal/match-results/nope')).status, 404);
});

test('concurrent matching and restart preserve one original result and reject key reuse on another request', async (t) => {
  const ctx = await boot(t); const id = await ctx.ready(['agent-a']);
  const path = `/internal/capability-requests/${id}/matches`;
  const responses = await Promise.all(Array.from({ length: 8 }, () => ctx.call('POST', path, { idempotencyKey: 'same' })));
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(responses.map((r) => r.body.matchResult.resultId)).size, 1);
  const m = responses[0].body.matchResult;
  const server = http.createServer(createApp({ store: ctx.store, sources: ctx.sources, internalKey: KEY }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const replay = await send(server, 'POST', path, { idempotencyKey: 'same' },
    { 'x-internal-service-key': KEY, 'x-actor-subject': OPERATOR });
  assert.deepEqual(replay.body.matchResult, m);
  const other = (await ctx.create('other')).body.request.id;
  assert.equal((await ctx.call('POST', `/internal/capability-requests/${other}/matches`, { idempotencyKey: 'same' })).status, 409);
  await ctx.close(id);
  assert.deepEqual((await ctx.call('POST', path, { idempotencyKey: 'same' })).body.matchResult, m);
});

test('matching rejects overrides, unknown policy fields, and missing auth', async (t) => {
  const ctx = await boot(t); const id = await ctx.ready(['agent-a']); const path = `/internal/capability-requests/${id}/matches`;
  for (const patch of [{ minOverallPercent: 0 }, { candidates: [] }, { policyVersion: 'unsafe' }])
    assert.equal((await ctx.call('POST', path, { idempotencyKey: 'x', ...patch })).status, 400);
  assert.equal((await ctx.call('POST', path, { idempotencyKey: 'x' }, OPERATOR, {})).status, 401);
});

test('matching observes listing withdrawal and rejects request version races without writing', async (t) => {
  const ctx = await boot(t); const id = await ctx.ready(['agent-a']); const path = `/internal/capability-requests/${id}/matches`;
  ctx.sources.state.beforeVerify = async () => ctx.withdraw('agent-a');
  assert.equal((await ctx.call('POST', path, { idempotencyKey: 'withdraw' })).body.matchResult.totalEligible, 0);
  await ctx.call('POST', `/internal/capability-requests/${id}/versions`, { idempotencyKey: 'v2', request: requestBody({ title: 'v2' }) });
  ctx.sources.state.beforeVerify = async () => ctx.open(id, 2);
  const result = await ctx.call('POST', path, { idempotencyKey: 'race' });
  assert.equal(result.body.error, 'request_version_changed');
  assert.equal(await ctx.store.readMatchByKey(OPERATOR, 'race'), null);
});
