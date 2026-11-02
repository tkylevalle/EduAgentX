'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { terminalBound, poll, createPacer, PublicClient } = require('../client');
const { runScenarios, expectedFingerprint, registrationPayload } = require('../lifecycle');
const { select } = require('../manifest');
test('deadline bound follows the server deadline for absent/partial learners, not a fixed PoC wait', () => {
  const deadlineAt = '2026-11-01T12:00:00Z';
  assert.equal(terminalBound({ deadlineAt, responseCollectionComplete: false }, 0), Date.parse(deadlineAt) + 45000);
  assert.equal(terminalBound({ deadlineAt, responseCollectionComplete: true }, Date.parse(deadlineAt) - 1000), Date.parse(deadlineAt) - 1000 + 900000 + 45000);
  assert.throws(() => terminalBound({ deadlineAt: 'invalid' }, 0));
});
test('polling follows deterministic backoff, permits post-deadline grading and stops at its bound', async () => {
  let time = 0, reads = 0; const waits = [];
  const result = await poll(async () => ++reads, n => n === 4, { deadline: 20000,
    now: () => time, wait: async ms => { waits.push(ms); time += ms; } });
  assert.equal(result, 4); assert.deepEqual(waits, [1000, 2000, 5000]);
  time = 0;
  assert.equal(await poll(async () => 'in_progress', () => false, { deadline: 4000,
    now: () => time, wait: async ms => { time += ms; } }), null);
  assert.equal(time, 4000);
});
test('one shared pacer serializes concurrent callers without exceeding its configured rate', async () => {
  let time = 0;
  const pace = createPacer({ intervalMs: 150, now: () => time, wait: async ms => { time += ms; } });
  await Promise.all(Array.from({ length: 10 }, () => pace()));
  assert.equal(time, 1350);
});
test('HTTP retries are bounded and keep the original semantic body/key', async () => {
  const client = new PublicClient({ gatewayUrl: 'http://unused.invalid', clientId: 'test', clientSecret: 'test', wait: async () => {} });
  const bodies = []; client.client.request = async (_m, _r, { body }) => { bodies.push(body); return { status: 503, body: {} }; };
  const body = { idempotencyKey: 'same', response: 'kept only in memory' };
  assert.equal((await client.call('POST', '/v1/examinations', body)).status, 503);
  assert.equal(bodies.length, 3); assert.ok(bodies.every(b => b === body));
  await assert.rejects(client.call('POST', '/internal/finalize', {}));
});
test('deadline observers do not hold every preparation worker', async () => {
  let prepared = 0, release;
  const parked = new Promise(resolve => { release = resolve; });
  const orchestrator = { prepare: async s => { prepared++; if (prepared === 3) release(); return s; },
    observe: async s => { await parked; return { scenarioId: s.id }; } };
  const results = await runScenarios([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { orchestrator, clientFor: () => ({}), concurrency: 1 });
  assert.equal(results.length, 3); assert.equal(prepared, 3);
});
test('independent fingerprint binds normalized declared configuration, not learner identity', () => {
  const a = registrationPayload(select('canary')[0]);
  assert.equal(expectedFingerprint(a), expectedFingerprint({ ...a, agentLearnerKey: 'another-learner' }));
  assert.notEqual(expectedFingerprint(a), expectedFingerprint({ ...a, adapterVersion: 'changed' }));
});
