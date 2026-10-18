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
const CLIENTS = {
  agent: ['market-agent', 'AGENT'],
  admin: ['market-admin', 'ADMIN'],
  demo_operator: ['market-demo', 'DEMO_OPERATOR'],
  viewer: ['market-viewer', 'VIEWER'],
  evaluator: ['market-evaluator', 'EVALUATOR'],
  governance_operator: ['market-governance', 'GOVERNANCE_OPERATOR_1'],
  reviewer: ['market-reviewer', 'REVIEWER_1'],
};
for (const [clientId, prefix] of Object.values(CLIENTS)) {
  process.env[`${prefix}_CLIENT_ID`] = clientId;
  process.env[`${prefix}_CLIENT_SECRET`] = `${clientId}-secret`;
}
// Tests pass the configuration explicitly; values from the developer's shell must not leak in.
delete process.env.MARKETPLACE_SERVICE_URL;
delete process.env.MARKETPLACE_INTERNAL_KEY;

const { createApp } = require('../index');

const MARKETPLACE_KEY = 'marketplace-internal-test-key';
const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa';
const CHECK_ID = '00000000-0000-4000-8000-0000000000bb';

const WRITES = [
  ['POST', '/v1/marketplace/capability-requests', { idempotencyKey: 'k', request: { title: 't' } }, '/internal/capability-requests'],
  ['POST', `/v1/marketplace/capability-requests/${REQUEST_ID}/versions`, { idempotencyKey: 'k', request: { title: 't' } },
    `/internal/capability-requests/${REQUEST_ID}/versions`],
  ['POST', `/v1/marketplace/capability-requests/${REQUEST_ID}/open`, { version: 1 }, `/internal/capability-requests/${REQUEST_ID}/open`],
  ['POST', `/v1/marketplace/capability-requests/${REQUEST_ID}/close`, {}, `/internal/capability-requests/${REQUEST_ID}/close`],
  ['POST', `/v1/marketplace/capability-requests/${REQUEST_ID}/eligibility-checks`, { idempotencyKey: 'k' },
    `/internal/capability-requests/${REQUEST_ID}/eligibility-checks`],
];
const READS = [
  ['GET', '/v1/marketplace/capability-requests', undefined, '/internal/capability-requests'],
  ['GET', `/v1/marketplace/capability-requests/${REQUEST_ID}`, undefined, `/internal/capability-requests/${REQUEST_ID}`],
  ['GET', `/v1/marketplace/eligibility-checks/${CHECK_ID}`, undefined, `/internal/eligibility-checks/${CHECK_ID}`],
  ['GET', '/v1/marketplace/listings/agent%20a', undefined, '/internal/listings/agent%20a'],
];

test('admin and demo_operator may create, version, open, close and check; the actor is the token subject', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  for (const role of ['admin', 'demo_operator']) {
    const token = await tokenFor(gateway, role);
    for (const [method, route, body, upstreamPath] of WRITES) {
      marketplace.requests.length = 0;
      const response = await request(gateway, method, route, body, { authorization: `Bearer ${token}`, 'x-correlation-id': 'corr-write' });
      assert.equal(response.status, 201, `${role} ${route}`);
      const [forwarded] = marketplace.requests;
      assert.deepEqual([forwarded.method, forwarded.url], [method, upstreamPath]);
      assert.deepEqual(forwarded.body, body);
      assert.equal(forwarded.headers['x-internal-service-key'], MARKETPLACE_KEY);
      assert.equal(forwarded.headers['x-actor-subject'], CLIENTS[role][0]);
      assert.equal(forwarded.headers['x-correlation-id'], 'corr-write');
    }
  }
});

