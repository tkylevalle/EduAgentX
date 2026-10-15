'use strict';

// Issue #21: a valid Agent-Failed standard attempt produces exactly one
// structured remediation event, linked to the exact weak objectives and the
// critical rules it broke, and the Training request built from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { REMEDIATION_EVENT_TYPE, remediationEventFor, trainingRequestFor } = require('../remediation');

const EVIDENCE = { mode: 'synthetic', environment: 'simulation' };
const items = [['r1', 'recall', 'o1'], ['a4', 'applied', 'o4'], ['v2', 'adversarial', 'o4'], ['v3', 'adversarial', 'o5']]
  .map(([id, tier, objective]) => ({ id, tier, objectiveIds: [objective] }));
function attempt(overrides = {}) {
  return { attemptId: '7d1c3c1e-0000-4000-8000-000000000001', agentLearnerKey: 'learner-1', mode: 'standard',
    configurationFingerprint: 'sha256:fp', package: { id: 'ai-safety', version: '0.1.6', digest: 'pkg-digest' },
    form: { items, training: { eventId: 'training.session.completed:s-1', sessionId: 's-1', sessionKind: 'standard',
      remediationRequestId: null, evidence: EVIDENCE } },
    status: 'agent_failed', terminalReason: 'valid_failing_result', failedAt: '2026-10-15T07:00:00.000Z',
    responses: items.map((item) => ({ itemId: item.id })), assessment: {
      failureReasons: ['critical_violation'], criticalViolationRuleIds: ['critical-o4'], failedObjectiveIds: ['o4'] },
    ...overrides };
}
const context = { now: '2026-10-15T07:00:00.000Z', correlationId: 'corr-failure', terminalEventId: 'grade:x:terminal' };

test('a graded failure names exactly its weak objectives and broken rules', () => {
  const event = remediationEventFor(attempt(), context);
  assert.equal(event.eventId, `${REMEDIATION_EVENT_TYPE}:${attempt().attemptId}`);
  assert.equal(event.eventType, 'examination.remediation.required');
  assert.deepEqual(event.gap, { objectiveIds: ['o4'], criticalViolationRuleIds: ['critical-o4'] });
  assert.deepEqual(event.failure.failureReasons, ['critical_violation']);
  assert.equal(event.failure.terminalEventId, 'grade:x:terminal');
  assert.match(event.failure.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(event.evidence, EVIDENCE);
  assert.equal(event.correlationId, 'corr-failure');
  assert.deepEqual(event.package, attempt().package);
});

test('the same failure always yields the same event id and digest', () => {
  assert.deepEqual(remediationEventFor(attempt(), context), remediationEventFor(attempt(), context));
});

test('a learner timeout names the objectives of the unanswered items', () => {
  const event = remediationEventFor(attempt({ terminalReason: 'response_deadline_elapsed', assessment: null,
    responses: [{ itemId: 'r1' }, { itemId: 'a4' }] }), context);
  assert.deepEqual(event.gap, { objectiveIds: ['o4', 'o5'], criticalViolationRuleIds: [] });
  assert.deepEqual(event.failure.failureReasons, ['response_deadline_elapsed']);
});

test('no event for a pass, a system abort, a fallback attempt or a failure with no structured gap', () => {
  for (const value of [attempt({ status: 'complete', terminalReason: 'valid_passing_result' }),
    attempt({ status: 'system_aborted', terminalReason: 'grading_unavailable' }),
    attempt({ mode: 'fallback' }),
    attempt({ assessment: null }),
    attempt({ form: { items, training: { eventId: 'e', sessionId: 's' } } })])
    assert.equal(remediationEventFor(value, context), null);
});

test('the Training request carries the event id as its request id and the exact gap', () => {
  const event = remediationEventFor(attempt(), context);
  const request = trainingRequestFor(event);
  assert.deepEqual(Object.keys(request).sort(),
    ['agentLearnerKey', 'cause', 'evidence', 'objectiveIds', 'packageId', 'packageVersion', 'requestId']);
  assert.equal(request.requestId, event.eventId);
  assert.deepEqual(request.objectiveIds, ['o4']);
  assert.deepEqual([request.cause.type, request.cause.reference, request.cause.evidenceDigest, request.cause.observedAt],
    ['examination_failure', event.attemptId, event.failure.evidenceDigest, event.occurredAt]);
  assert.match(request.cause.summary, /critical_violation/);
  assert.match(request.cause.summary, /critical-o4/);
  assert.ok(request.cause.summary.length <= 500);
});
