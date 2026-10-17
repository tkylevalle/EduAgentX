'use strict';
// Issue #27 ("Governance, Demonstration Lab, and permissions") — proves the
// four new identities (viewer, evaluator, governance_operator x2,
// demo_operator) issue correctly-scoped tokens and that requireRole(...)
// composes access across them exactly like it already does for
// agent/admin/reviewer. The governance-command and Demonstration Lab
// endpoints these roles will gate don't exist yet (separate work); this
// file only proves the identity/permission foundation they'll be built on.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const keyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'eduagentx-permissions-'));
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
process.env.JWT_ISSUER = 'eduagentx-permissions-test';
process.env.JWT_AUDIENCE = 'eduagentx-permissions-audience';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.AGENT_CLIENT_ID = 'permissions-agent';
process.env.AGENT_CLIENT_SECRET = 'permissions-agent-secret';
process.env.ADMIN_CLIENT_ID = 'permissions-admin';
process.env.ADMIN_CLIENT_SECRET = 'permissions-admin-secret';
process.env.VIEWER_CLIENT_ID = 'permissions-viewer';
process.env.VIEWER_CLIENT_SECRET = 'permissions-viewer-secret';
process.env.EVALUATOR_CLIENT_ID = 'permissions-evaluator';
process.env.EVALUATOR_CLIENT_SECRET = 'permissions-evaluator-secret';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_ID = 'permissions-governance-a';
process.env.GOVERNANCE_OPERATOR_1_CLIENT_SECRET = 'permissions-governance-a-secret';
process.env.GOVERNANCE_OPERATOR_2_CLIENT_ID = 'permissions-governance-b';
process.env.GOVERNANCE_OPERATOR_2_CLIENT_SECRET = 'permissions-governance-b-secret';
process.env.DEMO_OPERATOR_CLIENT_ID = 'permissions-demo-operator';
process.env.DEMO_OPERATOR_CLIENT_SECRET = 'permissions-demo-operator-secret';

const { createApp } = require('../index');
const { requireRole } = require('../auth');

test.after(() => fs.rmSync(keyDirectory, { recursive: true, force: true }));

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
async function requestJson(server, method, requestPath, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const NEW_IDENTITIES = [
  { clientId: 'permissions-viewer', clientSecret: 'permissions-viewer-secret', role: 'viewer' },
  { clientId: 'permissions-evaluator', clientSecret: 'permissions-evaluator-secret', role: 'evaluator' },
  { clientId: 'permissions-governance-a', clientSecret: 'permissions-governance-a-secret', role: 'governance_operator' },
  { clientId: 'permissions-governance-b', clientSecret: 'permissions-governance-b-secret', role: 'governance_operator' },
  { clientId: 'permissions-demo-operator', clientSecret: 'permissions-demo-operator-secret', role: 'demo_operator' },
];

test('each new Issue #27 identity issues a token carrying its own role and subject', async (t) => {
  const gateway = http.createServer(createApp({}));
  await listen(gateway);
  t.after(() => gateway.close());

  for (const identity of NEW_IDENTITIES) {
    const issued = await requestJson(gateway, 'POST', '/v1/auth/tokens', identity);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.equal(issued.body.role, identity.role);
    assert.equal(issued.body.tokenType, 'Bearer');
    assert.ok(issued.body.accessToken);
  }
});

test('the two governance_operator identities are distinct subjects, ready for a two-person-review check', async (t) => {
  const gateway = http.createServer(createApp({}));
  await listen(gateway);
  t.after(() => gateway.close());

  const jwt = require('jsonwebtoken');
  const tokens = await Promise.all([
    requestJson(gateway, 'POST', '/v1/auth/tokens', NEW_IDENTITIES[2]),
    requestJson(gateway, 'POST', '/v1/auth/tokens', NEW_IDENTITIES[3]),
  ]);
  const subjects = tokens.map((t2) => jwt.decode(t2.body.accessToken).sub);
  assert.equal(new Set(subjects).size, 2, 'the two governance_operator identities must be distinguishable by subject');
  assert.deepEqual(subjects.sort(), ['permissions-governance-a', 'permissions-governance-b']);
});

test('requireRole composes access across the new roles exactly like it already does for agent/admin/reviewer', async (t) => {
  // No real route is gated by these roles yet (the governance-command and
  // Demonstration Lab endpoints are separate work); this proves the
  // requireRole(...) middleware itself — the thing those future routes will
  // use — correctly composes OR-access across any combination of roles,
  // using real tokens issued by the real gateway.
  const gateway = http.createServer(createApp({}));
  await listen(gateway);
  t.after(() => gateway.close());

  const probe = express();
  probe.use(express.json());
  probe.get('/viewer-or-evaluator', requireRole('viewer', 'evaluator'), (req, res) => res.json({ role: req.auth.role }));
  probe.get('/governance-only', requireRole('governance_operator'), (req, res) => res.json({ role: req.auth.role }));
  probe.get('/demo-only', requireRole('demo_operator'), (req, res) => res.json({ role: req.auth.role }));
  const probeServer = http.createServer(probe);
  await listen(probeServer);
  t.after(() => probeServer.close());

  const tokenFor = async (identity) => (await requestJson(gateway, 'POST', '/v1/auth/tokens', identity)).body.accessToken;
  const call = async (requestPath, token) => {
    const response = await fetch(`http://127.0.0.1:${probeServer.address().port}${requestPath}`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return response.status;
  };

  const viewerToken = await tokenFor(NEW_IDENTITIES[0]);
  const evaluatorToken = await tokenFor(NEW_IDENTITIES[1]);
  const governanceToken = await tokenFor(NEW_IDENTITIES[2]);
  const demoToken = await tokenFor(NEW_IDENTITIES[4]);
  const agentToken = (await requestJson(gateway, 'POST', '/v1/auth/tokens',
    { clientId: 'permissions-agent', clientSecret: 'permissions-agent-secret' })).body.accessToken;

  // Either role on the composed route is accepted.
  assert.equal(await call('/viewer-or-evaluator', viewerToken), 200);
  assert.equal(await call('/viewer-or-evaluator', evaluatorToken), 200);
  // A role outside the composed set is rejected, not silently admitted.
  assert.equal(await call('/viewer-or-evaluator', agentToken), 403);
  assert.equal(await call('/viewer-or-evaluator', governanceToken), 403);

  // Single-role routes reject every other new role, including each other.
  assert.equal(await call('/governance-only', governanceToken), 200);
  assert.equal(await call('/governance-only', demoToken), 403);
  assert.equal(await call('/governance-only', viewerToken), 403);
  assert.equal(await call('/demo-only', demoToken), 200);
  assert.equal(await call('/demo-only', governanceToken), 403);

  // No token at all is still 401, same as every existing protected route.
  assert.equal(await call('/governance-only', undefined), 401);
});
