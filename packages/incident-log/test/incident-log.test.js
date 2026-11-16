'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIncidentReporter, forwardIncidents, parseIncident } = require('..');

const incident = { source: 'training-service', sourceId: 'event-1', severity: 'high', kind: 'delivery_exhausted',
  summary: 'Completion event could not be delivered.', subject: { sessionId: 'session-1' }, detail: { attempts: 5 }, occurredAt: '2026-11-16T12:00:00.000Z' };

test('an incident needs its source, id, severity, kind, summary and time, and nothing else', () => {
  assert.deepEqual(parseIncident(incident).incident, { ...incident, safeState: null, requiredAction: null, owner: null });
  const handled = { ...incident, safeState: 'quarantined', requiredAction: 'Redeliver after checking the stream.', owner: 'training-team' };
  assert.deepEqual(parseIncident(handled).incident, handled);
  assert.deepEqual(parseIncident({ ...incident, safeState: 'x'.repeat(201), owner: 'not an id' }).errors, ['safeState', 'owner']);
  assert.deepEqual(parseIncident({ ...incident, severity: 'low', extra: 1 }).errors, ['severity', 'unexpected:extra']);
  assert.deepEqual(parseIncident({ ...incident, subject: { customer: 'x' } }).errors, ['subject']);
  assert.deepEqual(parseIncident({ ...incident, detail: { blob: 'x'.repeat(9000) } }).errors, ['detail']);
});

test('the reporter appends as its own source, and forwarding re-sends safely', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => { posted.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { status: 201, json: async () => ({ created: true }) }; };
  const reporter = createIncidentReporter({ url: 'http://monitoring', key: 'k', source: 'training-service', fetchImpl });
  const { source, ...rest } = incident;
  const forwarder = forwardIncidents({ list: async () => [rest, rest], reporter, intervalMs: 0, onError: assert.fail });
  assert.equal(await forwarder.runOnce(), 2);
  assert.equal(posted[0].url, 'http://monitoring/internal/incidents');
  assert.equal(posted[0].headers['x-actor-subject'], 'training-service');
  assert.equal(posted[0].body.source, 'training-service');
  await assert.rejects(createIncidentReporter({ source: 'x' }).report(rest), /incident_log_not_configured/);
});
