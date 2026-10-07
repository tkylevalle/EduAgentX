'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');
const { ContractError, SourceUnavailableError } = require('../clients');

const KEY = 'internal-test-key';
const LEARNER = 'learner-1';
const registration = { agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:config-1', configurationVersion: 1 };
const synthetic = { mode: 'synthetic', environment: 'simulation' };
const payload = () => ({
  objectives: [{ id: 'o1', deliveryItemIds: ['m1-a'] }, { id: 'o2', deliveryItemIds: ['m2-a'] }],
  modules: [
    { id: 'm2', sequence: 2, objectiveIds: ['o2'], deliveryItems: [{ id: 'm2-a', kind: 'practice', text: 'Practice B1' }] },
    { id: 'm1', sequence: 1, objectiveIds: ['o1'], deliveryItems: [{ id: 'm1-a', kind: 'practice', text: 'Practice A1' }] },
  ],
});

async function boot(t, overrides = {}) {
  const ctx = {
    packages: createFakePackageSource([{ id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1', payload: payload() }]),
    registry: createFakeRegistrySource([registration]),
    store: createMemoryStore(),
    ...overrides,
  };
  const app = createApp({ internalKey: KEY, packageSource: ctx.packages, registrySource: ctx.registry, store: ctx.store,
    clock: () => '2026-10-06T10:00:00.000Z' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  ctx.call = (method, path, body, headers = { 'x-internal-service-key': KEY, 'x-actor-subject': LEARNER }) =>
    request(server, method, path, body, headers);
  ctx.start = (key = 'start-1') => ctx.call('POST', '/internal/sessions/start', { idempotencyKey: key, evidence: synthetic });
  ctx.next = (id, key) => ctx.call('POST', `/internal/sessions/${id}/continue`, { idempotencyKey: key, evidence: synthetic });
  ctx.submit = (id, key, deliveryItemId, response = 'my answer') =>
    ctx.call('POST', `/internal/sessions/${id}/submit`, { idempotencyKey: key, evidence: synthetic, deliveryItemId, response });
  ctx.eventCount = async (id) => (await ctx.store.readSession(id)).events.length;
  return ctx;
}

function request(server, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path, agent: false,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const down = (source) => async () => { throw new SourceUnavailableError(source); };

test('health checks the store and returns 503 when it is down', async (t) => {
  assert.equal((await (await boot(t)).call('GET', '/health')).status, 200);
  const broken = createMemoryStore();
  broken.health = async () => { throw new Error('db down'); };
  assert.equal((await (await boot(t, { store: broken })).call('GET', '/health')).status, 503);
});

test('internal routes require the internal key and an actor subject', async (t) => {
  const ctx = await boot(t);
  const body = { idempotencyKey: 'k', evidence: synthetic };
  assert.equal((await ctx.call('POST', '/internal/sessions/start', body, {})).status, 403);
  assert.equal((await ctx.call('POST', '/internal/sessions/start', body, { 'x-internal-service-key': 'wrong', 'x-actor-subject': LEARNER })).status, 403);
  assert.equal((await ctx.call('GET', '/internal/sessions', undefined, { 'x-internal-service-key': 'wrong' })).status, 403);
  const noActor = await ctx.call('POST', '/internal/sessions/start', body, { 'x-internal-service-key': KEY });
  assert.deepEqual([noActor.status, noActor.body.error], [400, 'actor_required']);
});

test('start, continue and submit walk the session in order and resume the same session', async (t) => {
  const ctx = await boot(t);
  const started = await ctx.start();
  assert.equal(started.status, 201);
  assert.deepEqual(started.body.package, { id: 'pkg-a', version: '1.0.0', digest: 'digest-1' });
  const id = started.body.sessionId;

  const resumed = await ctx.start('start-2');
  assert.deepEqual([resumed.status, resumed.body.sessionId, resumed.body.resumed], [200, id, true]);

  const first = await ctx.next(id, 'c-1');
  assert.deepEqual([first.status, first.body.item.deliveryItemId], [200, 'm1-a']);
  assert.equal((await ctx.submit(id, 's-1', 'm1-a')).body.status, 'open');
  assert.equal((await ctx.next(id, 'c-2')).body.item.deliveryItemId, 'm2-a');
  const last = await ctx.submit(id, 's-2', 'm2-a');
  assert.deepEqual([last.status, last.body.status], [200, 'completed']);

  const detail = await ctx.call('GET', `/internal/sessions/${id}`);
  assert.equal(detail.body.session.status, 'completed');
  assert.deepEqual(detail.body.events.map((e) => e.eventType), ['session_started', 'session_resumed',
    'item_delivered', 'item_completed', 'item_delivered', 'item_completed', 'session_completed']);
  assert.ok(detail.body.events.every((e) => !('storedResponse' in e)), 'read views do not re-send stored lessons');
  assert.equal(detail.body.events[3].responseDigest.slice(0, 7), 'sha256:', 'only a digest of the answer is kept');
});

test('a retried request with the same idempotency key replays the stored response and appends nothing', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  const shown = await ctx.next(id, 'c-1');
  const shownAgain = await ctx.next(id, 'c-1');
  assert.deepEqual([shownAgain.status, shownAgain.body.outcome], [200, 'replay']);
  assert.deepEqual(shownAgain.body.item, shown.body.item);

  const done = await ctx.submit(id, 's-1', 'm1-a');
  const count = await ctx.eventCount(id);
  const doneAgain = await ctx.submit(id, 's-1', 'm1-a');
  assert.deepEqual([doneAgain.body.outcome, doneAgain.body.completedItemId], ['replay', done.body.completedItemId]);
  assert.equal(await ctx.eventCount(id), count);
});

test('the same idempotency key with different content is a 409 conflict', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  await ctx.next(id, 'c-1');
  await ctx.submit(id, 's-1', 'm1-a', 'first answer');
  const conflict = await ctx.submit(id, 's-1', 'm1-a', 'different answer');
  assert.deepEqual([conflict.status, conflict.body.error], [409, 'idempotency_conflict']);
});

test('a Quarantined package blocks continue once and the session reads back as blocked', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  ctx.packages.setState('pkg-a', 'Quarantined');
  const blocked = await ctx.next(id, 'c-1');
  assert.deepEqual([blocked.status, blocked.body.error, blocked.body.reason],
    [409, 'training_blocked', 'package_state:Quarantined']);
  const count = await ctx.eventCount(id);
  await ctx.next(id, 'c-2');
  assert.equal(await ctx.eventCount(id), count, 'the block is recorded once');

  const list = await ctx.call('GET', '/internal/sessions?status=blocked');
  assert.deepEqual(list.body.sessions.map((s) => [s.sessionId, s.status, s.blockReason]),
    [[id, 'blocked', 'package_state:Quarantined']]);
  assert.deepEqual((await ctx.call('GET', '/internal/sessions?status=open')).body.sessions, []);
});

test('when the Active package digest changes mid-session, continue is blocked', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  assert.equal((await ctx.next(id, 'c-1')).status, 200);
  ctx.packages.setDigest('pkg-a', 'digest-2');
  const blocked = await ctx.next(id, 'c-2');
  assert.deepEqual([blocked.status, blocked.body.reason], [409, 'package_digest_changed']);
});

test('a source outage returns 503 and writes nothing', async (t) => {
  const packagesDown = { getActive: down('validation-activation'), getById: down('validation-activation') };
  const ctx = await boot(t, { packages: packagesDown });
  const refused = await ctx.start();
  assert.deepEqual([refused.status, refused.body.error, refused.body.dependency],
    [503, 'dependency_unavailable', 'validation-activation']);
  assert.deepEqual(await ctx.store.listSessions(), []);

  const live = await boot(t);
  const id = (await live.start()).body.sessionId;
  const count = await live.eventCount(id);
  live.registry.getRegistration = down('agent-registry');
  assert.equal((await live.next(id, 'c-1')).status, 503);
  assert.equal(await live.eventCount(id), count);
});

test('a malformed package response is a 502 contract violation, never a guess', async (t) => {
  const malformed = { getActive: async () => { throw new ContractError('validation-activation', ['digest']); } };
  const ctx = await boot(t, { packages: malformed });
  const refused = await ctx.start();
  assert.deepEqual([refused.status, refused.body.error, refused.body.details], [502, 'dependency_contract_violation', ['digest']]);
});

test('a pinned package that the validation service no longer knows returns 503 without blocking', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  ctx.packages.remove('pkg-a');
  const unavailable = await ctx.next(id, 'c-1');
  assert.deepEqual([unavailable.status, unavailable.body.error], [503, 'governing_package_unavailable']);
  assert.equal((await ctx.call('GET', `/internal/sessions/${id}`)).body.session.status, 'open');
});

test('an Agent Learner cannot drive another learner session, and bad input is rejected before any write', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  const other = await ctx.call('POST', `/internal/sessions/${id}/continue`, { idempotencyKey: 'x', evidence: synthetic },
    { 'x-internal-service-key': KEY, 'x-actor-subject': 'learner-2' });
  assert.deepEqual([other.status, other.body.error], [403, 'identity_mismatch']);
  const fakeLive = await ctx.call('POST', `/internal/sessions/${id}/continue`,
    { idempotencyKey: 'y', evidence: { mode: 'synthetic', environment: 'live' } });
  assert.deepEqual([fakeLive.status, fakeLive.body.error], [400, 'invalid_request']);
  assert.equal((await ctx.next('not-a-uuid', 'z')).status, 404);
  assert.equal((await ctx.call('GET', '/internal/sessions/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('a unique-constraint collision is re-read and decided once more', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  const before = await ctx.eventCount(id);
  ctx.store.failNextAppend = 1;
  const shown = await ctx.next(id, 'c-1');
  assert.deepEqual([shown.status, shown.body.item.deliveryItemId], [200, 'm1-a']);
  assert.equal(await ctx.eventCount(id), before + 1);

  ctx.store.failNextAppend = 2;
  const gaveUp = await ctx.submit(id, 's-1', 'm1-a');
  assert.deepEqual([gaveUp.status, gaveUp.body.error], [409, 'concurrent_update']);
});

// --- Issue 13: practice, remediation, progress and metrics over HTTP.

const OPERATOR = { 'x-internal-service-key': KEY, 'x-actor-subject': 'operator-1' };
const remediationBody = (extra = {}) => ({
  requestId: 'req-1', agentLearnerKey: LEARNER, packageId: 'pkg-a', packageVersion: '1.0.0', objectiveIds: ['o2'],
  cause: { type: 'examination_failure', reference: 'attempt-7', evidenceDigest: `sha256:${'c'.repeat(64)}`,
    observedAt: '2026-10-07T09:00:00Z', summary: 'Failed the applied tier on objective o2' },
  evidence: synthetic, ...extra,
});

async function finish(ctx, id, prefix) {
  for (let n = 1; n < 20; n += 1) {
    const shown = await ctx.next(id, `${prefix}-c-${n}`);
    if (shown.body.status === 'completed' || !shown.body.item) return shown;
    const done = await ctx.submit(id, `${prefix}-s-${n}`, shown.body.item.deliveryItemId);
    if (done.body.status === 'completed') return done;
  }
  throw new Error('session did not complete');
}

test('a remediation request assigns targeted content that the learner then starts and completes', async (t) => {
  const ctx = await boot(t);
  const assigned = await ctx.call('POST', '/internal/remediations', remediationBody(), OPERATOR);
  assert.deepEqual([assigned.status, assigned.body.status, assigned.body.kind, assigned.body.plannedItems],
    [201, 'assigned', 'remediation', 1]);
  const id = assigned.body.sessionId;
  const replay = await ctx.call('POST', '/internal/remediations', remediationBody(), OPERATOR);
  assert.deepEqual([replay.status, replay.body.outcome, replay.body.sessionId], [200, 'replay', id]);
  const changed = await ctx.call('POST', '/internal/remediations', remediationBody({ objectiveIds: ['o1'] }), OPERATOR);
  assert.deepEqual([changed.status, changed.body.error], [409, 'remediation_request_conflict']);

  assert.deepEqual((await ctx.next(id, 'early')).body.error, 'session_not_started');
  const started = await ctx.start('rem-start');
  assert.deepEqual([started.status, started.body.sessionId, started.body.kind], [201, id, 'remediation']);
  const done = await finish(ctx, id, 'rem');
  assert.equal(done.body.status, 'completed');

  const detail = (await ctx.call('GET', `/internal/sessions/${id}`)).body;
  assert.equal(detail.session.remediation.cause.reference, 'attempt-7', 'the causing evidence is kept on the session');
  assert.equal(detail.session.remediation.requestedBy, 'operator-1');
  assert.deepEqual(detail.session.objectiveProgress, [
    { objectiveId: 'o2', plannedItems: 1, completedItems: 1, plannedPractice: 1, completedPractice: 1, complete: true }]);
  assert.deepEqual(detail.events.map((e) => e.eventType),
    ['remediation_assigned', 'session_started', 'item_delivered', 'item_completed', 'session_completed']);
});

test('remediation requests are validated and refused while another session is in progress', async (t) => {
  const ctx = await boot(t);
  const invalid = await ctx.call('POST', '/internal/remediations', remediationBody({ objectiveIds: [] }), OPERATOR);
  assert.deepEqual([invalid.status, invalid.body.error, invalid.body.details], [400, 'invalid_request', ['objectiveIds']]);
  const unknown = await ctx.call('POST', '/internal/remediations', remediationBody({ objectiveIds: ['o9'] }), OPERATOR);
  assert.deepEqual([unknown.status, unknown.body.error], [422, 'unknown_objectives']);
  const mismatch = await ctx.call('POST', '/internal/remediations', remediationBody({ packageVersion: '2.0.0' }), OPERATOR);
  assert.deepEqual([mismatch.status, mismatch.body.error], [409, 'package_mismatch']);

  await ctx.start();
  const busy = await ctx.call('POST', '/internal/remediations', remediationBody(), OPERATOR);
  assert.deepEqual([busy.status, busy.body.error], [409, 'session_in_progress']);
  assert.equal((await ctx.store.listSessions()).length, 1, 'nothing was written for a refused request');
});

test('completion emits exactly one completion event, readable from the outbox', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  await finish(ctx, id, 'std');
  const again = await ctx.submit(id, 'late', 'm2-a');
  assert.deepEqual([again.status, again.body.error], [409, 'session_completed']);
  const outbox = (await ctx.call('GET', '/internal/completion-events')).body.events;
  assert.deepEqual(outbox.map((e) => [e.eventId, e.sessionKind, e.completion.practiceCompleted]),
    [[`training.session.completed:${id}`, 'standard', 2]]);
});

test('submit enforces the response cap and refuses unexpected body fields', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start()).body.sessionId;
  const shown = await ctx.next(id, 'c-1');
  assert.equal(shown.body.bounds.maxResponseChars, 4000);
  const long = await ctx.submit(id, 's-long', 'm1-a', 'x'.repeat(4001));
  assert.deepEqual([long.status, long.body.error], [422, 'response_too_long']);
  const extra = await ctx.call('POST', `/internal/sessions/${id}/submit`,
    { idempotencyKey: 's-x', evidence: synthetic, deliveryItemId: 'm1-a', response: 'ok', weights: [1] });
  assert.deepEqual([extra.status, extra.body.details], [400, ['unexpected:weights']]);
  assert.equal((await ctx.submit(id, 's-ok', 'm1-a', 'x'.repeat(4000))).status, 200);
});

test('metrics count started, completed, remediated, resumed and aborted sessions', async (t) => {
  const ctx = await boot(t, { registry: createFakeRegistrySource([registration,
    { agentLearnerKey: 'learner-2', configurationFingerprint: 'sha256:config-2', configurationVersion: 1 },
    { agentLearnerKey: 'learner-3', configurationFingerprint: 'sha256:config-3', configurationVersion: 1 }]) });
  const as = (learner) => ({ 'x-internal-service-key': KEY, 'x-actor-subject': learner });
  const done = (await ctx.start()).body.sessionId;
  await ctx.start('resume-1');
  await finish(ctx, done, 'a');
  const learner2 = await ctx.call('POST', '/internal/sessions/start', { idempotencyKey: 'b', evidence: synthetic }, as('learner-2'));
  const blocked = learner2.body.sessionId;
  await ctx.call('POST', '/internal/remediations', remediationBody({ agentLearnerKey: 'learner-3' }), OPERATOR);
  ctx.packages.setState('pkg-a', 'Quarantined');
  await ctx.call('POST', `/internal/sessions/${blocked}/continue`, { idempotencyKey: 'b-1', evidence: synthetic }, as('learner-2'));

  const metrics = (await ctx.call('GET', '/internal/metrics')).body;
  assert.deepEqual(metrics.counts, { started: 2, completed: 1, remediated: 1, resumed: 1, aborted: 1, open: 0, assigned: 1 });
  assert.equal(metrics.completionRate, 0.5);
  assert.deepEqual(metrics.trace.completed, [done]);
  assert.deepEqual(metrics.trace.aborted, [blocked]);
  const list = (await ctx.call('GET', '/internal/sessions')).body.sessions;
  assert.equal(list.find((s) => s.sessionId === done).resumeCount, 1);
});
