'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { DependencyError } = require('../sources');

const INTERNAL_KEY = 'examination-test-key';
const AGENT = 'agent-1';
const agentHeaders = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': AGENT, 'x-actor-role': 'agent' };

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId;
  pkg.version = pkg.manifest.version;
  pkg.state = 'Active';
  pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = [];
  pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: AGENT, configurationFingerprint: `sha256:${'a'.repeat(64)}` };
  const completion = { eventType: 'training.session.completed', eventId: 'training.session.completed:s-1',
    sessionId: 's-1', agentLearnerKey: AGENT, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  return { pkg, registration, completion };
}

async function boot(t, input = fixture(), overrides = {}) {
  const store = createMemoryStore();
  const sources = {
    activePackage: async () => input.pkg,
    registration: async () => input.registration,
    completion: async () => input.completion,
    ...overrides,
  };
  const server = http.createServer(createApp({ store, sources, internalKey: INTERNAL_KEY,
    clock: () => '2026-10-12T06:00:00.000Z', durationMinutes: 60 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { input, store, sources, call: (method, path, body, headers = agentHeaders) =>
    request(server, method, path, body, headers) };
}

function request(server, method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('start commits one immutable form before public delivery; replay and owner read use that same form', async (t) => {
  const ctx = await boot(t);
  const first = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start-1' });
  assert.deepEqual([first.status, first.body.outcome, first.body.attempt.form.items.length], [201, 'started', 15]);
  const id = first.body.attempt.attemptId;
  assert.equal(first.body.attempt.deadlineAt, '2026-10-12T07:00:00.000Z');
  assert.equal(first.body.attempt.form.subject, undefined);
  assert.equal(first.body.attempt.form.items[0].rubricCriterionIds, undefined);
  const stored = await ctx.store.get(id);
  assert.equal(stored.form.training.eventId, ctx.input.completion.eventId);
  assert.equal(stored.formDigest, sha256(stored.form));
  const replay = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start-1' });
  assert.deepEqual([replay.status, replay.body.outcome, replay.body.attempt.attemptId], [200, 'replay', id]);
  assert.deepEqual(replay.body.attempt.form, first.body.attempt.form);
  const read = await ctx.call('GET', `/internal/attempts/${id}`);
  assert.deepEqual(read.body.attempt.form, first.body.attempt.form);
});

test('identity, internal key, Admin console and restricted-material projection', async (t) => {
  const ctx = await boot(t);
  assert.equal((await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'k' }, {})).status, 403);
  assert.equal((await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'k', agentLearnerKey: AGENT })).status, 400);
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'k' });
  const id = started.body.attempt.attemptId;
  const other = { ...agentHeaders, 'x-actor-subject': 'other-agent' };
  assert.equal((await ctx.call('GET', `/internal/attempts/${id}`, undefined, other)).status, 403);
  assert.equal((await ctx.call('GET', `/internal/admin/attempts/${id}`)).status, 403);
  const admin = await ctx.call('GET', `/internal/admin/attempts/${id}`, undefined,
    { ...agentHeaders, 'x-actor-role': 'admin' });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.attempt.itemReferences.length, 15);
  assert.equal(admin.body.attempt.itemReferences.some((item) => Object.hasOwn(item, 'prompt')), false);
  assert.equal(JSON.stringify(admin.body).includes('expectedAnswer'), false);
});

test('missing completion, invalid package and dependency loss deliver nothing', async (t) => {
  const input = fixture();
  const ctx = await boot(t, input);
  input.completion = null;
  assert.deepEqual([(await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'a' })).status,
    await ctx.store.findByKey(AGENT, 'a')], [409, null]);
  input.completion = fixture().completion;
  input.pkg.quarantinedScopes = [{ scope: 'm1' }];
  assert.equal((await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'b' })).status, 409);
  input.pkg.quarantinedScopes = [];
  ctx.sources.activePackage = async () => { throw new DependencyError('validation-activation'); };
  assert.equal((await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'c' })).status, 503);
  assert.equal(await ctx.store.findByKey(AGENT, 'c'), null);
});

test('competing same-key starts converge to one attempt and quarantine blocks later reads', async (t) => {
  const ctx = await boot(t);
  const [a, b] = await Promise.all([
    ctx.call('POST', '/internal/attempts', { idempotencyKey: 'race' }),
    ctx.call('POST', '/internal/attempts', { idempotencyKey: 'race' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.body.attempt.attemptId, b.body.attempt.attemptId);
  ctx.input.pkg.quarantinedScopes = [{ scope: 'm1' }];
  assert.equal((await ctx.call('GET', `/internal/attempts/${a.body.attempt.attemptId}`)).status, 409);
});
