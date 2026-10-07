'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summariseTraining } = require('../metrics');
const { parseRemediationRequest } = require('../remediation-request');

const row = (sessionId, kind, ...types) => ({
  session: { sessionId, kind },
  events: types.map((eventType, index) => ({
    seq: index + 1, eventType, blockReason: eventType === 'session_blocked' ? 'package_state:Quarantined' : null })),
});

test('summariseTraining counts each signal per session and traces it to session ids', () => {
  const metrics = summariseTraining([
    row('a', 'standard', 'session_started', 'item_delivered', 'item_completed', 'session_completed'),
    row('b', 'standard', 'session_started', 'session_resumed', 'session_resumed', 'item_delivered'),
    row('c', 'standard', 'session_started', 'session_blocked'),
    row('d', 'remediation', 'remediation_assigned'),
    row('e', 'remediation', 'remediation_assigned', 'session_started', 'item_completed', 'session_completed'),
  ]);
  assert.deepEqual(metrics.counts,
    { started: 4, completed: 2, remediated: 2, resumed: 1, aborted: 1, open: 1, assigned: 1 });
  assert.equal(metrics.completionRate, 0.5);
  assert.deepEqual(metrics.trace, {
    started: ['a', 'b', 'c', 'e'], completed: ['a', 'e'], remediated: ['d', 'e'], resumed: ['b'], aborted: ['c'],
    open: ['b'], assigned: ['d'] });
  assert.deepEqual(metrics.byKind, {
    standard: { sessions: 3, started: 3, completed: 1, completionRate: 0.3333 },
    remediation: { sessions: 2, started: 1, completed: 1, completionRate: 1 },
  });
  assert.deepEqual(metrics.abortReasons, { 'package_state:Quarantined': 1 });
});

test('the completion rate is null, not zero, before any session has started', () => {
  const metrics = summariseTraining([row('d', 'remediation', 'remediation_assigned')]);
  assert.equal(metrics.completionRate, null);
  assert.equal(summariseTraining([]).sessions, 0);
});

const valid = () => ({
  requestId: 'req-1', agentLearnerKey: 'learner-1', packageId: 'pkg-a', packageVersion: '1.0.0', objectiveIds: ['o2'],
  cause: { type: 'examination_failure', reference: 'attempt-7', evidenceDigest: `sha256:${'b'.repeat(64)}`,
    observedAt: '2026-10-07T09:00:00Z' },
  evidence: { mode: 'synthetic', environment: 'simulation' },
});

test('parseRemediationRequest keeps known fields and digests the content, not the requestId', () => {
  const { value } = parseRemediationRequest(valid());
  assert.equal(value.cause.summary, null);
  assert.match(value.requestDigest, /^sha256:[0-9a-f]{64}$/);
  const sameContent = parseRemediationRequest({ ...valid(), requestId: 'req-2' }).value;
  assert.equal(sameContent.requestDigest, value.requestDigest);
  const otherCause = parseRemediationRequest({ ...valid(), cause: { ...valid().cause, reference: 'attempt-8' } }).value;
  assert.notEqual(otherCause.requestDigest, value.requestDigest);
});

test('parseRemediationRequest lists every invalid or unexpected field', () => {
  const bad = {
    ...valid(), extra: true, requestId: '', objectiveIds: ['o1', 'o1'],
    cause: { type: 'whim', reference: 'r', evidenceDigest: 'sha256:short', observedAt: 'yesterday', summary: 'x'.repeat(501), note: 1 },
    evidence: { mode: 'synthetic', environment: 'live' },
  };
  assert.deepEqual(parseRemediationRequest(bad).details.sort(), [
    'cause.evidenceDigest', 'cause.observedAt', 'cause.summary', 'cause.type', 'evidence', 'objectiveIds', 'requestId',
    'unexpected:cause.note', 'unexpected:extra'].sort());
  assert.deepEqual(parseRemediationRequest(null).details, ['body']);
  assert.deepEqual(parseRemediationRequest({ ...valid(), objectiveIds: Array.from({ length: 21 }, (_, i) => `o${i}`) }).details,
    ['objectiveIds']);
});
