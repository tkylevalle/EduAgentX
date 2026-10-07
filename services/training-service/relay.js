'use strict';

// The completion relay. It publishes each training.session.completed envelope
// from the completion_events outbox to a Redis Stream and records the stream
// id, so each event is sent once in normal operation. A crash between the
// send and the record sends that event again: delivery is at least once, and
// a consumer removes duplicates by `eventId`.

const { createClient } = require('redis');
const telemetry = require('../../packages/telemetry');

const SERVICE_NAME = 'training-service';
const DEFAULT_STREAM = 'training.session.completed';
const RELAY_INTERVAL_MS = 1000;
const RELAY_BATCH = 100;
// node-redis has no command timeout; a half-open connection would otherwise
// hold the relay lock and its pg client forever.
const SEND_TIMEOUT_MS = 5000;

// Publishes pending completion events and returns how many it sent. While
// Redis is down it sends nothing, and the events wait in the outbox.
async function relayCompletions({ store, redis, stream = DEFAULT_STREAM, sendTimeoutMs = SEND_TIMEOUT_MS }) {
  if (!redis.isReady) return 0;
  return store.publishPendingCompletions(
    (envelope) => withTimeout(
      redis.xAdd(stream, '*', { eventId: envelope.eventId, envelope: JSON.stringify(envelope) }), sendTimeoutMs),
    RELAY_BATCH);
}

// A send that times out may still reach Redis later; the event is then sent
// twice, which at-least-once delivery allows.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('redis_send_timeout'), { code: 'redis_send_timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A client that fails fast while Redis is down instead of queueing commands.
// Training starts and serves requests without Redis; the relay catches up
// when the connection returns.
function createRelayClient(url) {
  const redis = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 2000 } });
  // node-redis reports every reconnect attempt; log only when the state changes.
  let down = false;
  redis.on('error', () => {
    if (down) return;
    down = true;
    telemetry.log(SERVICE_NAME, 'redis_connection_error', { dependency: 'redis', outcome: 'error' });
  });
  redis.on('ready', () => {
    if (!down) return;
    down = false;
    telemetry.log(SERVICE_NAME, 'redis_connection_restored', { dependency: 'redis', outcome: 'ready' });
  });
  redis.connect().catch(() => telemetry.log(SERVICE_NAME, 'redis_connect_failed', { dependency: 'redis', outcome: 'error' }));
  return redis;
}

// Runs the relay in the background. A failed run is logged and retried on
// the next tick; a tick is skipped while the previous one still runs.
function startCompletionRelay({ store, redis, stream = DEFAULT_STREAM, intervalMs = RELAY_INTERVAL_MS }) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await relayCompletions({ store, redis, stream });
    } catch (error) {
      telemetry.log(SERVICE_NAME, 'completion_relay_failed', { dependency: 'redis', operation: 'xadd', outcome: error.code || 'error' });
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { DEFAULT_STREAM, createRelayClient, relayCompletions, startCompletionRelay };
