const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-test';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'governance-agent';
process.env.AGENT_CLIENT_SECRET = 'governance-agent-secret';
process.env.ADMIN_CLIENT_ID = 'governance-admin';
process.env.ADMIN_CLIENT_SECRET = 'governance-admin-secret';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_ID = 'governance-operator-a';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_SECRET = 'governance-operator-a-secret';
process.env.GOVERNANCE_OPERATOR_2_CLIENT_ID = 'governance-operator-b';
process.env.GOVERNANCE_OPERATOR_2_CLIENT_SECRET = 'governance-operator-b-secret';
// Tests pass this explicitly; a key from the developer's shell must not leak in.
delete process.env.CURRICULUM_INTERNAL_KEY;

const { createApp } = require('../index');

const CURRICULUM_KEY = 'curriculum-internal-test-key';
const PACKAGE_ID = 'pkg-governance-1';
const RELEASE_PATH = `/v1/admin/governance/packages/${PACKAGE_ID}/quarantine-release`;

function releaseBody(overrides = {}) {
  return {
    version: '1.0.0',
    scope: { type: 'module', id: 'm1' },
    reason: 'source corrected and re-verified by two reviewers',
    evidenceReference: 'evidence://freshness-check/42',
    restoredPackageId: 'pkg-governance-1-refresh-x',
    ...overrides,
  };
}

test('two distinct governance operators approve a currently-quarantined scope: first pends, second executes against the owning service', async (t) => {
  const { gateway, validation } = await startGateway(t, {
    quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1', evidence: { reason: 'stale source' } }],
  });
  const tokenA = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const tokenB = await getToken(gateway, 'governance-operator-b', 'governance-operator-b-secret');

  const first = await request(gateway, 'POST', RELEASE_PATH, releaseBody({ reason: 'approver A: stale source now fixed' }),
    { authorization: `Bearer ${tokenA}`, 'x-correlation-id': 'corr-release-1' });
  assert.deepEqual([first.status, first.body.status, first.body.approvals, first.body.requiredApprovals],
    [202, 'pending_second_approval', 1, 2]);
  // Approval 1 alone never reaches the owning service's write endpoint.
  assert.deepEqual(validation.requests.map((r) => `${r.method} ${r.url}`), [`GET /packages/${PACKAGE_ID}?version=1.0.0`]);

  const second = await request(gateway, 'POST', RELEASE_PATH, releaseBody({ reason: 'approver B: independently confirmed the fix' }),
    { authorization: `Bearer ${tokenB}`, 'x-correlation-id': 'corr-release-2' });
  assert.equal(second.status, 200);
  assert.equal(second.body.restoredScope.id, 'm1');

  assert.deepEqual(validation.requests.map((r) => `${r.method} ${r.url}`), [
    `GET /packages/${PACKAGE_ID}?version=1.0.0`,
    `GET /packages/${PACKAGE_ID}?version=1.0.0`,
    `POST /packages/${PACKAGE_ID}/quarantines/restore`,
  ]);
  const restoreCall = validation.requests[2];
  assert.equal(restoreCall.headers['x-internal-service-key'], CURRICULUM_KEY);
  assert.equal(restoreCall.headers['x-actor-subject'], 'governance-operator-b', 'the executing actor is the second, authenticated approver');
  assert.equal(restoreCall.headers['x-actor-role'], 'governance_operator');
  assert.match(restoreCall.body.reason, /approver A: stale source now fixed/);
  assert.match(restoreCall.body.reason, /approver B: independently confirmed the fix/);
  assert.equal(restoreCall.body.evidenceReference, releaseBody().evidenceReference);
});

test('an admin and a governance operator are distinct subjects and can jointly complete a release', async (t) => {
  const { gateway } = await startGateway(t, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] });
  const adminToken = await getToken(gateway, 'governance-admin', 'governance-admin-secret');
  const operatorToken = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');

  const first = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${adminToken}` });
  assert.equal(first.status, 202);
  const second = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${operatorToken}` });
  assert.equal(second.status, 200);
});

