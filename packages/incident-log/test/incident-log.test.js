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

// A reporter that refuses the incidents named in `refused` and records the rest.
function fakeReporter(refused = new Set()) {
  const sent = [];
  return { sent, report: async (value) => {
    if (refused.has(value.sourceId)) throw new Error(`incident_log_refused_400 ${value.sourceId}`);
    sent.push(value.sourceId);
    return { created: true };
  } };
}

test('one refused incident is reported to onError and does not stop the ones after it', async () => {
  const errors = [];
  const reporter = fakeReporter(new Set(['event-1']));
  const list = async () => ['event-1', 'event-2', 'event-3'].map((sourceId) => ({ ...incident, sourceId }));
  const forwarder = forwardIncidents({ list, reporter, intervalMs: 0, onError: (error) => errors.push(error.message) });
  assert.equal(await forwarder.runOnce(), 2);
  assert.deepEqual(reporter.sent, ['event-2', 'event-3']);
  assert.deepEqual(errors, ['incident_log_refused_400 event-1']);
});

test('a later run sends only what earlier runs did not deliver', async () => {
  const refused = new Set(['event-1']);
  const reporter = fakeReporter(refused);
  let listed = ['event-1', 'event-2'];
  const forwarder = forwardIncidents({ list: async () => listed.map((sourceId) => ({ ...incident, sourceId })), reporter, intervalMs: 0, onError: () => {} });
  await forwarder.runOnce();
  refused.clear();
  listed = ['event-3', 'event-1', 'event-2'];
  assert.equal(await forwarder.runOnce(), 2);
  assert.deepEqual(reporter.sent, ['event-2', 'event-3', 'event-1'], 'event-2 is not sent again; the refused event-1 is retried');
});

test('a run that starts while one is in flight joins it instead of overlapping', async () => {
  let release;
  let lists = 0;
  const reporter = fakeReporter();
  const list = async () => { lists += 1; await new Promise((resolve) => { release = resolve; }); return [incident]; };
  const forwarder = forwardIncidents({ list, reporter, intervalMs: 0, onError: assert.fail });
  const first = forwarder.runOnce();
  const second = forwarder.runOnce();
  await new Promise(setImmediate);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(lists, 1);
  assert.deepEqual(reporter.sent, ['event-1']);
});
