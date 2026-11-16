'use strict';

// The Attention Queue and Release Gate routes against a stub upstream.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-continuous-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-continuous-test';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'continuous-agent';
process.env.AGENT_CLIENT_SECRET = 'continuous-agent-secret';
process.env.ADMIN_CLIENT_ID = 'continuous-admin';
process.env.ADMIN_CLIENT_SECRET = 'continuous-admin-secret';

const { createApp: createGateway } = require('../index');

const INCIDENT_ID = '0b5c2d1e-1111-4222-8333-444455556666';
const CURSOR = `2026-11-16T10:00:00.000Z,${INCIDENT_ID}`;

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
const url = (server) => `http://127.0.0.1:${server.address().port}`;

async function call(gateway, method, route, { body, headers = {} } = {}) {
  const reply = await fetch(`${url(gateway)}${route}`, { method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: reply.status, body: await reply.json() };
}

async function bearer(gateway, clientId, clientSecret) {
  const reply = await call(gateway, 'POST', '/v1/auth/tokens', { body: { clientId, clientSecret } });
  assert.equal(reply.status, 200);
  return { authorization: `Bearer ${reply.body.accessToken}` };
}

async function boot(t) {
  const seen = [];
  const upstream = express();
  upstream.use(express.json());
  upstream.use((req, res, next) => { seen.push({ method: req.method, url: req.originalUrl, headers: req.headers, body: req.body }); next(); });
  upstream.get('/internal/incidents', (req, res) => res.json({ incidents: [], next: null }));
  upstream.post('/internal/release-gate/checks', (req, res) => res.json({ decision: 'allow' }));
  const stub = await listen(upstream);
  const gateway = await listen(createGateway({ monitoringServiceUrl: url(stub), monitoringGatewayKey: 'monitoring-key',
    certificationServiceUrl: url(stub), certificationInternalKey: 'cert-key' }));
  t.after(() => { gateway.close(); stub.close(); });
  const admin = await bearer(gateway, 'continuous-admin', 'continuous-admin-secret');
  const agent = await bearer(gateway, 'continuous-agent', 'continuous-agent-secret');
  return { gateway, seen, admin, agent };
}

test('the Attention Queue passes a valid page size and cursor to monitoring, URL-encoded', async (t) => {
  const { gateway, seen, admin } = await boot(t);
  const reply = await call(gateway, 'GET', `/v1/admin/incidents?status=all&limit=25&before=${encodeURIComponent(CURSOR)}`, { headers: admin });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { incidents: [], next: null });
  assert.equal(seen[0].url, `/internal/incidents?status=all&limit=25&before=${encodeURIComponent(CURSOR)}`);
  await call(gateway, 'GET', '/v1/admin/incidents', { headers: admin });
  assert.equal(seen[1].url, '/internal/incidents?status=open', 'no paging parameters unless the caller sent them');
});

test('the Attention Queue refuses a bad page size or cursor before monitoring', async (t) => {
  const { gateway, seen, admin } = await boot(t);
  for (const query of ['limit=0', 'limit=501', 'limit=2.5', 'limit=ten', 'limit=1&limit=2',
    'before=yesterday', `before=${encodeURIComponent(`${INCIDENT_ID},2026-11-16T10:00:00.000Z`)}`,
    `before=${encodeURIComponent('2026-11-16T10:00:00.000Z,not-a-uuid')}`, `before=${encodeURIComponent(`${CURSOR}${'x'.repeat(80)}`)}`,
    `before=${encodeURIComponent(CURSOR)}&before=${encodeURIComponent(CURSOR)}`]) {
    const reply = await call(gateway, 'GET', `/v1/admin/incidents?${query}`, { headers: admin });
    assert.deepEqual([reply.status, reply.body.error], [400, 'invalid_request'], query);
  }
  assert.equal(seen.length, 0);
});

// Review finding 6: the Release Gate moved beside the other certification routes, unchanged.
test('the Release Gate check stays admin-only and reaches certification with the Gateway as actor', async (t) => {
  const { gateway, seen, admin, agent } = await boot(t);
  assert.equal((await call(gateway, 'POST', '/v1/release-gate/checks', { body: { agentId: 'a' }, headers: agent })).status, 403);
  const reply = await call(gateway, 'POST', '/v1/release-gate/checks', { body: { agentId: 'a' }, headers: admin });
  assert.deepEqual([reply.status, reply.body.decision], [200, 'allow']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/internal/release-gate/checks');
  assert.deepEqual(seen[0].body, { agentId: 'a' });
  assert.equal(seen[0].headers['x-internal-service-key'], 'cert-key');
  assert.equal(seen[0].headers['x-actor-subject'], 'continuous-admin');
  assert.equal(seen[0].headers['x-actor-role'], 'gateway');
});
