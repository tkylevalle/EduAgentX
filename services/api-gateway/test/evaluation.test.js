'use strict';
// Contract/security tests only. Stubs here are never counted as Compose evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');
const { evaluationClients, MAX_CLIENTS, MAX_BYTES } = require('../evaluation-clients');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue33-auth-'));
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
for (const [name, type] of [['private', 'pkcs8'], ['public', 'spki']]) fs.writeFileSync(path.join(dir, name), pair[`${name}Key`].export({ type, format: 'pem' }), { mode: name === 'private' ? 0o600 : 0o644 });
Object.assign(process.env, { JWT_PRIVATE_KEY_PATH: path.join(dir, 'private'), JWT_PUBLIC_KEY_PATH: path.join(dir, 'public'),
  JWT_ISSUER: 'issue33-test', JWT_AUDIENCE: 'issue33-test', ADMIN_CLIENT_ID: 'admin', ADMIN_CLIENT_SECRET: 'admin-fixture',
  AGENT_CLIENT_ID: 'normal-agent', AGENT_CLIENT_SECRET: 'normal-fixture' });
delete process.env.EVALUATION_CLIENTS_ENABLED; delete process.env.EVALUATION_CLIENTS_PATH;
const { createApp } = require('../index');
test.after(() => fs.rmSync(dir, { recursive: true }));
const roster = path.join(dir, 'clients.json');
function write(clients) { fs.writeFileSync(roster, JSON.stringify(clients)); }
const entry = n => ({ clientId: `e2e33-client-${n}`, clientSecret: `fixture-${String(n).padStart(32, '0')}` });
const enabled = () => ({ EVALUATION_CLIENTS_ENABLED: 'true', EVALUATION_CLIENTS_PATH: roster });
test('evaluation roster is ignored by default and bounded/strict when explicitly enabled', () => {
  assert.deepEqual(evaluationClients([], {}), []);
  for (const flag of [undefined, 'false', 'TRUE', '1', true])
    assert.deepEqual(evaluationClients([], { EVALUATION_CLIENTS_ENABLED: flag, EVALUATION_CLIENTS_PATH: '/does-not-exist' }), []);
  write(Array.from({ length: 1000 }, (_, i) => entry(i)));
  assert.equal(evaluationClients([], enabled()).length, 1000);
  assert.ok(evaluationClients([], enabled()).every(c => c.role === 'agent'));
  for (const invalid of [[entry(0), entry(0)], [{ ...entry(0), role: 'admin' }],
    [{ ...entry(0), clientId: '*' }], [{ ...entry(0), clientSecret: 'weak' }], [], Array.from({ length: MAX_CLIENTS + 1 }, (_, i) => entry(i))]) {
    write(invalid); assert.throws(() => evaluationClients([], enabled()), /^Error: evaluation_clients_invalid$/);
  }
  write([entry(0)]); assert.throws(() => evaluationClients([entry(0).clientId], enabled()));
  fs.writeFileSync(roster, 'x'.repeat(MAX_BYTES + 1)); assert.throws(() => evaluationClients([], enabled()));
});
test('invalid JSON, non-file paths and files growing after metadata validation fail closed with bounded reads', t => {
  for (const text of ['{', 'null', '{}', '[null]', '[1]', '["client"]']) {
    fs.writeFileSync(roster, text); assert.throws(() => evaluationClients([], enabled()), /^Error: evaluation_clients_invalid$/);
  }
  for (const file of [dir, path.join(dir, 'absent')])
    assert.throws(() => evaluationClients([], { ...enabled(), EVALUATION_CLIENTS_PATH: file }), /^Error: evaluation_clients_invalid$/);
  write([entry(0)]);
  const stat = fs.fstatSync, read = fs.readSync; let requested = 0;
  t.mock.method(fs, 'fstatSync', fd => {
    const before = stat(fd);
    // Deterministically reproduce file growth between fstat and the first read.
    fs.appendFileSync(roster, ' '.repeat(MAX_BYTES));
    return before;
  });
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    requested += length; return read(fd, buffer, offset, length, position);
  });
  assert.throws(() => evaluationClients([], enabled()), /^Error: evaluation_clients_invalid$/);
  assert.ok(requested > 0 && requested <= MAX_BYTES + 1);
});
async function serve(t, app) {
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function send(url, route, body, token, method = 'POST', extraHeaders = {}) {
  const r = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
}
test('configured evaluation clients use real token issuance and retain role, ownership and unknown-client rejection', async t => {
  write([entry(0)]); Object.assign(process.env, enabled());
  t.after(() => { delete process.env.EVALUATION_CLIENTS_ENABLED; delete process.env.EVALUATION_CLIENTS_PATH; });
  const url = await serve(t, createApp());
  const token = await send(url, '/v1/auth/tokens', { ...entry(0), role: 'admin' }); assert.equal(token.status, 200); assert.equal(token.body.role, 'agent');
  const value = token.body.accessToken;
  const claims = require('jsonwebtoken').verify(value, pair.publicKey, { algorithms: ['RS256'], issuer: 'issue33-test', audience: 'issue33-test' });
  assert.equal(claims.sub, entry(0).clientId); assert.equal(claims.role, 'agent');
  assert.equal((await send(url, '/v1/auth/tokens', { ...entry(0), clientSecret: 'wrong-secret' })).status, 401);
  assert.equal((await send(url, '/v1/admin/whoami', undefined, value, 'GET')).status, 403);
  assert.equal((await send(url, '/v1/registrations', { agentLearnerKey: 'someone-else' }, value)).status, 403);
  assert.equal((await send(url, '/v1/auth/tokens', entry(999))).status, 401);
  delete process.env.EVALUATION_CLIENTS_ENABLED;
  assert.equal((await send(url, '/v1/auth/tokens', entry(0))).status, 401);
  assert.equal((await send(url, '/v1/auth/tokens', { clientId: 'normal-agent', clientSecret: 'normal-fixture' })).status, 200);
  process.env.EVALUATION_CLIENTS_ENABLED = 'true'; write([{ ...entry(0), role: 'admin' }]);
  const invalid = await send(url, '/v1/auth/tokens', entry(0)); assert.equal(invalid.status, 503);
  assert.ok(!JSON.stringify(invalid.body).includes(entry(0).clientSecret));
});
test('evaluation secrets/tokens are never logged and disabled malformed configuration preserves normal clients', async t => {
  const lines = []; t.mock.method(console, 'log', (...values) => lines.push(values.join(' ')));
  write([entry(0)]); Object.assign(process.env, enabled());
  t.after(() => { delete process.env.EVALUATION_CLIENTS_ENABLED; delete process.env.EVALUATION_CLIENTS_PATH; });
  const url = await serve(t, createApp());
  const issued = await send(url, '/v1/auth/tokens', entry(0)); assert.equal(issued.status, 200);
  assert.equal((await send(url, '/v1/admin/whoami', undefined, issued.body.accessToken, 'GET')).status, 403);
  const logs = lines.join('\n');
  assert.ok(!logs.includes(entry(0).clientSecret)); assert.ok(!logs.includes(issued.body.accessToken));
  process.env.EVALUATION_CLIENTS_ENABLED = 'false'; fs.writeFileSync(roster, '{broken');
  assert.equal((await send(url, '/v1/auth/tokens', { clientId: 'normal-agent', clientSecret: 'normal-fixture' })).status, 200);
  // A conflicting roster cannot replace the normal client's configured secret.
  process.env.EVALUATION_CLIENTS_ENABLED = 'true';
  const oldId = process.env.AGENT_CLIENT_ID; process.env.AGENT_CLIENT_ID = entry(0).clientId;
  t.after(() => { process.env.AGENT_CLIENT_ID = oldId; });
  write([entry(0)]);
  assert.equal((await send(url, '/v1/auth/tokens', entry(0))).status, 503);
});
test('reconciliation is admin-only with exact bounded filters and derived downstream authority', async t => {
  delete process.env.EVALUATION_CLIENTS_ENABLED;
  const overrides = { VIEWER_CLIENT_ID: 'audit-viewer', VIEWER_CLIENT_SECRET: 'viewer-fixture',
    EVALUATOR_CLIENT_ID: 'audit-evaluator', EVALUATOR_CLIENT_SECRET: 'evaluator-fixture' };
  const before = Object.fromEntries(Object.keys(overrides).map(k => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  t.after(() => { for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const express = require('express'), owner = express(), seen = [];
  owner.get('/internal/reconciliation/:kind', (req, res) => {
    seen.push({ role: req.header('x-actor-role'), permission: req.header('x-reconciliation-role'), subject: req.header('x-actor-subject'), key: req.header('x-internal-service-key') });
    res.json({ count: 0, attemptIds: [], credentialIds: [], resultIds: [], appearances: [] });
  });
  const base = await serve(t, owner);
  const url = await serve(t, createApp({ examinationEngineUrl: base, examinationInternalKey: 'test-key',
    certificationServiceUrl: base, certificationInternalKey: 'test-key', marketplaceServiceUrl: base, marketplaceInternalKey: 'test-key' }));
  const admin = (await send(url, '/v1/auth/tokens', { clientId: 'admin', clientSecret: 'admin-fixture' })).body.accessToken;
  const agent = (await send(url, '/v1/auth/tokens', { clientId: 'normal-agent', clientSecret: 'normal-fixture' })).body.accessToken;
  const readers = await Promise.all(['viewer', 'evaluator'].map(async role =>
    (await send(url, '/v1/auth/tokens', { clientId: `audit-${role}`, clientSecret: `${role}-fixture` })).body.accessToken));
  const cases = ['examinations?agentLearnerKey=test&idempotencyKey=key',
    'credentials?examinationId=00000000-0000-4000-8000-000000000001', 'matches?actor=test&idempotencyKey=key'];
  for (const suffix of cases) {
    const route = '/v1/admin/reconciliation/' + suffix;
    assert.equal((await send(url, route, undefined, undefined, 'GET')).status, 401);
    assert.equal((await send(url, route, undefined, agent, 'GET')).status, 403);
    for (const token of readers) assert.equal((await send(url, route, undefined, token, 'GET')).status, 403);
    assert.equal((await send(url, route, undefined, agent, 'GET', {
      'x-actor-role': 'admin', 'x-reconciliation-role': 'admin', 'x-internal-service-key': 'test-key' })).status, 403);
    assert.equal((await send(url, route, undefined, admin, 'GET')).status, 200);
    assert.equal((await send(url, route + '&unexpected=value', undefined, admin, 'GET')).status, 400);
    const [path, query] = route.split('?'), parameters = new URLSearchParams(query), first = [...parameters.keys()][0];
    assert.equal((await send(url, path, undefined, admin, 'GET')).status, 400);
    parameters.set(first, 'x'.repeat(257));
    assert.equal((await send(url, `${path}?${parameters}`, undefined, admin, 'GET')).status, 400);
    assert.equal((await send(url, `${route}&${first}=duplicate`, undefined, admin, 'GET')).status, 400);
    const mutation = await fetch(url + route, { method: 'POST', headers: { authorization: `Bearer ${admin}` } });
    assert.equal(mutation.status, 404);
  }
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map(s => s.role), ['admin', 'gateway', 'admin']);
  assert.ok(seen.every(s => s.permission === 'admin' && s.subject === 'admin'));
  assert.ok(seen.every(s => s.key === 'test-key'));
});
