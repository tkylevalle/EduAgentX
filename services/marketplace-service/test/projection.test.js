'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCredentialEvent } = require('../projection');

const issued = {
  eventId: 'e1', eventType: 'credential.issued', credentialId: 'cred-1', agentLearnerKey: 'agent-a',
  occurredAt: '2026-09-18T00:00:00.000Z', credential: { overallPercent: 90 },
};
const next = (eventType, eventId, occurredAt, extra = {}) =>
  ({ eventId, eventType, credentialId: 'cred-1', agentLearnerKey: 'agent-a', occurredAt, ...extra });

test('issued creates an active record carrying the candidate fields', () => {
  const { applied, record } = applyCredentialEvent(null, issued);
  assert.equal(applied, true);
  assert.deepEqual(record, {
    credentialId: 'cred-1', agentLearnerKey: 'agent-a', status: 'active',
    candidate: { overallPercent: 90, credentialId: 'cred-1', agentLearnerKey: 'agent-a' },
    lastEventId: 'e1', lastOccurredAt: '2026-09-18T00:00:00.000Z',
  });
});

test('status transitions follow suspend, reinstate, supersede and revoke', () => {
  let { record } = applyCredentialEvent(null, issued);
  for (const [type, status, at] of [['credential.suspended', 'suspended', '2026-10-01'], ['credential.reinstated', 'active', '2026-10-02'],
    ['credential.superseded', 'superseded', '2026-10-03'], ['credential.revoked', 'revoked', '2026-10-04']]) {
    const result = applyCredentialEvent(record, next(type, `e-${status}`, `${at}T00:00:00.000Z`));
    assert.equal(result.applied, true, type);
    assert.equal(result.record.status, status, type);
    record = result.record;
  }
});

test('ignored events return the current record untouched with a reason', () => {
  const { record } = applyCredentialEvent(null, issued);
  const revoked = applyCredentialEvent(record, next('credential.revoked', 'e2', '2026-10-01T00:00:00.000Z')).record;
  const cases = [
    [null, next('credential.suspended', 'e9', '2026-10-01T00:00:00.000Z'), 'unknown_credential'],
    [record, { ...issued, eventId: 'e9' }, 'already_issued'],
    [record, next('credential.suspended', 'e9', '2026-09-01T00:00:00.000Z'), 'out_of_order'],
    [revoked, next('credential.reinstated', 'e9', '2026-10-02T00:00:00.000Z'), 'revoked_is_final'],
    [record, next('credential.reinstated', 'e9', '2026-10-02T00:00:00.000Z', { agentLearnerKey: 'agent-b' }), 'invalid_event'],
    [record, next('credential.renamed', 'e9', '2026-10-02T00:00:00.000Z'), 'invalid_event'],
    [record, next('credential.suspended', 'e9', 'not-a-date'), 'invalid_event'],
  ];
  const superseded = applyCredentialEvent(record, next('credential.superseded', 'e3', '2026-10-01T00:00:00.000Z')).record;
  cases.push([superseded, next('credential.reinstated', 'e9', '2026-10-02T00:00:00.000Z'), 'invalid_transition']);
  for (const [current, event, reason] of cases) {
    const result = applyCredentialEvent(current, event);
    assert.equal(result.applied, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(result.record, current, reason);
  }
});

test('applying an event never mutates the current record or the event', () => {
  const { record } = applyCredentialEvent(null, issued);
  const event = next('credential.suspended', 'e2', '2026-10-01T00:00:00.000Z');
  const before = structuredClone({ record, event });
  applyCredentialEvent(Object.freeze(record), Object.freeze(event));
  assert.deepEqual({ record, event }, before);
});
