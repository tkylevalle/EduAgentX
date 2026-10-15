'use strict';

// Issue #21: the relay sends each pending remediation event to Training once,
// keyed by the event id, and records one final outcome. Retryable conditions
// leave the event pending; a refusal is recorded and never retried.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemediationRelay } = require('../remediation-relay');
const { trainingRequestFor } = require('../remediation');

const EVENT = Object.freeze({ eventId: 'examination.remediation.required:a-1', eventType: 'examination.remediation.required',
  schemaVersion: '1.0.0', occurredAt: '2026-10-15T07:00:00.000Z', correlationId: 'corr-failure', attemptId: 'a-1',
  agentLearnerKey: 'learner-1', configurationFingerprint: 'sha256:fp', package: { id: 'ai-safety', version: '0.1.6', digest: 'd' },
  failure: { terminalReason: 'valid_failing_result', terminalEventId: 'grade:a-1:terminal', failureReasons: ['critical_violation'],
    evidenceDigest: `sha256:${'a'.repeat(64)}` },
  gap: { objectiveIds: ['o4'], criticalViolationRuleIds: ['critical-o4'] }, evidence: { mode: 'synthetic', environment: 'simulation' } });

function fakeStore(events = [EVENT]) {
  const deliveries = [];
  const store = { deliveries, claims: [],
    claimPendingRemediations: async ({ now, limit }) => {
      store.claims.push({ now, limit });
      return events.filter((e) => !deliveries.some((d) => d.eventId === e.eventId));
    },
    recordRemediationDelivery: async (delivery) => { deliveries.push(delivery); return delivery; } };
  return store;
}

function fakeTraining(status, body) {
  const fetchImpl = async (url, init) => {
    fetchImpl.calls.push({ url, init, body: JSON.parse(init.body) });
    if (status instanceof Error) throw status;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

const relay = (store, fetchImpl) => createRemediationRelay({ store, url: 'http://training.test', key: 'training-key',
  clock: () => '2026-10-15T07:00:05.000Z', fetchImpl });

test('a created remediation session is recorded as delivered with its session id', async () => {
  const store = fakeStore();
  const training = fakeTraining(201, { apiVersion: 'v1', outcome: 'ok', sessionId: 'remediation-1', status: 'assigned' });
  assert.deepEqual(await relay(store, training).sweep(), { delivered: 1, refused: 0, retrying: 0 });
  const [call] = training.calls;
  assert.equal(call.url, 'http://training.test/internal/remediations');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual([call.init.headers['x-internal-service-key'], call.init.headers['x-actor-subject'],
    call.init.headers['x-correlation-id']], ['training-key', 'examination-engine', 'corr-failure']);
  assert.deepEqual(call.body, trainingRequestFor(EVENT));
  assert.deepEqual(store.deliveries, [{ eventId: EVENT.eventId, outcome: 'delivered', trainingSessionId: 'remediation-1',
    detail: { status: 201, outcome: 'ok' }, recordedAt: '2026-10-15T07:00:05.000Z' }]);
});

test('a replayed request (200) is also delivered', async () => {
  const store = fakeStore();
  await relay(store, fakeTraining(200, { outcome: 'replay', sessionId: 'remediation-1' })).sweep();
  assert.equal(store.deliveries[0].outcome, 'delivered');
});

test('busy learner, concurrent update, outage and network error stay pending', async () => {
  for (const [status, body] of [[409, { error: 'session_in_progress' }], [409, { error: 'concurrent_update' }],
    [503, { error: 'dependency_unavailable' }], [500, { error: 'internal_error' }], [new Error('ECONNREFUSED'), null],
    [403, { error: 'forbidden' }], [201, { outcome: 'ok' }], [409, { error: 'package_not_active' }],
    [409, { error: 'training_blocked' }], [404, null], [408, null], [422, { error: 'some_future_reason' }]]) {
    const store = fakeStore();
    assert.deepEqual(await relay(store, fakeTraining(status, body)).sweep(), { delivered: 0, refused: 0, retrying: 1 },
      `status ${status} ${body?.error}`);
    assert.deepEqual(store.deliveries, []);
  }
});

test('a Training refusal is recorded once as refused with its reason', async () => {
  for (const [status, error] of [[422, 'no_targeted_content'], [403, 'not_registered'], [409, 'package_mismatch'],
    [409, 'remediation_request_conflict'], [400, 'invalid_request'], [409, 'package_not_deliverable'],
    [409, 'insufficient_practice']]) {
    const store = fakeStore();
    assert.deepEqual(await relay(store, fakeTraining(status, { error })).sweep(), { delivered: 0, refused: 1, retrying: 0 });
    assert.deepEqual(store.deliveries[0], { eventId: EVENT.eventId, outcome: 'refused', trainingSessionId: null,
      detail: { status, error }, recordedAt: '2026-10-15T07:00:05.000Z' });
  }
});

test('the relay is off without a Training URL or key', () => {
  assert.equal(createRemediationRelay({ store: fakeStore(), url: 'http://training.test', key: '' }), null);
  assert.equal(createRemediationRelay({ store: fakeStore(), url: '', key: 'k' }), null);
});

test('the relay claims a bounded batch at the relay clock', async () => {
  const store = fakeStore();
  await relay(store, fakeTraining(201, { outcome: 'ok', sessionId: 's' })).sweep();
  assert.deepEqual(store.claims, [{ now: '2026-10-15T07:00:05.000Z', limit: 20 }]);
});
