const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createRegistrationMessage, createLifecycleMessage } = require('../../external-agent-protocol');
const { runProtocolConformanceSuite } = require('../../external-agent-protocol/conformance');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-test';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'protocol-agent';
process.env.AGENT_CLIENT_SECRET = 'protocol-agent-secret';
process.env.ADMIN_CLIENT_ID = 'protocol-admin';
process.env.ADMIN_CLIENT_SECRET = 'protocol-admin-secret';

test('the gateway exposes the versioned protocol and routes provider-neutral registration to the registry', async (t) => {
  const registryRequests = [];
  const registry = await startRegistryStub(registryRequests);
  process.env.AGENT_REGISTRY_URL = `http://127.0.0.1:${registry.address().port}`;

  const { createApp } = require('../index');
  const gateway = http.createServer(createApp());
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.close());

  const token = await getToken(gateway, 'protocol-agent', 'protocol-agent-secret');
  const discovery = await request(gateway, 'GET', '/v1/agent-learner/protocol', undefined, {
    authorization: `Bearer ${token}`,
  });
  assert.equal(discovery.status, 200);
  assert.equal(discovery.body.protocol, 'ExternalAgentLearner');
  assert.equal(discovery.body.protocolVersion, '1.0.0');
  assert.equal(discovery.body.providerPolicy.allowlist, false);
  assert.deepEqual(discovery.body.evidenceModes.synthetic, {
    environment: 'simulation',
    label: 'SIMULATION: Synthetic Agent Learner',
  });

  const message = createRegistrationMessage({
    messageId: 'gateway-registration-message',
    correlationId: 'gateway-registration-correlation',
    idempotencyKey: 'gateway-registration-idempotency',
    timeoutMs: 2500,
    evidence: { mode: 'synthetic' },
    payload: registrationPayload('protocol-agent', 'any-provider'),
  });
  const response = await request(gateway, 'POST', '/v1/agent-learner/registrations', message, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': message.correlationId,
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.protocol.protocol, 'ExternalAgentLearner');
  assert.equal(response.body.protocol.messageId, message.messageId);
  assert.equal(response.body.protocol.correlationId, message.correlationId);
  assert.equal(response.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(registryRequests.length, 1);
  assert.equal(registryRequests[0].body.model.provider, 'any-provider');
  assert.equal(registryRequests[0].body.fingerprint, undefined);
  assert.equal(registryRequests[0].headers['x-correlation-id'], message.correlationId);
});

test('the reusable protocol conformance suite passes through the real gateway boundary', async (t) => {
  const registryRequests = [];
  const registry = await startRegistryStub(registryRequests);
  process.env.AGENT_REGISTRY_URL = `http://127.0.0.1:${registry.address().port}`;

  const { createApp } = require('../index');
  const gateway = http.createServer(createApp());
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.close());

  const token = await getToken(gateway, 'protocol-agent', 'protocol-agent-secret');
  const result = await runProtocolConformanceSuite({
    agentLearnerKey: 'protocol-agent',
    provider: 'future-provider-without-an-allowlist',
    send: async (message) => request(
      gateway,
      'POST',
      message.messageType === 'registration'
        ? '/v1/agent-learner/registrations'
        : '/v1/agent-learner/interactions',
      message,
      {
        authorization: `Bearer ${token}`,
        'x-correlation-id': message.correlationId,
      }
    ),
  });

  assert.equal(result.registration.status, 201);
  assert.equal(result.lifecycle.status, 202);
  assert.equal(registryRequests.length, 1);
});

