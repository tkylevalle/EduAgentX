const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { createLifecycleMessage } = require('../../../packages/external-agent-protocol');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-test';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'training-agent';
process.env.AGENT_CLIENT_SECRET = 'training-agent-secret';
process.env.ADMIN_CLIENT_ID = 'training-admin';
process.env.ADMIN_CLIENT_SECRET = 'training-admin-secret';
// Tests pass the key explicitly; a key from the developer's shell must not leak in.
delete process.env.TRAINING_INTERNAL_KEY;

const { createApp } = require('../index');

const TRAINING_KEY = 'training-internal-test-key';
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

test('training.session interactions reach Training as the authenticated Agent Learner', async (t) => {
  const { gateway, training } = await startGateway(t);
  const token = await getToken(gateway, 'training-agent', 'training-agent-secret');

  const started = await send(gateway, token, message('training.session.start', { response: 'ack' }));
  assert.equal(started.status, 201);
  assert.equal(started.body.sessionId, SESSION_ID);
  assert.equal(started.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(started.body.protocol.messageId, 'msg-training.session.start');
  assert.equal(started.body.credentialIssued, false);

  const shown = await send(gateway, token, message('training.session.continue', { response: 'ack', sessionId: SESSION_ID }));
  assert.deepEqual([shown.status, shown.body.item.deliveryItemId], [200, 'm1-a']);

  const done = await send(gateway, token, message('training.session.submit',
    { response: 'my answer', sessionId: SESSION_ID, deliveryItemId: 'm1-a' }));
  assert.deepEqual([done.status, done.body.completedItemId], [200, 'm1-a']);

  assert.deepEqual(training.requests.map((r) => `${r.method} ${r.url}`), [
    'POST /internal/sessions/start',
    `POST /internal/sessions/${SESSION_ID}/continue`,
    `POST /internal/sessions/${SESSION_ID}/submit`,
  ]);
  for (const r of training.requests) {
    assert.equal(r.headers['x-internal-service-key'], TRAINING_KEY);
    assert.equal(r.headers['x-actor-subject'], 'training-agent', 'actor comes from the token, not the body');
    assert.equal(r.body.agentLearnerKey, undefined);
    assert.deepEqual(r.body.evidence, { mode: 'synthetic', environment: 'simulation' });
  }
  assert.equal(training.requests[0].headers['x-correlation-id'], 'corr-training.session.start');
  assert.equal(training.requests[0].body.response, undefined, 'the start acknowledgement is not forwarded');
  assert.equal(training.requests[1].body.response, undefined, 'the continue acknowledgement is not forwarded');
  assert.deepEqual(training.requests[2].body, {
    idempotencyKey: 'idem-training.session.submit',
    evidence: { mode: 'synthetic', environment: 'simulation' },
    deliveryItemId: 'm1-a',
    response: 'my answer',
  });
});

test('unauthenticated, cross-identity and incomplete training interactions fail closed before Training', async (t) => {
  const { gateway, training } = await startGateway(t);
  const token = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const start = message('training.session.start', { response: 'ack' });

  const anonymous = await request(gateway, 'POST', '/v1/agent-learner/interactions', start, {
    'x-correlation-id': start.correlationId,
  });
  assert.equal(anonymous.status, 401);

  const otherLearner = message('training.session.start', { response: 'ack', agentLearnerKey: 'someone-else' });
  const mismatch = await send(gateway, token, otherLearner);
  assert.deepEqual([mismatch.status, mismatch.body.error], [403, 'identity_mismatch']);

  const noSession = await send(gateway, token, message('training.session.continue', { response: 'ack' }));
  assert.deepEqual([noSession.status, noSession.body.error], [400, 'invalid_lifecycle_payload']);
  assert.equal(noSession.body.details[0].field, 'payload.data.sessionId');

  const noItem = await send(gateway, token, message('training.session.submit', { response: 'x', sessionId: SESSION_ID }));
  assert.deepEqual([noItem.status, noItem.body.details[0].field], [400, 'payload.data.deliveryItemId']);

  assert.equal(training.requests.length, 0);
});

test('a Quarantined-package block from Training comes back through the Gateway and is never cached', async (t) => {
  const { gateway, training } = await startGateway(t);
  training.respond = () => [409, {
    apiVersion: 'v1', outcome: 'blocked', error: 'training_blocked', safeState: 'training_blocked',
    sessionId: SESSION_ID, status: 'blocked', reason: 'package_state:Quarantined',
  }];
  const token = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const continueMessage = message('training.session.continue', { response: 'ack', sessionId: SESSION_ID });

  const blocked = await send(gateway, token, continueMessage);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'training_blocked');
  assert.equal(blocked.body.reason, 'package_state:Quarantined');
  assert.equal(blocked.body.evidence.label, 'SIMULATION: Synthetic Agent Learner');
  assert.equal(blocked.body.credentialIssued, false);

  // The same message again is re-checked by Training rather than answered from the Gateway cache.
  training.respond = () => [200, { apiVersion: 'v1', outcome: 'replay', sessionId: SESSION_ID, status: 'open' }];
  await send(gateway, token, continueMessage);
  await send(gateway, token, continueMessage);
  assert.equal(training.requests.length, 3);
});

