const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const jwt = require('jsonwebtoken');

const keyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'eduagentx-security-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const privateKeyPath = path.join(keyDirectory, 'private.pem');
const publicKeyPath = path.join(keyDirectory, 'public.pem');
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

process.env.JWT_PRIVATE_KEY_PATH = privateKeyPath;
process.env.JWT_PUBLIC_KEY_PATH = publicKeyPath;
process.env.JWT_ISSUER = 'eduagentx-security-test';
process.env.JWT_AUDIENCE = 'eduagentx-security-audience';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.AGENT_CLIENT_ID = 'security-agent';
process.env.AGENT_CLIENT_SECRET = 'security-agent-secret';
process.env.ADMIN_CLIENT_ID = 'security-admin';
process.env.ADMIN_CLIENT_SECRET = 'security-admin-secret';

const { createLifecycleMessage } = require('../../external-agent-protocol');
const { createApp } = require('../index');

test.after(() => fs.rmSync(keyDirectory, { recursive: true, force: true }));

test('JWT verification rejects expired, wrong-issuer, wrong-audience, and wrong-algorithm tokens', async (t) => {
  const registry = await startRegistryStub();
  const gateway = http.createServer(createApp({ agentRegistryUrl: registry.url }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.server.close());

  const invalidTokens = [
    signToken({ expiresIn: -10 }),
    signToken({ issuer: 'wrong-issuer' }),
    signToken({ audience: 'wrong-audience' }),
    jwt.sign(
      { role: 'agent', sub: 'security-agent', iss: process.env.JWT_ISSUER, aud: process.env.JWT_AUDIENCE },
      'not-the-rsa-key',
      { algorithm: 'HS256', expiresIn: 900 }
    ),
  ];

  for (const token of invalidTokens) {
    const response = await request(gateway, 'GET', '/v1/agent-learner/protocol', undefined, {
      authorization: `Bearer ${token}`,
    });
    assert.equal(response.status, 401);
    assert.match(response.body.error, /token|unauthorized/);
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(escapeRegExp(token)));
    assert.doesNotMatch(JSON.stringify(response.body), /BEGIN (RSA )?PRIVATE KEY/);
  }
});

test('role boundaries reject cross-role access before Registry dispatch', async (t) => {
  const registry = await startRegistryStub();
  const gateway = http.createServer(createApp({ agentRegistryUrl: registry.url }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.server.close());

  const agentToken = signToken({ role: 'agent', subject: 'security-agent' });
  const adminToken = signToken({ role: 'admin', subject: 'security-admin' });

  const agentOnAdmin = await request(gateway, 'GET', '/v1/admin/whoami', undefined, {
    authorization: `Bearer ${agentToken}`,
  });
  assert.equal(agentOnAdmin.status, 403);

  const adminOnAgent = await request(gateway, 'POST', '/v1/registrations', registrationPayload(), {
    authorization: `Bearer ${adminToken}`,
  });
  assert.equal(adminOnAgent.status, 403);
  assert.equal(registry.requests.length, 0);
});

test('credential rejection, malformed JSON, and oversized payloads fail closed without leaking secrets', async (t) => {
  const registry = await startRegistryStub();
  const gateway = http.createServer(createApp({ agentRegistryUrl: registry.url }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.server.close());

  const rejectedSecret = 'do-not-echo-this-client-secret';
  const invalidClient = await request(gateway, 'POST', '/v1/auth/tokens', {
    clientId: 'security-agent',
    clientSecret: rejectedSecret,
  });
  assert.equal(invalidClient.status, 401);
  assert.doesNotMatch(JSON.stringify(invalidClient.body), new RegExp(rejectedSecret));

  const malformed = await rawRequest(gateway, 'POST', '/v1/auth/tokens', '{not-json', {
    'content-type': 'application/json',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'invalid_request');

  const oversized = await rawRequest(
    gateway,
    'POST',
    '/v1/auth/tokens',
    JSON.stringify({ clientId: 'security-agent', clientSecret: 'x'.repeat(70 * 1024) }),
    { 'content-type': 'application/json' }
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error, 'payload_too_large');
  assert.equal(registry.requests.length, 0);
});

test('lifecycle responses preserve evidence labels without echoing private responses or issuing credentials', async (t) => {
  const registry = await startRegistryStub();
  const gateway = http.createServer(createApp({ agentRegistryUrl: registry.url }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.server.close());

  const privateResponse = 'PRIVATE_RESPONSE_MUST_NOT_BE_ECHOED';
  const message = createLifecycleMessage({
    messageId: 'security-lifecycle-message',
    correlationId: 'security-lifecycle-correlation',
    idempotencyKey: 'security-lifecycle-idempotency',
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: {
      interactionType: 'training.submit',
      data: { agentLearnerKey: 'security-agent', response: privateResponse },
    },
  });
  const token = signToken({ role: 'agent', subject: 'security-agent' });
  const response = await request(gateway, 'POST', '/v1/agent-learner/interactions', message, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': message.correlationId,
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.credentialIssued, false);
  assert.equal(response.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(privateResponse));
});

test('dependency health failures time out and redact upstream details', async (t) => {
  const protectedDetail = 'postgres://user:password@internal-host/database';
  const registry = await startRegistryStub({
    healthStatus: 503,
    healthBody: { error: protectedDetail },
    healthDelayMs: 3000,
  });
  const gateway = http.createServer(createApp({ agentRegistryUrl: registry.url }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.server.close());

  const started = Date.now();
  const response = await request(gateway, 'GET', '/health');
  assert.equal(response.status, 503);
  assert.ok(Date.now() - started < 2500, 'Gateway health must bound dependency wait time');
  assert.equal(response.body.error, 'dependency_unavailable');
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(escapeRegExp(protectedDetail)));
});

function signToken({
  role = 'agent',
  subject = 'security-agent',
  issuer = process.env.JWT_ISSUER,
  audience = process.env.JWT_AUDIENCE,
  expiresIn = 900,
} = {}) {
  return jwt.sign({ role }, privateKey, {
    algorithm: 'RS256',
    subject,
    issuer,
    audience,
    expiresIn,
  });
}

function registrationPayload() {
  return {
    agentLearnerKey: 'security-agent',
    model: { provider: 'synthetic', version: '1.0.0' },
    systemPromptHash: 'sha256:security-prompt',
    approvedToolManifest: [],
    policyConfigurationHash: 'sha256:security-policy',
    adapterVersion: 'security-adapter-1.0.0',
  };
}

async function startRegistryStub({
  healthStatus = 200,
  healthBody = { status: 'ok' },
  healthDelayMs = 0,
} = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.method === 'GET' && req.url === '/health') {
      if (healthDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, healthDelayMs));
      return sendJson(res, healthStatus, healthBody);
    }
    return sendJson(res, 501, { error: 'unexpected_registry_dispatch' });
  });
  await listen(server);
  return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}

function request(server, method, requestPath, body, headers = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  return rawRequest(server, method, requestPath, raw, {
    ...(raw === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  });
}

function rawRequest(server, method, requestPath, raw, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method,
      path: requestPath,
      headers,
    }, (res) => {
      let responseText = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseText += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { raw: responseText }; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
