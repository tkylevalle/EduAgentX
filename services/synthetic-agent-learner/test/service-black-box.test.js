const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../index');
const { GatewayProtocolClient } = require('../gateway-client');
const { createSyntheticAgentLearner } = require('../learner');

test('the synthetic service drives registration and lifecycle interaction through the gateway HTTP client', async (t) => {
  const gatewayRequests = [];
  const gateway = await startGatewayStub(gatewayRequests);
  const client = new GatewayProtocolClient({
    gatewayUrl: `http://127.0.0.1:${gateway.address().port}`,
    clientId: 'synthetic-agent-learner-dev',
    clientSecret: 'synthetic-secret',
  });
  const learner = createSyntheticAgentLearner({ gatewayClient: client });
  const service = http.createServer(createApp({ learner }));
  await listen(service);
  t.after(() => service.close());
  t.after(() => gateway.close());

  const response = await request(service, 'POST', '/v1/runs', {
    profileId: 'competent',
    agentLearnerKey: 'synthetic-agent-learner-dev',
    correlationId: 'synthetic-service-correlation',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.outcome, 'accepted');
  assert.equal(response.body.safeState, 'awaiting_lifecycle_owner');
  assert.equal(response.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(response.body.credentialIssued, false);
  assert.deepEqual(gatewayRequests.map((item) => item.path), [
    '/v1/auth/tokens',
    '/v1/agent-learner/registrations',
    '/v1/agent-learner/interactions',
  ]);
  assert.equal(gatewayRequests[1].headers.authorization.startsWith('Bearer '), true);
  assert.equal(gatewayRequests[1].body.payload.agentLearnerKey, 'synthetic-agent-learner-dev');
  assert.equal(gatewayRequests[2].body.payload.data.agentLearnerKey, 'synthetic-agent-learner-dev');
});

test('synthetic failure profiles retain safe public outcomes and never claim credentials', async (t) => {
  const gatewayRequests = [];
  const gateway = await startGatewayStub(gatewayRequests);
  const client = new GatewayProtocolClient({
    gatewayUrl: `http://127.0.0.1:${gateway.address().port}`,
    clientId: 'synthetic-agent-learner-dev',
    clientSecret: 'synthetic-secret',
  });
  const learner = createSyntheticAgentLearner({ gatewayClient: client });
  const service = http.createServer(createApp({ learner }));
  await listen(service);
  t.after(() => service.close());
  t.after(() => gateway.close());

  for (const [profileId, expectedOutcome, expectedReason] of [
    ['malformed', 'agent_failed', 'malformed_response'],
    ['inconsistent', 'agent_failed', 'inconsistent_response'],
    ['timing-out', 'agent_failed', 'agent_timeout'],
    ['unavailable', 'system_aborted', 'learner_unavailable'],
  ]) {
    const response = await request(service, 'POST', '/v1/runs', {
      profileId,
      agentLearnerKey: 'synthetic-agent-learner-dev',
      correlationId: `synthetic-${profileId}`,
    });

    assert.equal(response.body.outcome, expectedOutcome);
    assert.equal(response.body.reason, expectedReason);
    assert.equal(response.body.safeState, 'blocked');
    assert.equal(response.body.credentialIssued, false);
  }
});

async function startGatewayStub(requests) {
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ path: req.url, headers: req.headers, body });
    if (req.method === 'POST' && req.url === '/v1/auth/tokens') {
      return sendJson(res, 200, { accessToken: 'gateway-token' });
    }
    if (req.method === 'POST' && req.url === '/v1/agent-learner/registrations') {
      return sendJson(res, 201, {
        registration: { agentLearnerId: 'synthetic-learner-id' },
        protocol: protocolMetadata(body),
      });
    }
    if (req.method === 'POST' && req.url === '/v1/agent-learner/interactions') {
       return sendJson(res, 202, {
         status: 'accepted',
         safeState: 'awaiting_lifecycle_owner',
         protocol: protocolMetadata(body),
       });
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
  await listen(server);
  return server;
}

function protocolMetadata(message) {
  return {
    protocol: message.protocol,
    protocolVersion: message.protocolVersion,
    messageType: message.messageType,
    messageId: message.messageId,
    correlationId: message.correlationId,
    evidence: message.evidence,
  };
}

function request(server, method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({
      host: address.address,
      port: address.port,
      method,
      path: pathName,
      headers: payload ? { 'content-type': 'application/json' } : {},
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
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
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
