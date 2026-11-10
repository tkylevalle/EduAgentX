'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { reconcileMatch } = require('../match-inventory');
const { PublicClient } = require('../client');
const { safeMarket } = require('../report');
const row = (ids = ['result']) => ({ status: 200, body: { count: ids.length, resultIds: ids,
  appearances: ids.map(resultId => ({ resultId, agentLearnerKey: 'learner' })) } });

test('caller timeout before commit and retry in flight reconcile by the same key to one late result', async () => {
  let time = 0, committed = false, calls = 0;
  const client = new PublicClient({ gatewayUrl: 'http://unused.invalid', clientId: 'test', clientSecret: 'private',
    now: () => time, wait: async ms => { time += ms; } });
  const keys = [];
  client.client.request = async (_m, route, { body }) => {
    if (route.includes('/reconciliation/')) { calls++; return row(committed ? ['result'] : []); }
    keys.push(body.idempotencyKey);
    if (keys.length === 1) throw new DOMException('private diagnostic', 'TimeoutError');
    return { status: 504, body: { error: 'upstream_error', privateContext: 'must never persist' } };
  };
  const reply = await client.call('POST', '/v1/marketplace/capability-requests/request/matches', { idempotencyKey: 'stable' }, 'correlation', { attempts: 2 });
  assert.deepEqual(keys, ['stable', 'stable']);
  assert.deepEqual(reply.commandAttempts.map(a => a.error), ['transport_timeout', 'http_5xx']);
  const observation = await reconcileMatch({ admin: client, actor: 'admin', idempotencyKey: 'stable',
    now: () => time, wait: async ms => { time += ms; committed = true; } });
  assert.equal(calls, 2); assert.equal(observation.state, 'late_completion');
  assert.equal(observation.status, 'CONFORMANT'); assert.equal(observation.duplicates, 0);
  const safe = safeMarket({ ...reply, commandAttempts: reply.commandAttempts });
  assert.ok(!JSON.stringify(safe).includes('private')); assert.ok(!JSON.stringify(safe).includes('must never persist'));
  assert.equal(safe.commandAttempts[0].capabilityRequestId, 'request');
  assert.equal(safe.commandAttempts[0].httpStatus, null);
});

test('replay, no commit, true duplicate, lane duplicate and unavailable inventory remain distinct', async () => {
  const read = async (response, resultId) => reconcileMatch({ admin: { call: async () => response },
    actor: 'admin', idempotencyKey: 'same', resultId, settleMs: 0 });
  assert.equal((await read(row(), 'result')).state, 'one_committed_result');
  assert.equal((await read(row())).state, 'committed_without_reply');
  assert.equal((await read(row([]))).state, 'no_committed_result');
  assert.equal((await read(row([]))).status, 'MISMATCH');
  const dup = await read(row(['result', 'extra']));
  assert.equal(dup.state, 'duplicate_results'); assert.equal(dup.duplicates, 1);
  const lane = row(); lane.body.appearances.push(lane.body.appearances[0]);
  assert.equal((await read(lane)).laneDuplicates, 1); assert.equal((await read(lane)).status, 'MISMATCH');
  for (const response of [{ status: 503 }, { status: 200, body: { count: 0 } }]) {
    const unknown = await read(response);
    assert.equal(unknown.status, 'BLOCKED'); assert.equal(unknown.duplicates, null);
    assert.equal(unknown.count, null); assert.equal(unknown.laneDuplicates, null);
  }
});

test('rejected inventory reads remain BLOCKED with unknown duplicate counts', async () => {
  const r = await reconcileMatch({ admin: { call: async () => { throw Error('source refused'); } },
    actor: 'admin', idempotencyKey: 'same' });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.count, null); assert.equal(r.duplicates, null);
});

test('Gateway timeout errors retain a safe exact classification, never an arbitrary error body', async () => {
  const client = new PublicClient({ gatewayUrl: 'http://unused.invalid', clientId: 'test', clientSecret: 'test' });
  client.client.request = async () => ({ status: 504, body: { error: 'upstream_timeout', private: 'hidden' } });
  const r = await client.call('POST', '/v1/marketplace/capability-requests/request/matches', { idempotencyKey: 'same' }, 'cid', { attempts: 1 });
  assert.equal(r.commandAttempts[0].error, 'upstream_timeout');
  assert.ok(!JSON.stringify(r.commandAttempts).includes('hidden'));
});
