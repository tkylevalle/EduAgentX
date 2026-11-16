'use strict';

// The one Assurance Incident log (audit E9) and the Runtime Monitor's service
// side (target design 7.2), through their routes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/incidents');

const SERVICE_KEY = 'monitoring-service-key';
const GATEWAY_KEY = 'monitoring-gateway-key';
const HOUR_MS = 60 * 60 * 1000;

// A Credential Verification stand-in: suspension changes the status unless told to fail.
function credentials({ statuses = { 'cred-1': 'active' }, suspendWorks = true } = {}) {
  const state = { ...statuses };
  return { state, statusOf: async (id) => state[id] ?? null,
    suspend: async (id) => { if (suspendWorks && state[id] === 'active') state[id] = 'suspended'; } };
}

async function boot(t, { credentialStatus = credentials(), clock } = {}) {
  let time = Date.parse('2026-11-16T12:00:00Z');
  const now = clock || (() => new Date(time));
  const app = createApp({ store: createMemoryStore({ now }), internalKey: SERVICE_KEY, gatewayKey: GATEWAY_KEY, credentialStatus, now });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = async (method, path, body, headers) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers } });
    return { status: response.status, body: await response.json() };
  };
  return {
    app, credentialStatus, advance: (ms) => { time += ms; }, raw: send,
    service: (method, path, body, actor = 'training-service') => send(method, path, body, { 'x-internal-service-key': SERVICE_KEY, 'x-actor-subject': actor }),
    gateway: (method, path, body, actor, role) => send(method, path, body, { 'x-internal-service-key': GATEWAY_KEY, 'x-actor-subject': actor, 'x-actor-role': role }),
    spoof: (method, path, body, actor, role) => send(method, path, body, { 'x-internal-service-key': SERVICE_KEY, 'x-actor-subject': actor, 'x-actor-role': role }),
  };
}

const incident = { source: 'training-service', sourceId: 'event-1', severity: 'high', kind: 'delivery_exhausted',
  summary: 'Completion event could not be delivered.', occurredAt: '2026-11-16T12:00:00.000Z', safeState: 'quarantined' };

test('a service appends an incident once, as itself; only an admin through the Gateway reads and resolves it', async (t) => {
  const ctx = await boot(t);
  const first = await ctx.service('POST', '/internal/incidents', incident);
  assert.deepEqual([first.status, first.body.created], [201, true]);
  assert.equal((await ctx.service('POST', '/internal/incidents', incident)).status, 200, 'a repeat is the same incident');
  assert.equal((await ctx.service('POST', '/internal/incidents', incident, 'agent-registry')).status, 403, 'a service appends only as itself');
  assert.equal((await ctx.spoof('GET', '/internal/incidents', undefined, 'training-service', 'admin')).status, 403, 'the service key cannot claim a role');
  const [listed] = (await ctx.gateway('GET', '/internal/incidents', undefined, 'admin-1', 'admin')).body.incidents;
  assert.deepEqual([listed.safeState, listed.status], ['quarantined', 'open']);
  const update = (status, role = 'admin') => ctx.gateway('POST', `/internal/incidents/${first.body.incidentId}/updates`, { status, note: 'Redelivered by hand.' }, 'admin-1', role);
  assert.equal((await update('resolved', 'reviewer')).status, 403);
  assert.equal((await update('resolved')).body.incident.status, 'resolved');
  assert.equal((await update('acknowledged')).status, 409, 'a resolved incident stays resolved');
  assert.deepEqual((await ctx.gateway('GET', '/internal/incidents', undefined, 'admin-1', 'admin')).body.incidents, []);
});

test('the internal routes need a key and a named caller', async (t) => {
  const ctx = await boot(t);
  assert.equal((await ctx.raw('POST', '/internal/incidents', incident, { 'x-actor-subject': 'training-service' })).status, 403, 'no key');
  assert.equal((await ctx.raw('POST', '/internal/incidents', incident, { 'x-internal-service-key': 'wrong', 'x-actor-subject': 'training-service' })).status, 403, 'wrong key');
  assert.equal((await ctx.service('POST', '/internal/incidents', incident, '')).status, 400, 'no caller');
});

