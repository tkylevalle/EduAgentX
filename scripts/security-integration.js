'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
loadEnv(path.join(root, '.env'));

const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
const resultsDirectory = process.env.SPRINT1_RESULTS_DIR
  ? path.resolve(process.env.SPRINT1_RESULTS_DIR)
  : path.join(root, 'artifacts', 'sprint1');
const agentClientId = process.env.AGENT_CLIENT_ID || 'synthetic-agent-learner-dev';
const agentClientSecret = process.env.AGENT_CLIENT_SECRET || 'changeme_local_only_agent_secret';
const adminClientId = process.env.ADMIN_CLIENT_ID || 'capstone-admin-dev';
const adminClientSecret = process.env.ADMIN_CLIENT_SECRET || 'changeme_local_only_admin_secret';

const checks = [];

main().catch((error) => {
  console.error(error);
  writeResults('failed', error.message);
  process.exitCode = 1;
});

async function main() {
  const agentToken = await token(agentClientId, agentClientSecret);
  const adminToken = await token(adminClientId, adminClientSecret);

  await check('unauthenticated registration is rejected', async () => {
    const response = await jsonRequest('/v1/registrations', { method: 'POST', body: registrationPayload() });
    equal(response.status, 401);
  });

  await check('invalid bearer token is rejected without echo', async () => {
    const invalidToken = 'invalid-token-that-must-not-be-echoed';
    const response = await jsonRequest('/v1/agent-learner/protocol', {
      headers: { authorization: `Bearer ${invalidToken}` },
    });
    equal(response.status, 401);
    excludes(JSON.stringify(response.body), invalidToken);
  });

  await check('agent role cannot access admin evidence', async () => {
    const response = await jsonRequest('/v1/admin/registration-traces/latest', {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    equal(response.status, 403);
  });

  await check('invalid client secret is not reflected', async () => {
    const secret = 'INTEGRATION_SECRET_MUST_NOT_BE_ECHOED';
    const response = await jsonRequest('/v1/auth/tokens', {
      method: 'POST',
      body: { clientId: agentClientId, clientSecret: secret },
    });
    equal(response.status, 401);
    excludes(JSON.stringify(response.body), secret);
  });

  await check('malformed JSON is rejected with correlation', async () => {
    const correlationId = 'security-malformed-json';
    const response = await rawRequest('/v1/auth/tokens', '{invalid-json', {
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
    });
    equal(response.status, 400);
    equal(response.body.correlationId, correlationId);
  });

  await check('oversized JSON is rejected', async () => {
    const response = await rawRequest('/v1/auth/tokens', JSON.stringify({
      clientId: agentClientId,
      clientSecret: 'x'.repeat(70 * 1024),
    }), { 'content-type': 'application/json' });
    equal(response.status, 413);
    equal(response.body.error, 'payload_too_large');
  });

  const correlationId = `security-registration-${Date.now()}`;
  const idempotencyKey = `security-idempotency-${Date.now()}`;
  const registration = protocolRegistration(correlationId, idempotencyKey);
  let firstRegistration;

  await check('provider-neutral registration succeeds through the Gateway', async () => {
    firstRegistration = await jsonRequest('/v1/agent-learner/registrations', {
      method: 'POST',
      body: registration,
      headers: protocolHeaders(agentToken, correlationId, idempotencyKey),
    });
    includes([200, 201], firstRegistration.status);
    equal(firstRegistration.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
    equal(firstRegistration.body.correlationId, correlationId);
  });

  await check('idempotent retry returns the exact original result', async () => {
    const retry = await jsonRequest('/v1/agent-learner/registrations', {
      method: 'POST',
      body: registration,
      headers: protocolHeaders(agentToken, correlationId, idempotencyKey),
    });
    equal(retry.status, firstRegistration.status);
    equal(JSON.stringify(retry.body), JSON.stringify(firstRegistration.body));
  });

  await check('idempotency key reuse with changed content conflicts', async () => {
    const changed = {
      ...registration,
      messageId: `${registration.messageId}-changed`,
      payload: { ...registration.payload, systemPromptHash: 'sha256:changed-security-prompt' },
    };
    const response = await jsonRequest('/v1/agent-learner/registrations', {
      method: 'POST',
      body: changed,
      headers: protocolHeaders(agentToken, correlationId, idempotencyKey),
    });
    equal(response.status, 409);
    equal(response.body.error, 'idempotency_conflict');
  });

  await check('private lifecycle response is redacted and cannot issue a credential', async () => {
    const privateResponse = 'PRIVATE_INTEGRATION_RESPONSE_MUST_NOT_BE_ECHOED';
    const lifecycleCorrelation = `security-lifecycle-${Date.now()}`;
    const lifecycleIdempotency = `security-lifecycle-idempotency-${Date.now()}`;
    const response = await jsonRequest('/v1/agent-learner/interactions', {
      method: 'POST',
      headers: protocolHeaders(agentToken, lifecycleCorrelation, lifecycleIdempotency),
      body: {
        protocol: 'ExternalAgentLearner',
        protocolVersion: '1.0.0',
        messageType: 'lifecycle',
        messageId: `security-lifecycle-message-${Date.now()}`,
        correlationId: lifecycleCorrelation,
        idempotencyKey: lifecycleIdempotency,
        timeoutMs: 2500,
        evidence: { mode: 'synthetic' },
        payload: {
          interactionType: 'training.submit',
          data: { agentLearnerKey: agentClientId, response: privateResponse },
        },
      },
    });
    equal(response.status, 202);
    equal(response.body.credentialIssued, false);
    excludes(JSON.stringify(response.body), privateResponse);
  });

  await check('admin can retrieve correlated assurance evidence', async () => {
    const response = await jsonRequest('/v1/admin/registration-traces/latest', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    equal(response.status, 200);
    if (!response.body.trace?.assurance?.correlationId) throw new Error('assurance correlationId is missing');
  });

  const failed = checks.filter((item) => item.status === 'failed');
  writeResults(failed.length ? 'failed' : 'passed');
  if (failed.length) process.exitCode = 1;
}

async function token(clientId, clientSecret) {
  const response = await jsonRequest('/v1/auth/tokens', {
    method: 'POST',
    body: { clientId, clientSecret },
  });
  if (response.status !== 200 || !response.body.accessToken) {
    throw new Error(`Token exchange failed for ${clientId}: HTTP ${response.status}`);
  }
  return response.body.accessToken;
}

function registrationPayload() {
  return {
    agentLearnerKey: agentClientId,
    model: { provider: 'synthetic', version: '1.0.0' },
    systemPromptHash: 'sha256:security-integration-prompt',
    approvedToolManifest: [{ name: 'knowledge.lookup', version: '1.0.0', permissions: ['read'] }],
    policyConfigurationHash: 'sha256:security-integration-policy',
    adapterVersion: 'security-integration-1.0.0',
  };
}

function protocolRegistration(correlationId, idempotencyKey) {
  return {
    protocol: 'ExternalAgentLearner',
    protocolVersion: '1.0.0',
    messageType: 'registration',
    messageId: `security-registration-message-${Date.now()}`,
    correlationId,
    idempotencyKey,
    timeoutMs: 2500,
    evidence: { mode: 'synthetic' },
    payload: registrationPayload(),
  };
}

function protocolHeaders(accessToken, correlationId, idempotencyKey) {
  return {
    authorization: `Bearer ${accessToken}`,
    'x-correlation-id': correlationId,
    'x-agent-protocol-version': '1.0.0',
    'idempotency-key': idempotencyKey,
  };
}

async function check(name, operation) {
  const started = Date.now();
  try {
    await operation();
    checks.push({ name, status: 'passed', durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: 'failed', durationMs: Date.now() - started, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function jsonRequest(requestPath, { method = 'GET', body, headers = {} } = {}) {
  return rawRequest(
    requestPath,
    body === undefined ? undefined : JSON.stringify(body),
    { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    method
  );
}

function rawRequest(requestPath, raw, headers = {}, method = 'POST') {
  const target = new URL(requestPath, gatewayBaseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method, headers }, (response) => {
      let responseText = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseText += chunk; });
      response.on('end', () => {
        let body = {};
        try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { raw: responseText }; }
        resolve({ status: response.statusCode, headers: response.headers, body });
      });
    });
    request.on('error', reject);
    if (raw !== undefined) request.write(raw);
    request.end();
  });
}

function writeResults(result, fatalError) {
  fs.mkdirSync(resultsDirectory, { recursive: true });
  const report = {
    schemaVersion: '1.0.0',
    suite: 'sprint1-security-integration',
    completedAt: new Date().toISOString(),
    gatewayBaseUrl,
    result,
    totals: {
      checks: checks.length,
      passed: checks.filter((item) => item.status === 'passed').length,
      failed: checks.filter((item) => item.status === 'failed').length,
    },
    ...(fatalError ? { fatalError } : {}),
    checks,
  };
  fs.writeFileSync(path.join(resultsDirectory, 'security-integration.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function equal(actual, expected) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function includes(values, actual) {
  if (!values.includes(actual)) throw new Error(`expected one of ${values.join(', ')}, received ${actual}`);
}

function excludes(value, forbidden) {
  if (value.includes(forbidden)) throw new Error('response disclosed protected input');
}
