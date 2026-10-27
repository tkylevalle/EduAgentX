'use strict';
// Status changes are trusted, durable commands: they need the internal key,
// and a change that cannot be saved is neither kept in memory nor reported
// as a state conflict.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app } = require('../src');

const KEY = 'test-internal-key';
let base, server;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { process.env.CREDENTIAL_INTERNAL_KEY = KEY; delete process.env.CREDENTIAL_STATUS_PATH; });

const post = (route, body, key = KEY) => fetch(`${base}${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'x-internal-service-key': key } : {}) }, body: JSON.stringify(body) });
const newId = () => `urn:uuid:${crypto.randomUUID()}`;

test('status changes are refused when no internal key is configured', async () => {
  delete process.env.CREDENTIAL_INTERNAL_KEY;
  const reply = await post('/status/revoke', { credentialId: newId(), reason: 'test' }, null);
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).error, 'internal_key_not_configured');
});

test('status changes need the matching internal key', async () => {
  assert.equal((await post('/status/register', { credentialId: newId() }, 'wrong-key')).status, 403);
  assert.equal((await post('/status/register', { credentialId: newId() }, null)).status, 403);
});

test('register creates a credential once and then reports it as known', async () => {
  const credentialId = newId();
  assert.equal((await post('/status/register', { credentialId })).status, 201);
  const again = await post('/status/register', { credentialId });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).status, 'active');
});

test('an invalid transition is a 409 and revocation cannot be undone', async () => {
  const credentialId = newId();
  await post('/status/register', { credentialId });
  assert.equal((await post('/status/revoke', { credentialId, reason: 'compromised' })).status, 200);
  const reply = await post('/status/reinstate', { credentialId, reason: 'try' });
  assert.equal(reply.status, 409);
  assert.match((await reply.json()).error, /irreversible/);
});

test('a change that cannot be saved is a 500 and leaves the status unchanged', async () => {
  const credentialId = newId();
  await post('/status/register', { credentialId });
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'status-')), 'not-a-directory');
  fs.writeFileSync(blocker, '');
  process.env.CREDENTIAL_STATUS_PATH = path.join(blocker, 'status.json');

  const reply = await post('/status/revoke', { credentialId, reason: 'disk full' });
  assert.equal(reply.status, 500);
  assert.equal((await reply.json()).error, 'status_not_persisted');
  assert.equal((await (await fetch(`${base}/status/${encodeURIComponent(credentialId)}`)).json()).status, 'active');
});

test('a saved status survives a restart, and an unreadable file stops the service', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  const file = path.join(directory, 'status.json');
  const run = (script) => spawnSync(process.execPath, ['-e', script],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, CREDENTIAL_STATUS_PATH: file }, encoding: 'utf8' });

  assert.equal(run("require('./src/statusStore').statusStore.register('urn:uuid:kept')").status, 0);
  const reloaded = run("process.stdout.write(String(require('./src/statusStore').statusStore.getStatus('urn:uuid:kept')))");
  assert.equal(reloaded.stdout, 'active');

  fs.writeFileSync(file, '{"truncated');
  const corrupt = run("require('./src/statusStore')");
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /unreadable.*refusing to start/);
});
