'use strict';

// Training's delivery incidents become valid Assurance Incidents (audit E9).

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIncident } = require('../../../packages/incident-log');
const { startIncidentForwarding, toIncident } = require('../incident-forwarding');

const row = { eventId: 'training.session.completed:s-1', category: 'integration', severity: 'major', safeState: 'quarantined',
  causeCode: 'automatic_attempts_exhausted', correlationId: 'c-1', affected: {}, retryCount: 3, occurredAt: new Date('2026-11-16T12:00:00Z') };

test('a completion-delivery incident maps to a valid log incident with a stable id', () => {
  const incident = toIncident(row);
  assert.deepEqual(parseIncident({ ...incident, source: 'training-service' }).errors, undefined);
  assert.deepEqual([incident.sourceId, incident.severity, incident.kind], ['completion:training.session.completed:s-1', 'high', 'completion_delivery_failed']);
});

test('forwarding sends every listed incident, and is off without the log\'s address and key', async () => {
  assert.equal(startIncidentForwarding({ listCompletionIncidents: async () => [row] }, { env: {} }), null);
  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { status: 201, json: async () => ({ created: true }) }; };
  try {
    const forwarder = startIncidentForwarding({ listCompletionIncidents: async () => [row, { ...row, eventId: 'e-2' }] },
      { env: { MONITORING_SERVICE_URL: 'http://monitoring', MONITORING_INTERNAL_KEY: 'k', INCIDENT_FORWARD_INTERVAL_MS: '-1' } });
    assert.equal(await forwarder.runOnce(), 2);
    assert.deepEqual(sent.map((incident) => incident.source), ['training-service', 'training-service']);
  } finally { global.fetch = realFetch; }
});