const telemetry = (overrides = {}) => ({ schemaVersion: 'runtime-telemetry/1.0.0', callId: randomUUID(), credentialId: 'cred-1', tool: 'send_reply',
  addresses: ['dana@example.com'], argsDigest: `sha256:${'a'.repeat(64)}`, findings: [], observedAt: '2026-11-16T12:00:00.000Z', ...overrides });
const manifest = { permittedTools: ['send_reply'], allowedRecipients: ['@example.com'] };
const register = (ctx, credentialId = 'cred-1') => ctx.gateway('POST', '/internal/runtime/manifests', { credentialId, agentId: 'agent-1', manifest }, 'admin-1', 'admin');

test('a critical runtime call records an incident and suspends the credential, confirmed by reading the status back', async (t) => {
  const ctx = await boot(t);
  assert.equal((await ctx.gateway('POST', '/internal/runtime/manifests', { credentialId: 'cred-1', agentId: 'agent-1', manifest }, 'admin-1', 'agent')).status, 403);
  assert.equal((await register(ctx, 'cred-unknown')).status, 409, 'only an active credential can be monitored');
  assert.equal((await register(ctx)).status, 201);
  assert.equal((await ctx.gateway('POST', '/internal/runtime/tool-calls', telemetry(), 'agent-2', 'agent')).status, 403, 'only the credential\'s own agent reports');
  assert.deepEqual((await ctx.gateway('POST', '/internal/runtime/tool-calls', telemetry(), 'agent-1', 'agent')).body, { verdict: 'allowed', findings: [] });
  const bad = await ctx.gateway('POST', '/internal/runtime/tool-calls', telemetry({ addresses: ['ops@exfil.example'] }), 'agent-1', 'agent');
  assert.deepEqual([bad.status, bad.body.verdict, bad.body.suspension, ctx.credentialStatus.state['cred-1']], [409, 'violation', 'suspended', 'suspended']);
  const [logged] = (await ctx.gateway('GET', '/internal/incidents', undefined, 'admin-1', 'admin')).body.incidents;
  assert.deepEqual([logged.source, logged.severity, logged.kind, logged.safeState], ['runtime-monitor', 'critical', 'runtime_violation', 'credential suspended']);
});

test('a suspension that does not take effect is reported as failed and recorded, never as done', async (t) => {
  const ctx = await boot(t, { credentialStatus: credentials({ suspendWorks: false }) });
  await register(ctx);
  const bad = await ctx.gateway('POST', '/internal/runtime/tool-calls', telemetry({ tool: 'export_orders', addresses: [] }), 'agent-1', 'agent');
  assert.equal(bad.body.suspension, 'failed');
  const kinds = (await ctx.gateway('GET', '/internal/incidents', undefined, 'admin-1', 'admin')).body.incidents.map((item) => item.kind).sort();
  assert.deepEqual(kinds, ['runtime_violation', 'suspension_failed']);
});

test('a monitored deployment that stops reporting is recorded as silent, once per window', async (t) => {
  const ctx = await boot(t);
  await register(ctx);
  await ctx.gateway('POST', '/internal/runtime/tool-calls', telemetry(), 'agent-1', 'agent');
  assert.equal(await ctx.app.locals.sweepSilence(), 0, 'reported just now');
  ctx.advance(2 * HOUR_MS);
  assert.equal(await ctx.app.locals.sweepSilence(), 1);
  await ctx.app.locals.sweepSilence();
  const silent = (await ctx.gateway('GET', '/internal/incidents', undefined, 'admin-1', 'admin')).body.incidents.filter((item) => item.kind === 'runtime_monitor_silent');
  assert.equal(silent.length, 1, 'the same window records one incident');
});