test('the same approver calling twice never completes a release alone', async (t) => {
  const { gateway, validation } = await startGateway(t, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] });
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');

  const first = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.equal(first.status, 202);
  const repeat = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.deepEqual([repeat.status, repeat.body.error], [409, 'duplicate_approver']);
  assert.deepEqual(validation.requests.map((r) => r.method), ['GET', 'GET'], 'the restore endpoint is never reached by a single approver');
});

test('a second approval that does not match the first (different restoredPackageId or evidenceReference) is refused, and the first approval is preserved', async (t) => {
  const { gateway, validation } = await startGateway(t, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] });
  const tokenA = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const tokenB = await getToken(gateway, 'governance-operator-b', 'governance-operator-b-secret');

  await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${tokenA}` });
  const mismatched = await request(gateway, 'POST', RELEASE_PATH,
    releaseBody({ restoredPackageId: 'some-other-candidate' }), { authorization: `Bearer ${tokenB}` });
  assert.deepEqual([mismatched.status, mismatched.body.error], [409, 'approval_mismatch']);

  // The original, correctly-matching pending approval is still honored afterward.
  const matching = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${tokenB}` });
  assert.equal(matching.status, 200);
  assert.deepEqual(validation.requests.map((r) => r.method), ['GET', 'GET', 'GET', 'POST']);
});

test('an Agent Learner cannot approve governance commands', async (t) => {
  const { gateway, validation } = await startGateway(t, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] });
  const token = await getToken(gateway, 'governance-agent', 'governance-agent-secret');
  const response = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.equal(response.status, 403);
  assert.equal(validation.requests.length, 0);
});

test('governance_operator is scoped to governance commands and is refused by every other mutating admin route', async (t) => {
  const { gateway, validation } = await startGateway(t, {});
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  for (const [method, route] of [
    ['POST', '/v1/admin/curriculum/packages'],
    ['POST', '/v1/admin/curriculum/validate'],
    ['POST', '/v1/admin/curriculum/activate'],
    ['POST', '/v1/admin/training-remediations'],
    ['POST', '/v1/admin/packages'],
  ]) {
    const response = await request(gateway, method, route, {}, { authorization: `Bearer ${token}` });
    assert.equal(response.status, 403, `${method} ${route} must stay out of reach of governance_operator`);
  }
  assert.equal(validation.requests.length, 0);
});

test('every approval rechecks authoritative state: a scope restored between the two approvals refuses the second one', async (t) => {
  // Closes the gap in validation-activation's own restore route, which does
  // not itself verify the scope is still quarantined before acting — and
  // proves the recheck runs on the SECOND approval too, not just the first.
  const { gateway, validation } = await startGateway(t, {
    quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }],
  });
  const tokenA = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const tokenB = await getToken(gateway, 'governance-operator-b', 'governance-operator-b-secret');

  const first = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${tokenA}` });
  assert.equal(first.status, 202);

  // Something else cleared the quarantine out from under the pending approval.
  validation.quarantinedScopes.length = 0;

  const second = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${tokenB}` });
  assert.deepEqual([second.status, second.body.error], [409, 'scope_not_quarantined']);
  assert.deepEqual(validation.requests.map((r) => r.method), ['GET', 'GET'], 'the restore endpoint is never called once the recheck fails');
});

test('a scope that was never quarantined refuses even the first approval', async (t) => {
  const { gateway, validation } = await startGateway(t, {
    quarantinedScopes: [{ scopeType: 'module', scopeId: 'some-other-module' }],
  });
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const response = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.deepEqual([response.status, response.body.error], [409, 'scope_not_quarantined']);
  assert.deepEqual(validation.requests.map((r) => r.method), ['GET']);
});

