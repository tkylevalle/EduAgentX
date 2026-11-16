'use strict';

// The one Assurance Incident log (audit E9) and the Runtime Monitor's service
// side (target design 7.2), through their routes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/incidents');

const KEY = 'monitoring-test-key';

async function boot(t, { suspend } = {}) {
  const suspended = [];
  const credentialStatus = { suspend: suspend || (async (credentialId, reason, agentId) => { suspended.push({ credentialId, reason, agentId }); }) };
  const server = createApp({ store: createMemoryStore(), internalKey: KEY, credentialStatus }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = async (method, path, body, actor = 'training-service', role) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-internal-service-key': KEY, 'x-actor-subject': actor, ...(role ? { 'x-actor-role': role } : {}) } });
    return { status: response.status, body: await response.json() };
  };
  return { call, suspended };
}

const incident = { source: 'training-service', sourceId: 'event-1', severity: 'high', kind: 'delivery_exhausted',
  summary: 'Completion event could not be delivered.', occurredAt: '2026-11-16T12:00:00.000Z' };

test('a service appends an incident once, as itself, and an admin resolves it by appending an update', async (t) => {
  const { call } = await boot(t);
  const first = await call('POST', '/internal/incidents', incident);
  assert.deepEqual([first.status, first.body.created], [201, true]);
  assert.deepEqual([(await call('POST', '/internal/incidents', incident)).status], [200], 'a repeat is the same incident');
  assert.equal((await call('POST', '/internal/incidents', incident, 'agent-registry')).status, 403, 'a service appends only as itself');
  assert.equal((await call('GET', '/internal/incidents')).body.incidents.length, 1);
  const update = (status, role = 'admin') => call('POST', `/internal/incidents/${first.body.incidentId}/updates`, { status, note: 'Redelivered by hand.' }, 'admin-1', role);
  assert.equal((await update('resolved', 'reviewer')).status, 403);
  assert.equal((await update('resolved')).body.incident.status, 'resolved');
  assert.equal((await update('acknowledged')).status, 409, 'a resolved incident stays resolved');
  assert.deepEqual((await call('GET', '/internal/incidents')).body.incidents, [], 'resolved incidents leave the Attention Queue');
  assert.equal((await call('GET', '/internal/incidents?status=all')).body.incidents[0].updates.length, 1);
});

test('the internal routes need the monitoring key and a named caller', async (t) => {
  const server = createApp({ store: createMemoryStore(), internalKey: KEY }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = (headers) => fetch(`http://127.0.0.1:${server.address().port}/internal/incidents`, { method: 'POST', body: JSON.stringify(incident),
    headers: { 'content-type': 'application/json', ...headers } }).then((response) => response.status);
  assert.equal(await post({ 'x-actor-subject': 'training-service' }), 403, 'no key');
  assert.equal(await post({ 'x-internal-service-key': 'wrong', 'x-actor-subject': 'training-service' }), 403, 'wrong key');
  assert.equal(await post({ 'x-internal-service-key': KEY }), 400, 'no caller');
});

const telemetry = (overrides = {}) => ({ schemaVersion: 'runtime-telemetry/1.0.0', callId: randomUUID(), credentialId: 'cred-1', tool: 'send_reply',
  addresses: ['dana@example.com'], argsDigest: `sha256:${'a'.repeat(64)}`, findings: [], observedAt: '2026-11-16T12:00:00.000Z', ...overrides });

test('a critical runtime call records an incident and suspends the credential; a clean one is allowed', async (t) => {
  const { call, suspended } = await boot(t);
  const manifest = { permittedTools: ['send_reply'], allowedRecipients: ['@example.com'] };
  assert.equal((await call('POST', '/internal/runtime/manifests', { credentialId: 'cred-1', agentId: 'agent-1', manifest }, 'admin-1', 'agent')).status, 403);
  assert.equal((await call('POST', '/internal/runtime/manifests', { credentialId: 'cred-1', agentId: 'agent-1', manifest }, 'admin-1', 'admin')).status, 201);
  assert.equal((await call('POST', '/internal/runtime/tool-calls', telemetry(), 'agent-2')).status, 403, 'only the credential\'s own agent reports');
  assert.deepEqual((await call('POST', '/internal/runtime/tool-calls', telemetry(), 'agent-1')).body, { verdict: 'allowed', findings: [] });
  const bad = await call('POST', '/internal/runtime/tool-calls', telemetry({ addresses: ['ops@exfil.example'] }), 'agent-1');
  assert.deepEqual([bad.status, bad.body.verdict, bad.body.suspension], [409, 'violation', 'suspended']);
  assert.deepEqual(suspended.map((item) => [item.credentialId, item.agentId]), [['cred-1', 'agent-1']]);
  const [logged] = (await call('GET', '/internal/incidents')).body.incidents;
  assert.deepEqual([logged.source, logged.severity, logged.kind, logged.subject.credentialId], ['runtime-monitor', 'critical', 'runtime_violation', 'cred-1']);
  assert.equal((await call('POST', '/internal/runtime/tool-calls', telemetry({ credentialId: 'cred-unknown' }), 'agent-1')).status, 404);
});

test('a failed suspension is recorded as its own critical incident, not lost', async (t) => {
  const { call } = await boot(t, { suspend: async () => { throw Object.assign(new Error('down'), { code: 'status_503' }); } });
  await call('POST', '/internal/runtime/manifests', { credentialId: 'cred-1', agentId: 'agent-1', manifest: { permittedTools: ['send_reply'], allowedRecipients: [] } }, 'admin-1', 'admin');
  const bad = await call('POST', '/internal/runtime/tool-calls', telemetry({ tool: 'export_orders', addresses: [] }), 'agent-1');
  assert.equal(bad.body.suspension, 'failed');
  assert.deepEqual((await call('GET', '/internal/incidents')).body.incidents.map((item) => item.kind).sort(), ['runtime_violation', 'suspension_failed']);
});
