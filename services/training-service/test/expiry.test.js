'use strict';

// Abandoned sessions: an open session with no event for the configured time
// ends with session_blocked (session_timed_out), on its next request or by the sweep.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');
const { expireIdleSessions, sessionTimeoutFromEnv } = require('../expiry');

const KEY = 'internal-test-key';
const HOUR = 60 * 60 * 1000;
const TIMEOUT = 24 * HOUR;
const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const synthetic = { mode: 'synthetic', environment: 'simulation' };
const registration = (key) => ({ agentLearnerKey: key, configurationFingerprint: 'sha256:c', configurationVersion: 1 });
const payload = () => ({
  objectives: [{ id: 'o1', deliveryItemIds: ['m1-a', 'm1-p'] }],
  modules: [{ id: 'm1', sequence: 1, objectiveIds: ['o1'], deliveryItems: [
    { id: 'm1-a', kind: 'lesson', text: 'Lesson' }, { id: 'm1-p', kind: 'practice', text: 'Practice' }] }],
});

async function boot(t, { timeoutMs = TIMEOUT } = {}) {
  const ctx = { at: T0, store: createMemoryStore() };
  ctx.now = () => new Date(ctx.at).toISOString();
  const app = createApp({
    internalKey: KEY, store: ctx.store, clock: ctx.now, sessionTimeoutMs: timeoutMs,
    packageSource: createFakePackageSource([{ id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'd-1', payload: payload() }]),
    registrySource: createFakeRegistrySource([registration('learner-1'), registration('learner-2')]),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  ctx.call = async (method, path, body, learner = 'learner-1') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-internal-service-key': KEY, 'x-actor-subject': learner },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  ctx.start = (key, learner) => ctx.call('POST', '/internal/sessions/start', { idempotencyKey: key, evidence: synthetic }, learner);
  ctx.next = (id, key, learner) =>
    ctx.call('POST', `/internal/sessions/${id}/continue`, { idempotencyKey: key, evidence: synthetic }, learner);
  ctx.submit = (id, key, deliveryItemId, learner) => ctx.call('POST', `/internal/sessions/${id}/submit`,
    { idempotencyKey: key, evidence: synthetic, deliveryItemId, response: 'answer' }, learner);
  ctx.sweep = () => expireIdleSessions({ store: ctx.store, timeoutMs: timeoutMs, now: ctx.now() });
  return ctx;
}

test('an open session idle past the timeout ends as session_timed_out on its next request', async (t) => {
  const ctx = await boot(t);
  const id = (await ctx.start('s1')).body.sessionId;
  ctx.at = T0 + TIMEOUT - 1;
  assert.equal((await ctx.next(id, 'c1')).status, 200, 'activity inside the timeout keeps the session open');
  ctx.at += TIMEOUT + 1;
  const late = await ctx.next(id, 'c2');
  assert.deepEqual([late.status, late.body.error, late.body.reason], [409, 'training_blocked', 'session_timed_out']);

  const detail = await ctx.call('GET', `/internal/sessions/${id}`);
  assert.deepEqual([detail.body.session.status, detail.body.session.blockReason], ['blocked', 'session_timed_out']);
  const metrics = (await ctx.call('GET', '/internal/metrics')).body;
  assert.deepEqual([metrics.counts.open, metrics.counts.aborted, metrics.abortReasons], [0, 1, { session_timed_out: 1 }]);
});

test('start on an idle session ends it, and the next start opens a new session', async (t) => {
  const ctx = await boot(t);
  const first = (await ctx.start('s1')).body.sessionId;
  ctx.at = T0 + TIMEOUT + 1;
  const ended = await ctx.start('s2');
  assert.deepEqual([ended.status, ended.body.reason], [409, 'session_timed_out']);
  const fresh = await ctx.start('s3');
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.sessionId, first);
});

test('the sweep ends only open sessions idle past the timeout, once', async (t) => {
  const ctx = await boot(t);
  const idle = (await ctx.start('s1')).body.sessionId;
  const done = (await ctx.start('s1', 'learner-2')).body.sessionId;
  for (const [n, item] of [[1, 'm1-a'], [2, 'm1-p']]) {
    await ctx.next(done, `c${n}`, 'learner-2');
    await ctx.submit(done, `x${n}`, item, 'learner-2');
  }
  ctx.at = T0 + HOUR;
  assert.deepEqual(await ctx.sweep(), [], 'nothing is idle yet');
  ctx.at = T0 + TIMEOUT + HOUR;
  assert.deepEqual(await ctx.sweep(), [idle], 'the completed session is never touched');
  assert.deepEqual(await ctx.sweep(), [], 'a timed-out session is ended once');
  const events = (await ctx.store.readSession(idle)).events;
  assert.deepEqual(events.slice(-1).map((e) => [e.eventType, e.blockReason, e.actor, e.evidenceMode]),
    [['session_blocked', 'session_timed_out', 'training-service', 'synthetic']]);
});

test('one session that cannot be ended does not stop the sweep for the others', async (t) => {
  const ctx = await boot(t);
  const idle = (await ctx.start('s1')).body.sessionId;
  ctx.at = T0 + TIMEOUT + HOUR;
  const store = {
    ...ctx.store,
    listIdleOpenSessions: async (cutoff, limit) =>
      [{ sessionId: 'missing', agentLearnerKey: 'ghost' }, ...await ctx.store.listIdleOpenSessions(cutoff, limit)],
  };
  assert.deepEqual(await expireIdleSessions({ store, timeoutMs: TIMEOUT, now: ctx.now() }), [idle]);
});

test('a zero timeout turns expiry off', async (t) => {
  const ctx = await boot(t, { timeoutMs: 0 });
  const id = (await ctx.start('s1')).body.sessionId;
  ctx.at = T0 + 365 * TIMEOUT;
  assert.equal((await ctx.next(id, 'c1')).status, 200);
  assert.deepEqual(await ctx.sweep(), []);
});

test('TRAINING_SESSION_TIMEOUT_MINUTES defaults to 24 hours and refuses bad values', () => {
  assert.equal(sessionTimeoutFromEnv({}), TIMEOUT);
  assert.equal(sessionTimeoutFromEnv({ TRAINING_SESSION_TIMEOUT_MINUTES: '30' }), 30 * 60 * 1000);
  assert.equal(sessionTimeoutFromEnv({ TRAINING_SESSION_TIMEOUT_MINUTES: '0' }), 0);
  for (const bad of ['-1', '1.5', 'soon', '99999999999999']) {
    assert.throws(() => sessionTimeoutFromEnv({ TRAINING_SESSION_TIMEOUT_MINUTES: bad }), /TRAINING_SESSION_TIMEOUT_MINUTES/);
  }
});