test('training.submit and other lifecycle types keep the Sprint 1 202 boundary', async (t) => {
  const { gateway, training } = await startGateway(t);
  const token = await getToken(gateway, 'training-agent', 'training-agent-secret');
  for (const type of ['training.submit', 'examination.submit']) {
    const response = await send(gateway, token, message(type, { response: 'answer' }));
    assert.equal(response.status, 202, type);
    assert.equal(response.body.safeState, 'awaiting_lifecycle_owner');
  }
  assert.equal(training.requests.length, 0);
});

test('admin training-session routes are read-only, admin-only and forward only known filters', async (t) => {
  const { gateway, training } = await startGateway(t);
  const agentToken = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const adminToken = await getToken(gateway, 'training-admin', 'training-admin-secret');

  assert.equal((await request(gateway, 'GET', '/v1/admin/training-sessions')).status, 401);
  assert.equal((await request(gateway, 'GET', '/v1/admin/training-sessions', undefined,
    { authorization: 'Bearer not-a-real-token' })).status, 401);
  assert.equal((await request(gateway, 'GET', `/v1/admin/training-sessions/${SESSION_ID}`, undefined,
    { authorization: `Bearer ${agentToken}` })).status, 403);
  assert.equal((await request(gateway, 'GET', '/v1/admin/training-sessions', undefined,
    { authorization: `Bearer ${agentToken}` })).status, 403);
  assert.equal(training.requests.length, 0, 'Training is never asked on behalf of a non-admin');

  const list = await request(gateway, 'GET', '/v1/admin/training-sessions?agentLearnerKey=a%20b&status=open&sql=drop',
    undefined, { authorization: `Bearer ${adminToken}` });
  assert.equal(list.status, 200);
  const detail = await request(gateway, 'GET', `/v1/admin/training-sessions/${SESSION_ID}`, undefined,
    { authorization: `Bearer ${adminToken}` });
  assert.equal(detail.status, 200);
  assert.deepEqual(training.requests.map((r) => `${r.method} ${r.url}`), [
    'GET /internal/sessions?agentLearnerKey=a+b&status=open',
    `GET /internal/sessions/${SESSION_ID}`,
  ]);
  assert.equal(training.requests[0].headers['x-actor-subject'], 'training-admin');

  const write = await request(gateway, 'POST', '/v1/admin/training-sessions', {}, { authorization: `Bearer ${adminToken}` });
  assert.equal(write.status, 404, 'no human write route exists');
});

test('an admin remediation request reaches Training unchanged with the admin as actor, and unknown fields are refused', async (t) => {
  const { gateway, training } = await startGateway(t);
  const agentToken = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const adminToken = await getToken(gateway, 'training-admin', 'training-admin-secret');
  const remediation = {
    requestId: 'req-1', agentLearnerKey: 'training-agent', packageId: 'pkg-a', packageVersion: '1.0.0',
    objectiveIds: ['o2'], evidence: { mode: 'synthetic', environment: 'simulation' },
    cause: { type: 'examination_failure', reference: 'attempt-7', evidenceDigest: `sha256:${'a'.repeat(64)}`,
      observedAt: '2026-10-07T09:00:00Z' },
  };

  const asAgent = await request(gateway, 'POST', '/v1/admin/training-remediations', remediation,
    { authorization: `Bearer ${agentToken}` });
  assert.equal(asAgent.status, 403, 'an Agent Learner cannot assign itself remediation');
  assert.equal(training.requests.length, 0);

  const forged = await request(gateway, 'POST', '/v1/admin/training-remediations',
    { ...remediation, weights: [1], sessionId: 'forged' }, { authorization: `Bearer ${adminToken}` });
  assert.deepEqual([forged.status, forged.body.error, forged.body.details],
    [400, 'invalid_request', ['unexpected:weights', 'unexpected:sessionId']]);
  assert.equal(training.requests.length, 0, 'a refused request never reaches Training');

  const assigned = await request(gateway, 'POST', '/v1/admin/training-remediations', remediation,
    { authorization: `Bearer ${adminToken}`, 'x-correlation-id': 'corr-remediation' });
  assert.deepEqual([assigned.status, assigned.body.status], [201, 'assigned']);
  const forwarded = training.requests[0];
  assert.equal(`${forwarded.method} ${forwarded.url}`, 'POST /internal/remediations');
  assert.deepEqual(forwarded.body, remediation);
  assert.equal(forwarded.headers['x-actor-subject'], 'training-admin');
  assert.equal(forwarded.headers['x-correlation-id'], 'corr-remediation');

  const notObject = await request(gateway, 'POST', '/v1/admin/training-remediations', ['x'],
    { authorization: `Bearer ${adminToken}` });
  assert.deepEqual([notObject.status, notObject.body.error], [400, 'invalid_request']);
  assert.equal(training.requests.length, 1);
});

