'use strict';
// Grader labelling through the Gateway: a reviewer or admin labels under
// their own token subject, only an admin exports, and the body cannot name
// the labeller.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-test';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'labelling-fake-agent';
process.env.AGENT_CLIENT_SECRET = 'labelling-fake-agent-secret';
process.env.ADMIN_CLIENT_ID = 'labelling-fake-admin';
process.env.ADMIN_CLIENT_SECRET = 'labelling-fake-admin-secret';
process.env.REVIEWER_1_CLIENT_ID = 'labelling-fake-reviewer';
process.env.REVIEWER_1_CLIENT_SECRET = 'labelling-fake-reviewer-secret';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_ID = 'labelling-fake-operator';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_SECRET = 'labelling-fake-operator-secret';
// Tests pass this explicitly; a key from the developer's shell must not leak in.
delete process.env.CURRICULUM_INTERNAL_KEY;

const { createApp } = require('../index');

const CURRICULUM_KEY = 'labelling-internal-test-key';

// Answers every labelling path with 200 and records what reached it.
async function startStub() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests };
}

async function start(t) {
  const stub = await startStub();
  const gateway = http.createServer(createApp({ validationActivationUrl: `http://127.0.0.1:${stub.server.address().port}`,
    curriculumInternalKey: CURRICULUM_KEY }));
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => { gateway.close(); stub.server.close(); });
  const call = async (method, route, token, body) => {
    const address = gateway.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const token = async (clientId) => (await call('POST', '/v1/auth/tokens', null, { clientId, clientSecret: `${clientId}-secret` })).body.accessToken;
  return { call, token, requests: stub.requests };
}

test('a reviewer reads their queue and progress, and labels under their own subject', async (t) => {
  const { call, token, requests } = await start(t);
  const reviewer = await token('labelling-fake-reviewer');
  assert.equal((await call('GET', '/v1/grader-labels/next?limit=1', reviewer)).status, 200);
  assert.equal((await call('GET', '/v1/grader-labels/progress', reviewer)).status, 200);
  const posted = await call('POST', '/v1/grader-labels', reviewer,
    { itemKey: 'k1', acceptable: true, score: 80, safetyViolation: false, labeller: 'labelling-fake-other', extra: 'dropped' });
  assert.equal(posted.status, 201);
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), ['GET /grader-labels/next?limit=1', 'GET /grader-labels/progress', 'POST /grader-labels']);
  for (const request of requests) {
    assert.equal(request.headers['x-internal-service-key'], CURRICULUM_KEY);
    assert.equal(request.headers['x-actor-subject'], 'labelling-fake-reviewer');
    assert.equal(request.headers['x-actor-role'], 'reviewer');
  }
  assert.deepEqual(requests[2].body, { itemKey: 'k1', acceptable: true, score: 80, safetyViolation: false });
});

test('an admin may label and export; a reviewer may not export', async (t) => {
  const { call, token, requests } = await start(t);
  const admin = await token('labelling-fake-admin');
  const reviewer = await token('labelling-fake-reviewer');
  assert.equal((await call('GET', '/v1/grader-labels/next', admin)).status, 200);
  assert.equal((await call('GET', '/v1/admin/grader-labels/export', reviewer)).status, 403);
  assert.equal((await call('GET', '/v1/admin/grader-labels/export', admin)).status, 200);
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url} ${r.headers['x-actor-role']}`),
    ['GET /grader-labels/next admin', 'GET /grader-labels/export admin']);
});

test('other roles and anonymous callers never reach the labelling service', async (t) => {
  const { call, token, requests } = await start(t);
  for (const clientId of ['labelling-fake-agent', 'labelling-fake-operator']) {
    const other = await token(clientId);
    assert.equal((await call('GET', '/v1/grader-labels/next', other)).status, 403);
    assert.equal((await call('POST', '/v1/grader-labels', other, { itemKey: 'k1' })).status, 403);
  }
  assert.equal((await call('GET', '/v1/grader-labels/progress')).status, 401);
  assert.equal(requests.length, 0);
});

test('a bad batch size is refused at the Gateway', async (t) => {
  const { call, token, requests } = await start(t);
  const reviewer = await token('labelling-fake-reviewer');
  for (const limit of ['0', 'x', '1.5', '21']) assert.equal((await call('GET', `/v1/grader-labels/next?limit=${limit}`, reviewer)).status, 400, limit);
  assert.equal(requests.length, 0);
});