test('agent, viewer, evaluator, governance_operator and reviewer cannot write', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  for (const role of ['agent', 'viewer', 'evaluator', 'governance_operator', 'reviewer']) {
    const token = await tokenFor(gateway, role);
    for (const [method, route, body] of WRITES) {
      const response = await request(gateway, method, route, body, { authorization: `Bearer ${token}` });
      assert.equal(response.status, 403, `${role} ${route}`);
    }
  }
  assert.equal(marketplace.requests.length, 0);
});

test('every reader role may inspect; agent and reviewer may not; no token is 401', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  for (const role of ['admin', 'demo_operator', 'viewer', 'evaluator', 'governance_operator']) {
    const token = await tokenFor(gateway, role);
    for (const [method, route, , upstreamPath] of READS) {
      marketplace.requests.length = 0;
      const response = await request(gateway, method, route, undefined, { authorization: `Bearer ${token}` });
      assert.equal(response.status, 200, `${role} ${route}`);
      assert.equal(marketplace.requests[0].url, upstreamPath);
      assert.equal(marketplace.requests[0].headers['x-actor-subject'], CLIENTS[role][0]);
    }
  }
  marketplace.requests.length = 0;
  for (const role of ['agent', 'reviewer']) {
    const token = await tokenFor(gateway, role);
    for (const [method, route] of READS) {
      assert.equal((await request(gateway, method, route, undefined, { authorization: `Bearer ${token}` })).status, 403, `${role} ${route}`);
    }
  }
  for (const [method, route, body] of [...WRITES, ...READS]) {
    assert.equal((await request(gateway, method, route, body)).status, 401, route);
  }
  assert.equal(marketplace.requests.length, 0);
});

test('unknown body fields are refused before anything is forwarded', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  const token = await tokenFor(gateway, 'admin');
  const cases = [
    ['/v1/marketplace/capability-requests', { idempotencyKey: 'k', request: {}, createdBy: 'someone-else' }, 'unexpected:createdBy'],
    [`/v1/marketplace/capability-requests/${REQUEST_ID}/open`, { version: 1, actor: 'x' }, 'unexpected:actor'],
    [`/v1/marketplace/capability-requests/${REQUEST_ID}/close`, { reason: 'x' }, 'unexpected:reason'],
    [`/v1/marketplace/capability-requests/${REQUEST_ID}/eligibility-checks`, { idempotencyKey: 'k', score: 1 }, 'unexpected:score'],
  ];
  for (const [route, body, detail] of cases) {
    const response = await request(gateway, 'POST', route, body, { authorization: `Bearer ${token}` });
    assert.equal(response.status, 400, route);
    assert.deepEqual(response.body.details, [detail]);
  }
  const notObject = await request(gateway, 'POST', '/v1/marketplace/capability-requests', ['x'], { authorization: `Bearer ${token}` });
  assert.equal(notObject.status, 400);
  assert.equal(marketplace.requests.length, 0);
});

test('listing publish and withdraw act as the token subject and never forward a body identity', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  const token = await tokenFor(gateway, 'agent');
  for (const [interactionType, action] of [['marketplace.listing.publish', 'publish'], ['marketplace.listing.withdraw', 'withdraw']]) {
    marketplace.requests.length = 0;
    const response = await sendInteraction(gateway, token, message(interactionType));
    assert.equal(response.status, 201, interactionType);
    assert.equal(response.body.protocol.messageId, `msg-${interactionType}`);
    const [forwarded] = marketplace.requests;
    assert.deepEqual([forwarded.method, forwarded.url], ['POST', `/internal/listings/${action}`]);
    assert.deepEqual(forwarded.body, { idempotencyKey: `idem-${interactionType}` });
    assert.equal(forwarded.headers['x-actor-subject'], 'market-agent');
    assert.equal(forwarded.headers['x-internal-service-key'], MARKETPLACE_KEY);
    assert.equal(forwarded.headers['x-correlation-id'], `corr-${interactionType}`);
  }
});

