'use strict';

// The registry's delivery incidents become valid Assurance Incidents (audit E9).

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIncident } = require('../../../packages/incident-log');
const { toIncident } = require('../incident-forwarding');

test('a delivery incident maps to a valid log incident with a stable id', () => {
  const incident = toIncident({ id: 7, category: 'integration', severity: 'major', affected_id: 'event-7', cause: 'automatic_attempts_exhausted',
    safe_state: 'quarantined', recovery_condition: 'operator_review_required', occurred_at: new Date('2026-11-16T12:00:00Z') });
  assert.equal(parseIncident({ ...incident, source: 'agent-registry' }).errors, undefined);
  assert.deepEqual([incident.sourceId, incident.severity, incident.kind], ['delivery:7', 'high', 'automatic_attempts_exhausted']);
});
