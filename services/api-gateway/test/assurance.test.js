'use strict';

// Certification, credential and monitoring routes against stub upstreams.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-assurance-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-assurance-test';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'assurance-agent';
process.env.AGENT_CLIENT_SECRET = 'assurance-agent-secret';
process.env.ADMIN_CLIENT_ID = 'assurance-admin';
process.env.ADMIN_CLIENT_SECRET = 'assurance-admin-secret';

const { createApp: createGateway } = require('../index');

const CREDENTIAL_ID = '0b5c2d1e-1111-4222-8333-444455556666';
const ATTEMPT_ID = '9a8b7c6d-1111-4222-8333-444455556666';

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
const url = (server) => `http://127.0.0.1:${server.address().port}`;
function request(server, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } },
    (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function bearer(gateway, clientId, clientSecret) {
  const reply = await request(gateway, 'POST', '/v1/auth/tokens', { clientId, clientSecret });
  assert.equal(reply.status, 200);
  return { authorization: `Bearer ${reply.body.accessToken}` };
}

async function boot(t) {
  const seen = [];
  const upstream = express();
  upstream.use(express.json());
  upstream.use((req, res, next) => { seen.push({ method: req.method, path: req.path, headers: req.headers, body: req.body }); next(); });
  upstream.get('/internal/credentials', (req, res) => res.json({ apiVersion: 'v1', credentials: [{ credentialId: CREDENTIAL_ID }] }));
  upstream.get(`/internal/decisions/by-examination/${ATTEMPT_ID}`, (req, res) => res.json({ apiVersion: 'v1', outcome: 'found' }));
  upstream.post('/verify', (req, res) => res.json({ overall: 'VALID', reasonCodes: [] }));
  upstream.post('/status/:action', (req, res) => res.json({ credentialId: req.body.credentialId, status: req.params.action }));
  upstream.get('/snapshot', (req, res) => res.json({ assurancePosture: {} }));
  const stub = await listen(upstream);
  const gateway = await listen(createGateway({ certificationServiceUrl: url(stub), certificationInternalKey: 'cert-key',
    credentialVerificationUrl: url(stub), credentialInternalKey: 'cred-key', monitoringServiceUrl: url(stub) }));
  t.after(() => { gateway.close(); stub.close(); });
  return { gateway, seen };
}

test('admin reads certifications through the Gateway with a read-only gateway actor', async (t) => {
  const { gateway, seen } = await boot(t);
  const admin = await bearer(gateway, 'assurance-admin', 'assurance-admin-secret');
  const list = await request(gateway, 'GET', '/v1/admin/certifications?limit=5', undefined, admin);
  assert.equal(list.status, 200);
  assert.equal(list.body.credentials[0].credentialId, CREDENTIAL_ID);
  const call = seen.find((entry) => entry.path === '/internal/credentials');
  assert.equal(call.headers['x-actor-role'], 'gateway');
  assert.equal(call.headers['x-internal-service-key'], 'cert-key');
  assert.equal((await request(gateway, 'GET', `/v1/admin/certifications/by-examination/${ATTEMPT_ID}`, undefined, admin)).status, 200);
  assert.equal((await request(gateway, 'GET', '/v1/admin/certifications/by-examination/not-a-uuid', undefined, admin)).status, 400);
});

test('an agent cannot list certifications or change credential status', async (t) => {
  const { gateway } = await boot(t);
  const agent = await bearer(gateway, 'assurance-agent', 'assurance-agent-secret');
  assert.equal((await request(gateway, 'GET', '/v1/admin/certifications', undefined, agent)).status, 403);
  assert.equal((await request(gateway, 'POST', `/v1/admin/credentials/${CREDENTIAL_ID}/revoke`, { reason: 'x' }, agent)).status, 403);
  assert.equal((await request(gateway, 'GET', '/v1/admin/certifications')).status, 401);
});

test('any authenticated role may verify; only the jws is forwarded', async (t) => {
  const { gateway, seen } = await boot(t);
  const agent = await bearer(gateway, 'assurance-agent', 'assurance-agent-secret');
  const verified = await request(gateway, 'POST', '/v1/credentials/verify', { jws: 'a.b.c' }, agent);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.overall, 'VALID');
  assert.deepEqual(seen.find((entry) => entry.path === '/verify').body, { jws: 'a.b.c' });
  assert.equal((await request(gateway, 'POST', '/v1/credentials/verify', { jws: 'a.b.c', credentialId: 'x' }, agent)).status, 400);
});

test('status changes forward the internal key, actor and a required reason', async (t) => {
  const { gateway, seen } = await boot(t);
  const admin = await bearer(gateway, 'assurance-admin', 'assurance-admin-secret');
  const suspended = await request(gateway, 'POST', `/v1/admin/credentials/${CREDENTIAL_ID}/suspend`,
    { reason: 'investigation', agentLearnerKey: 'agent-1' }, admin);
  assert.equal(suspended.status, 200);
  const call = seen.find((entry) => entry.path === '/status/suspend');
  assert.equal(call.headers['x-internal-service-key'], 'cred-key');
  assert.equal(call.body.credentialId, CREDENTIAL_ID);
  assert.equal(call.body.agentId, 'agent-1');
  assert.match(call.body.reason, /investigation \(by assurance-admin\)/);
  assert.equal((await request(gateway, 'POST', `/v1/admin/credentials/${CREDENTIAL_ID}/suspend`, {}, admin)).status, 400);
  assert.equal((await request(gateway, 'POST', `/v1/admin/credentials/${CREDENTIAL_ID}/delete`, { reason: 'x' }, admin)).status, 400);
});

test('unconfigured upstreams answer 503 rather than guessing', async (t) => {
  const gateway = await listen(createGateway({ certificationServiceUrl: '', credentialVerificationUrl: '', monitoringServiceUrl: '' }));
  t.after(() => gateway.close());
  const admin = await bearer(gateway, 'assurance-admin', 'assurance-admin-secret');
  assert.equal((await request(gateway, 'GET', '/v1/admin/certifications', undefined, admin)).status, 503);
  assert.equal((await request(gateway, 'POST', '/v1/credentials/verify', { jws: 'a.b.c' }, admin)).status, 503);
  assert.equal((await request(gateway, 'GET', '/v1/admin/monitoring/snapshot', undefined, admin)).status, 503);
});