test('admin training metrics and completion events are read-only admin views', async (t) => {
  const { gateway, training } = await startGateway(t);
  const agentToken = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const adminToken = await getToken(gateway, 'training-admin', 'training-admin-secret');
  for (const route of ['/v1/admin/training-metrics', '/v1/admin/training-completion-events']) {
    assert.equal((await request(gateway, 'GET', route)).status, 401);
    assert.equal((await request(gateway, 'GET', route, undefined, { authorization: `Bearer ${agentToken}` })).status, 403);
    assert.equal((await request(gateway, 'GET', route, undefined, { authorization: `Bearer ${adminToken}` })).status, 200);
    assert.equal((await request(gateway, 'POST', route, {}, { authorization: `Bearer ${adminToken}` })).status, 404);
  }
  assert.deepEqual(training.requests.map((r) => `${r.method} ${r.url}`),
    ['GET /internal/metrics', 'GET /internal/completion-events']);
});

test('a missing Training key or an unreachable Training service fails closed', async (t) => {
  const { gateway, training } = await startGateway(t, { trainingInternalKey: undefined });
  const agentToken = await getToken(gateway, 'training-agent', 'training-agent-secret');
  const adminToken = await getToken(gateway, 'training-admin', 'training-admin-secret');
  const noKey = await send(gateway, agentToken, message('training.session.start', { response: 'ack' }));
  assert.deepEqual([noKey.status, noKey.body.error], [503, 'training_unavailable']);
  const noKeyAdmin = await request(gateway, 'GET', '/v1/admin/training-sessions', undefined,
    { authorization: `Bearer ${adminToken}` });
  assert.deepEqual([noKeyAdmin.status, noKeyAdmin.body.error], [503, 'training_unavailable']);
  for (const [method, route] of [['GET', '/v1/admin/training-metrics'], ['GET', '/v1/admin/training-completion-events'],
    ['POST', '/v1/admin/training-remediations']]) {
    const refused = await request(gateway, method, route, method === 'POST' ? { requestId: 'r' } : undefined,
      { authorization: `Bearer ${adminToken}` });
    assert.deepEqual([refused.status, refused.body.error], [503, 'training_unavailable'], route);
  }
  assert.equal(training.requests.length, 0);

  const unreachable = http.createServer(createApp({ trainingServiceUrl: 'http://127.0.0.1:1', trainingInternalKey: TRAINING_KEY }));
  await listen(unreachable);
  t.after(() => unreachable.close());
  const down = await send(unreachable, agentToken, message('training.session.start', { response: 'ack' }));
  assert.deepEqual([down.status, down.body.error], [502, 'upstream_unavailable']);
});

async function startGateway(t, overrides = {}) {
  const training = await startTrainingStub();
  const gateway = http.createServer(createApp({
    trainingServiceUrl: `http://127.0.0.1:${training.server.address().port}`,
    trainingInternalKey: TRAINING_KEY,
    ...overrides,
  }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => training.server.close());
  return { gateway, training };
}

// Answers like training-service does, and records every request it receives.
async function startTrainingStub() {
  const stub = { requests: [], respond: null };
  stub.server = http.createServer(async (req, res) => {
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    stub.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (stub.respond) return sendJson(res, ...stub.respond(req));
    if (req.url === '/internal/sessions/start') {
      return sendJson(res, 201, { apiVersion: 'v1', outcome: 'ok', sessionId: SESSION_ID, status: 'open', resumed: false });
    }
    if (req.url.endsWith('/continue')) {
      return sendJson(res, 200, { apiVersion: 'v1', outcome: 'ok', sessionId: SESSION_ID, status: 'open',
        item: { deliveryItemId: 'm1-a', text: 'Lesson A1' } });
    }
    if (req.url.endsWith('/submit')) {
      return sendJson(res, 200, { apiVersion: 'v1', outcome: 'ok', sessionId: SESSION_ID, status: 'open', completedItemId: 'm1-a' });
    }
    if (req.url === '/internal/remediations') {
      return sendJson(res, 201, { apiVersion: 'v1', outcome: 'ok', sessionId: SESSION_ID, status: 'assigned' });
    }
    if (req.method === 'GET') return sendJson(res, 200, { apiVersion: 'v1', sessions: [] });
    return sendJson(res, 404, { error: 'not_found' });
  });
  await listen(stub.server);
  return stub;
}

function message(interactionType, data) {
  return createLifecycleMessage({
    messageId: `msg-${interactionType}`,
    correlationId: `corr-${interactionType}`,
    idempotencyKey: `idem-${interactionType}`,
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: { interactionType, data: { agentLearnerKey: 'training-agent', ...data } },
  });
}

function send(gateway, token, body) {
  return request(gateway, 'POST', '/v1/agent-learner/interactions', body, {
    authorization: `Bearer ${token}`,
    'x-correlation-id': body.correlationId,
  });
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
      agent: false,
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