test('a missing reason, evidence reference, scope, version, or restoredPackageId is refused before anything is recorded', async (t) => {
  const { gateway, validation } = await startGateway(t, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] });
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');

  const cases = [
    [releaseBody({ reason: '' }), ['reason']],
    [releaseBody({ reason: undefined }), ['reason']],
    [releaseBody({ evidenceReference: '   ' }), ['evidenceReference']],
    [releaseBody({ version: undefined }), ['version']],
    [releaseBody({ restoredPackageId: '' }), ['restoredPackageId']],
    [releaseBody({ scope: { type: 'module' } }), ['scope']],
    [releaseBody({ scope: null }), ['scope']],
    [{}, ['version', 'scope', 'reason', 'evidenceReference', 'restoredPackageId']],
  ];
  for (const [body, details] of cases) {
    const response = await request(gateway, 'POST', RELEASE_PATH, body, { authorization: `Bearer ${token}` });
    assert.deepEqual([response.status, response.body.error, response.body.details],
      [400, 'invalid_request', details], JSON.stringify(body));
  }
  assert.equal(validation.requests.length, 0, 'an invalid command never reaches the owning service');
});

test('a package the owning service cannot find is reported back as-is, without recording an approval', async (t) => {
  const { gateway, validation } = await startGateway(t, { packageFound: false });
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const response = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.deepEqual([response.status, response.body.error], [404, 'not_found']);
  assert.deepEqual(validation.requests.map((r) => `${r.method} ${r.url}`), [
    `GET /packages/${PACKAGE_ID}?version=1.0.0`,
  ]);
});

test('an unreachable validation-activation fails the governance command closed', async (t) => {
  const gateway = http.createServer(createApp({
    validationActivationUrl: 'http://127.0.0.1:1',
    curriculumInternalKey: CURRICULUM_KEY,
  }));
  await listen(gateway);
  t.after(() => gateway.close());
  const token = await getToken(gateway, 'governance-operator-a', 'governance-operator-a-secret');
  const response = await request(gateway, 'POST', RELEASE_PATH, releaseBody(), { authorization: `Bearer ${token}` });
  assert.deepEqual([response.status, response.body.error], [502, 'upstream_unavailable']);
});

async function startGateway(t, { quarantinedScopes = [], packageFound = true } = {}) {
  const validation = await startValidationActivationStub({ quarantinedScopes, packageFound });
  const gateway = http.createServer(createApp({
    validationActivationUrl: `http://127.0.0.1:${validation.server.address().port}`,
    curriculumInternalKey: CURRICULUM_KEY,
  }));
  await listen(gateway);
  t.after(() => gateway.close());
  t.after(() => validation.server.close());
  return { gateway, validation };
}

// Answers like validation-activation does for the two calls a governance
// quarantine-release command makes, and records every request it receives.
// `quarantinedScopes` is the same array instance referenced by both the
// stub and the test, so a test can mutate it mid-flow to simulate the
// scope being restored by someone else between two approvals.
async function startValidationActivationStub({ quarantinedScopes, packageFound }) {
  const stub = { requests: [], quarantinedScopes };
  stub.server = http.createServer(async (req, res) => {
    const body = req.method === 'POST' ? await readJson(req) : undefined;
    stub.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const [routePath] = req.url.split('?');
    if (req.method === 'GET' && routePath === `/packages/${PACKAGE_ID}`) {
      if (!packageFound) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, {
        packageId: PACKAGE_ID, version: '1.0.0', quarantinedScopes: stub.quarantinedScopes,
        certificationBlocked: stub.quarantinedScopes.length > 0,
      });
    }
    if (req.method === 'POST' && routePath === `/packages/${PACKAGE_ID}/quarantines/restore`) {
      const remaining = stub.quarantinedScopes.filter((s) => !(s.scopeType === body.scope.type && s.scopeId === body.scope.id));
      return sendJson(res, 200, {
        packageId: PACKAGE_ID, restoredScope: body.scope,
        certificationBlocked: remaining.length > 0, quarantinedScopes: remaining,
      });
    }
    return sendJson(res, 404, { error: 'not_found' });
  });
  await listen(stub.server);
  return stub;
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function getToken(server, clientId, clientSecret) {
  const response = await request(server, 'POST', '/v1/auth/tokens', { clientId, clientSecret });
  assert.equal(response.status, 200, `token issuance for ${clientId} failed: ${JSON.stringify(response.body)}`);
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