test('authentication, identity, version, timeout, evidence, and payload failures fail closed before mutation', async (t) => {
  const registryRequests = [];
  const registry = await startRegistryStub(registryRequests);
  process.env.AGENT_REGISTRY_URL = `http://127.0.0.1:${registry.address().port}`;

  const { createApp } = require('../index');
  const gateway = http.createServer(createApp());
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.close());

  const token = await getToken(gateway, 'protocol-agent', 'protocol-agent-secret');
  const valid = createRegistrationMessage({
    messageId: 'failure-message',
    correlationId: 'failure-correlation',
    idempotencyKey: 'failure-idempotency',
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: registrationPayload('protocol-agent', 'provider-a'),
  });

  const noAuth = await request(gateway, 'POST', '/v1/agent-learner/registrations', valid);
  assert.equal(noAuth.status, 401);

  const mismatch = {
    ...valid,
    messageId: 'mismatch-message',
    idempotencyKey: 'mismatch-idempotency',
    payload: registrationPayload('another-agent', 'provider-a'),
  };
  const identityMismatch = await request(gateway, 'POST', '/v1/agent-learner/registrations', mismatch, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': mismatch.correlationId,
  });
  assert.equal(identityMismatch.status, 403);
  assert.equal(identityMismatch.body.error, 'identity_mismatch');
  assert.equal(identityMismatch.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');

  const unsupportedVersion = { ...valid, protocolVersion: '9.0.0', messageId: 'unsupported-version' };
  const versionResponse = await request(gateway, 'POST', '/v1/agent-learner/registrations', unsupportedVersion, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': unsupportedVersion.correlationId,
  });
  assert.equal(versionResponse.status, 400);
  assert.equal(versionResponse.body.error, 'unsupported_protocol_version');
  assert.equal(versionResponse.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');

  const invalidTimeout = { ...valid, timeoutMs: 0, messageId: 'invalid-timeout' };
  const timeoutResponse = await request(gateway, 'POST', '/v1/agent-learner/registrations', invalidTimeout, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': invalidTimeout.correlationId,
  });
  assert.equal(timeoutResponse.status, 400);
  assert.equal(timeoutResponse.body.error, 'invalid_timeout');

  const invalidEvidence = {
    ...valid,
    evidence: { mode: 'synthetic', environment: 'live' },
    messageId: 'invalid-evidence',
  };
  const evidenceResponse = await request(gateway, 'POST', '/v1/agent-learner/registrations', invalidEvidence, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': invalidEvidence.correlationId,
  });
  assert.equal(evidenceResponse.status, 400);
  assert.equal(evidenceResponse.body.error, 'invalid_evidence_environment');

  const malformedLifecycle = createLifecycleMessage({
    messageId: 'malformed-lifecycle',
    correlationId: 'malformed-lifecycle-correlation',
    idempotencyKey: 'malformed-lifecycle-idempotency',
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: {
      interactionType: 'training.submit',
       data: { agentLearnerKey: 'protocol-agent', response: 'malformed test response' },
    },
  });
  delete malformedLifecycle.payload.data;
  const lifecycleResponse = await request(gateway, 'POST', '/v1/agent-learner/interactions', malformedLifecycle, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': malformedLifecycle.correlationId,
  });
  assert.equal(lifecycleResponse.status, 400);
  assert.equal(lifecycleResponse.body.error, 'invalid_lifecycle_payload');
  assert.equal(lifecycleResponse.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(registryRequests.length, 0);
});

test('protocol registration idempotency replays failed upstream results and conflicts on changed content', async (t) => {
  const registryRequests = [];
  const registry = await startRegistryStub(registryRequests, { registrationStatus: 422 });
  process.env.AGENT_REGISTRY_URL = `http://127.0.0.1:${registry.address().port}`;

  const { createApp } = require('../index');
  const gateway = http.createServer(createApp());
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => registry.close());

  const token = await getToken(gateway, 'protocol-agent', 'protocol-agent-secret');
  const message = createRegistrationMessage({
    messageId: 'failed-registration-message',
    correlationId: 'failed-registration-correlation',
    idempotencyKey: 'failed-registration-idempotency',
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: registrationPayload('protocol-agent', 'provider-failure'),
  });

  const first = await request(gateway, 'POST', '/v1/agent-learner/registrations', message, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': message.correlationId,
  });
  const retry = await request(gateway, 'POST', '/v1/agent-learner/registrations', message, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': message.correlationId,
  });
  const changed = await request(gateway, 'POST', '/v1/agent-learner/registrations', {
    ...message,
    messageId: 'failed-registration-changed-message',
    payload: registrationPayload('protocol-agent', 'provider-changed'),
  }, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': message.correlationId,
  });

  assert.equal(first.status, 422);
  assert.equal(first.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.deepEqual(retry.body, first.body);
  assert.equal(retry.status, 422);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
  assert.equal(changed.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(registryRequests.filter((entry) => entry.url === '/v1/registrations').length, 1);
});

function registrationPayload(agentLearnerKey, provider) {
  return {
    agentLearnerKey,
    model: { provider, version: '1.0.0' },
    systemPromptHash: 'sha256:protocol-prompt-v1',
    approvedToolManifest: [],
    policyConfigurationHash: 'sha256:protocol-policy-v1',
    adapterVersion: 'protocol-adapter-1.0.0',
  };
}

async function startRegistryStub(requests, { registrationStatus = 201 } = {}) {
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && req.url === '/v1/registrations') {
      if (registrationStatus !== 201) {
        return sendJson(res, registrationStatus, {
          error: 'registry_rejected',
          message: 'stubbed registry rejection',
        });
      }
      return sendJson(res, 201, {
        apiVersion: 'v1',
        outcome: 'registered',
        status: 'created',
        registration: {
          agentLearnerId: '00000000-0000-4000-8000-000000000001',
          agentLearnerKey: body.agentLearnerKey,
          configurationVersion: 1,
          configurationFingerprint: 'sha256:registry-fingerprint',
          status: 'active',
        },
        assurance: {
          eventId: '00000000-0000-4000-8000-000000000002',
          eventType: 'agent_learner.registered',
          correlationId: req.headers['x-correlation-id'],
        },
        correlationId: req.headers['x-correlation-id'],
      });
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
  await listen(server);
  return server;
}

async function getToken(server, clientId, clientSecret) {
  const response = await request(server, 'POST', '/v1/auth/tokens', { clientId, clientSecret });
  assert.equal(response.status, 200);
  return response.body.accessToken;
}

function request(server, method, pathName, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({
      host: address.address,
      port: address.port,
      method,
      path: pathName,
      headers: {
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
