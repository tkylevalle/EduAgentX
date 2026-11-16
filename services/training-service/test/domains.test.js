'use strict';

// With more than one domain Active, a learner trains in the domain it names
// (target design 3.3); an unknown or malformed domain is refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');

const KEY = 'internal-test-key';
const LEARNER = 'learner-1';
const synthetic = { mode: 'synthetic', environment: 'simulation' };
const payload = () => ({ objectives: [{ id: 'o1', deliveryItemIds: ['m1-a'] }],
  modules: [{ id: 'm1', sequence: 1, objectiveIds: ['o1'], deliveryItems: [{ id: 'm1-a', kind: 'practice', text: 'Practice A1' }] }] });
const record = (id, domainId) => ({ id, version: '1.0.0', state: 'Active', digest: `digest-${id}`, domainId, payload: payload() });

async function boot(t) {
  const app = createApp({ internalKey: KEY, store: createMemoryStore(), clock: () => '2026-11-16T10:00:00.000Z',
    packageSource: createFakePackageSource([record('pkg-refunds', 'customer-refunds'), record('pkg-data', 'personal-data')]),
    registrySource: createFakeRegistrySource([{ agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:c', configurationVersion: 1 }]) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/internal/sessions/start', agent: false,
      headers: { 'x-internal-service-key': KEY, 'x-actor-subject': LEARNER, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
    (res) => { let raw = ''; res.on('data', (chunk) => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) })); });
    req.on('error', reject);
    req.end(data);
  });
}

test('a session starts on the Active package of the domain the learner names', async (t) => {
  const start = await boot(t);
  const started = await start({ idempotencyKey: 'start-data', evidence: synthetic, domainId: 'personal-data' });
  assert.equal(started.status, 201);
  assert.equal(started.body.package.id, 'pkg-data');
});

test('a malformed domain id is a 400', async (t) => {
  const start = await boot(t);
  const refused = await start({ idempotencyKey: 'start-bad', evidence: synthetic, domainId: 'DROP TABLE' });
  assert.deepEqual([refused.status, refused.body.error], [400, 'invalid_request']);
});

test('an open session in one domain does not take over a start that names another domain', async (t) => {
  const start = await boot(t);
  const data = await start({ idempotencyKey: 'start-data', evidence: synthetic, domainId: 'personal-data' });
  const refunds = await start({ idempotencyKey: 'start-refunds', evidence: synthetic, domainId: 'customer-refunds' });
  assert.deepEqual([refunds.status, refunds.body.package.id], [201, 'pkg-refunds']);
  assert.notEqual(refunds.body.sessionId, data.body.sessionId);
  const again = await start({ idempotencyKey: 'start-data-again', evidence: synthetic, domainId: 'personal-data' });
  assert.deepEqual([again.body.sessionId, again.body.resumed], [data.body.sessionId, true], 'each domain resumes its own session');
});

test('a domain with no Active package is refused as no_active_package', async (t) => {
  const start = await boot(t);
  const refused = await start({ idempotencyKey: 'start-ai', evidence: synthetic, domainId: 'ai-safety' });
  assert.deepEqual([refused.status, refused.body.error], [409, 'no_active_package']);
});
