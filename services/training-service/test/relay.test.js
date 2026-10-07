'use strict';

// The completion relay: the outbox is published to a Redis Stream at least
// once, and each publication is recorded so it is not sent again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../store');
const { DEFAULT_STREAM, relayCompletions } = require('../relay');

const envelope = (n) => ({ eventId: `training.session.completed:s-${n}`, sessionId: `s-${n}`, occurredAt: `2026-10-07T10:0${n}:00.000Z` });

function fakeRedis() {
  const redis = { isReady: true, sent: [], failNext: 0 };
  redis.xAdd = async (stream, id, fields) => {
    if (redis.failNext > 0) {
      redis.failNext -= 1;
      throw new Error('connection lost');
    }
    redis.sent.push({ stream, id, fields });
    return `1700000000000-${redis.sent.length}`;
  };
  return redis;
}

async function storeWith(count) {
  const store = createMemoryStore();
  for (let n = 1; n <= count; n += 1) await store.transaction('test', (tx) => tx.insertCompletion(envelope(n)));
  return store;
}

test('each completion event is published once, in order, with its eventId', async () => {
  const store = await storeWith(2);
  const redis = fakeRedis();
  assert.equal(await relayCompletions({ store, redis }), 2);
  assert.deepEqual(redis.sent.map((s) => [s.stream, s.id, s.fields.eventId, JSON.parse(s.fields.envelope).sessionId]), [
    [DEFAULT_STREAM, '*', 'training.session.completed:s-1', 's-1'],
    [DEFAULT_STREAM, '*', 'training.session.completed:s-2', 's-2']]);
  assert.equal(await relayCompletions({ store, redis }), 0, 'a published event is not sent again');
  assert.deepEqual(await store.completionPublicationCounts(), { total: 2, published: 2, pending: 0 });
});

test('nothing is sent while Redis is down, and a failed send is retried on the next run', async () => {
  const store = await storeWith(2);
  const redis = fakeRedis();
  redis.isReady = false;
  assert.equal(await relayCompletions({ store, redis }), 0);
  assert.deepEqual(redis.sent, []);

  redis.isReady = true;
  redis.failNext = 1;
  await assert.rejects(relayCompletions({ store, redis }), /connection lost/);
  assert.deepEqual(await store.completionPublicationCounts(), { total: 2, published: 0, pending: 2 });
  assert.equal(await relayCompletions({ store, redis }), 2);
  assert.deepEqual(await store.completionPublicationCounts(), { total: 2, published: 2, pending: 0 });
});

test('a send that never answers times out, records nothing, and is retried', async () => {
  const store = await storeWith(1);
  const redis = fakeRedis();
  const xAdd = redis.xAdd;
  redis.xAdd = () => new Promise(() => {});
  await assert.rejects(relayCompletions({ store, redis, sendTimeoutMs: 20 }), /redis_send_timeout/);
  assert.deepEqual(await store.completionPublicationCounts(), { total: 1, published: 0, pending: 1 });
  redis.xAdd = xAdd;
  assert.equal(await relayCompletions({ store, redis, sendTimeoutMs: 20 }), 1);
});