test('a listing for another learner or with extra fields is refused before Marketplace', async (t) => {
  const { gateway, marketplace } = await startGateway(t);
  const token = await tokenFor(gateway, 'agent');
  const other = await sendInteraction(gateway, token, message('marketplace.listing.publish', { agentLearnerKey: 'someone-else' }));
  assert.deepEqual([other.status, other.body.error], [403, 'identity_mismatch']);
  const extra = await sendInteraction(gateway, token, message('marketplace.listing.publish', { listedAgent: 'someone-else' }));
  assert.deepEqual([extra.status, extra.body.error], [400, 'invalid_lifecycle_payload']);
  assert.equal(extra.body.details[0].field, 'payload.data.listedAgent');
  const admin = await tokenFor(gateway, 'admin');
  assert.equal((await sendInteraction(gateway, admin, message('marketplace.listing.publish'))).status, 403);
  assert.equal(marketplace.requests.length, 0);
});

test('without the Marketplace URL or key every route fails closed with 503', async (t) => {
  for (const overrides of [{ marketplaceServiceUrl: undefined }, { marketplaceInternalKey: undefined }]) {
    const { gateway, marketplace } = await startGateway(t, overrides);
    const admin = await tokenFor(gateway, 'admin');
    for (const [method, route, body] of [...WRITES, ...READS]) {
      const response = await request(gateway, method, route, body, { authorization: `Bearer ${admin}` });
      assert.deepEqual([response.status, response.body.error], [503, 'marketplace_unavailable'], route);
    }
    const agent = await tokenFor(gateway, 'agent');
    const listing = await sendInteraction(gateway, agent, message('marketplace.listing.publish'));
    assert.deepEqual([listing.status, listing.body.error], [503, 'marketplace_unavailable']);
    assert.equal(marketplace.requests.length, 0);
  }
});

test('an unreachable Marketplace is a 502, not a success', async (t) => {
  const { gateway } = await startGateway(t, { marketplaceServiceUrl: 'http://127.0.0.1:1' });
  const admin = await tokenFor(gateway, 'admin');
  const response = await request(gateway, 'GET', '/v1/marketplace/capability-requests', undefined, { authorization: `Bearer ${admin}` });
  assert.equal(response.status, 502);
});

async function startGateway(t, overrides = {}) {
  const marketplace = await startMarketplaceStub();
  const gateway = http.createServer(createApp({
    marketplaceServiceUrl: `http://127.0.0.1:${marketplace.server.address().port}`,
    marketplaceInternalKey: MARKETPLACE_KEY,
    ...overrides,
  }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => marketplace.server.close());
  return { gateway, marketplace };
}

// Records every request and answers 201 to writes, 200 to reads.
async function startMarketplaceStub() {
  const stub = { requests: [] };
  stub.server = http.createServer(async (req, res) => {
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    stub.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apiVersion: 'v1', outcome: 'ok' }));
  });
  await listen(stub.server);
  return stub;
}

function message(interactionType, data = {}) {
  return createLifecycleMessage({
    messageId: `msg-${interactionType}`,
    correlationId: `corr-${interactionType}`,
    idempotencyKey: `idem-${interactionType}`,
    timeoutMs: 2000,
    evidence: { mode: 'synthetic' },
    payload: { interactionType, data: { agentLearnerKey: 'market-agent', response: 'ack', ...data } },
  });
}

function sendInteraction(gateway, token, body) {
  return request(gateway, 'POST', '/v1/agent-learner/interactions', body, {
    authorization: `Bearer ${token}`, 'x-correlation-id': body.correlationId,
  });
}

async function tokenFor(server, role) {
  const [clientId] = CLIENTS[role];
  const response = await request(server, 'POST', '/v1/auth/tokens', { clientId, clientSecret: `${clientId}-secret` });
  assert.equal(response.status, 200, role);
  assert.equal(response.body.role, role);
  return response.body.accessToken;
}

function request(server, method, pathName, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({ host: address.address, port: address.port, method, path: pathName, agent: false,
      headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
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
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
