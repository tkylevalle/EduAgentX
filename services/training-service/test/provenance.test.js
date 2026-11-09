'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const p = require('../../../packages/execution-provenance');
const { fixture } = require('../../../packages/execution-provenance/test/fixtures');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');

async function boot(t, mode, store = createMemoryStore(), options = {}) {
  const f = fixture(mode), headers = { 'x-internal-service-key': 'training-provenance',
    'x-actor-subject': f.run.agentLearnerKey, 'x-actor-role': 'gateway' };
  const server = http.createServer(createApp({ store, internalKey: headers['x-internal-service-key'],
    packageSource: { getActive: async () => f.trainingPackage, getById: async () => f.trainingPackage },
    registrySource: { getRegistration: async () => f.registration }, ...options }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = async (path, body, override = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET',
      headers: { ...headers, 'content-type': 'application/json', ...override }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  const input = (extra = {}) => ({ idempotencyKey: randomUUID(), evidence: f.evidence, trustedExecution: f.authority, ...extra });
  return { f, store, call, input };
}

for (const mode of ['synthetic','replay']) {
  test(`${mode}: Training pins provenance, rejects conflicts atomically, persists complete receipts and replays after restart`, async (t) => {
    const ctx = await boot(t, mode), { call, input, store } = ctx;
    const startBody = input();
    const started = await call('/internal/sessions/start', startBody);
    assert.equal(started.status, 201);
    const run = started.body.provenance, base = `/internal/sessions/${run.runId}`;
    assert.equal(run.evidenceMode, mode);
    assert.equal(run.configurationVersion, 1);
    const count = async () => (await store.readSession(run.runId)).events.length;
    const originalCount = await count();
    for (const conflict of [
      { evidence: { mode: 'live', environment: 'live' } },
      { evidence: { mode: mode === 'replay' ? 'synthetic' : 'replay', environment: 'simulation' } },
      { trustedExecution: { ...ctx.f.authority, executorId: 'other' } },
      { trustedExecution: null },
    ]) {
      const res = await call(`${base}/continue`, input(conflict));
      assert.ok([403,409].includes(res.status));
      if (res.status === 409) assert.equal(res.body.error, 'provenance_conflict');
      assert.equal(await count(), originalCount);
    }
    const invalidPair = await call(`${base}/continue`, input({ evidence: { mode: 'live', environment: 'simulation' } }));
    assert.equal(invalidPair.status, 400);
    let firstReceipt;
    for (let i = 0; i < 10; i++) {
      const delivery = await call(`${base}/continue`, input());
      assert.equal(delivery.status, 200);
      const item = delivery.body.item, produced = p.receipt(run, 'training', item);
      const body = input({ deliveryItemId: item.deliveryItemId, ...produced });
      const before = await count();
      if (i === 0) {
        for (const bad of [{ ...body, response: 'arbitrary replacement' }, { ...body, executionEvidence: undefined },
          { ...body, executionEvidence: { ...produced.executionEvidence, runId: randomUUID() } }]) {
          const rejected = await call(`${base}/submit`, bad);
          assert.equal(rejected.status, 409); assert.equal(await count(), before);
        }
        firstReceipt = produced.executionEvidence;
      } else {
        const wrong = await call(`${base}/submit`, { ...body, executionEvidence: firstReceipt });
        assert.equal(wrong.status, 409); assert.equal(await count(), before);
      }
      const accepted = await call(`${base}/submit`, body);
      assert.equal(accepted.status, 200);
      const replayed = await call(`${base}/submit`, body);
      assert.equal(replayed.status, 200); assert.equal(replayed.body.outcome, 'replay');
    }
    const complete = (await store.listCompletionEvents())[0];
    assert.equal(p.validCompletion(complete), true);
    assert.deepEqual(complete.provenance, run);
    const restart = await boot(t, mode, store);
    const retry = await restart.call('/internal/sessions/start', startBody);
    assert.equal(retry.body.sessionId, run.runId);
    assert.deepEqual(retry.body.provenance, run);
    const terminalCount = await count();
    restart.f.trainingPackage.state = 'Quarantined';
    restart.f.registration.configurationFingerprint = 'later-configuration';
    const historicalReplay = await restart.call('/internal/sessions/start', startBody);
    assert.equal(historicalReplay.status, 200);
    assert.equal(historicalReplay.body.sessionId, run.runId);
    assert.equal(await count(), terminalCount);
    const exact = await restart.call(`/internal/completions/latest?agentLearnerKey=${run.agentLearnerKey}&packageId=${run.package.id}&packageVersion=${run.package.version}&packageDigest=${run.package.digest}&sessionId=${run.runId}`);
    assert.deepEqual(exact.body.completion, complete);
  });
}

test('Training requires internal auth and Gateway context; legacy sessions never upgrade', async (t) => {
  const c = await boot(t, 'synthetic');
  assert.equal((await c.call('/internal/sessions/start', c.input(), { 'x-internal-service-key': '' })).status, 403);
  assert.equal((await c.call('/internal/sessions/start', c.input(), { 'x-actor-role': 'agent' })).status, 403);
  const old = await c.call('/internal/sessions/start', c.input({ trustedExecution: undefined }));
  assert.equal(old.status, 201); assert.equal(old.body.provenance, undefined);
  const expected = require('node:crypto').createHash('sha256').update(JSON.stringify({ action: 'start', sessionId: null, evidence: c.f.evidence })).digest('hex');
  assert.equal((await c.store.readSession(old.body.sessionId)).events[0].requestFingerprint, expected);
  const changed = await c.call(`/internal/sessions/${old.body.sessionId}/continue`, c.input());
  assert.equal(changed.status, 409); assert.equal(changed.body.error, 'provenance_conflict');
});


test('domain remediation assignment pins only server-enrolled planned authority and never treats relay labels as receipts', async (t) => {
  const profile = 'synthetic:competent:safe-escalation';
  const c = await boot(t, 'synthetic', createMemoryStore(), { executionPrincipals: [
    { subject: 'provenance-agent', evidenceMode: 'synthetic', sources: [profile] },
  ] });
  const body = { requestId: 'authoritative-remediation', agentLearnerKey: c.f.run.agentLearnerKey,
    packageId: c.f.run.package.id, packageVersion: c.f.run.package.version, objectiveIds: ['o1'],
    evidence: c.f.evidence, cause: { type: 'examination_failure', reference: 'failed-exam', evidenceDigest: p.hash('failure'),
      observedAt: new Date().toISOString() } };
  const relay = { 'x-actor-subject': 'examination-engine', 'x-actor-role': 'examination-engine' };
  const assigned = await c.call('/internal/remediations', body, relay);
  assert.equal(assigned.status, 201); assert.equal(assigned.body.provenance.evidenceMode, 'synthetic');
  assert.equal((await c.call('/internal/remediations', body, relay)).body.sessionId, assigned.body.sessionId);
  const resumed = await c.call('/internal/sessions/start', c.input());
  assert.equal(resumed.body.sessionId, assigned.body.sessionId);
  const delivered = await c.call(`/internal/sessions/${assigned.body.sessionId}/continue`, c.input());
  const missingReceipt = await c.call(`/internal/sessions/${assigned.body.sessionId}/submit`, c.input({
    deliveryItemId: delivered.body.item.deliveryItemId, response: 'relay did not generate this' }));
  assert.equal(missingReceipt.status, 409);
  const conflicting = await c.call('/internal/remediations', { ...body, requestId: 'wrong-mode', evidence: { mode: 'live', environment: 'live' } }, relay);
  assert.equal(conflicting.status, 409); assert.equal(conflicting.body.error, 'provenance_conflict');
});
