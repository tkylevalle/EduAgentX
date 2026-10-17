'use strict';

// Feeds credential events from a Redis Stream into the credential projection.
// Consumer group, at-least-once delivery: an entry is acknowledged only after
// its effect is committed. Duplicates are removed by event id in projection_inbox.
// A poison entry is quarantined (never applied) after MAX_ATTEMPTS, so it cannot
// block the entries behind it. While Redis is down the service keeps serving.
//
// Nothing emits to this stream yet (blocker 1, owner Timurmalik): certification-service
// publishes no credential events. The envelope below is our proposed contract.

const { randomUUID } = require('node:crypto');
const { createClient } = require('redis');
const telemetry = require('../../packages/telemetry');
const { applyProjectionEvent } = require('./store');
const { toCandidate } = require('./clients');

const SERVICE_NAME = 'marketplace-service';
const DEFAULT_STREAM = 'certification.credentials';
const DEFAULT_GROUP = 'marketplace-projection-v1';
const MAX_ATTEMPTS = 3;          // per stream entry, as in agent-registry's stream worker
const BATCH_SIZE = 50;
const TICK_INTERVAL_MS = 1000;
const CLAIM_IDLE_MS = 5000;       // reclaim entries a dead consumer left pending
const REDIS_TIMEOUT_MS = 2000;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function bounded(fn, ms = REDIS_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('dependency timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Proposed envelope (stream field `envelope`, JSON):
//   { eventId, eventType, credentialId, agentLearnerKey, occurredAt, credential? }
// where `credential` is certification-service's issued record { credentialId, credential, compactJws }
// and is required on credential.issued. Returns null for anything we cannot trust.
function toProjectionEvent(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return null; }
  if (!object(envelope)) return null;
  const { eventId, eventType, credentialId, agentLearnerKey, occurredAt } = envelope;
  const event = { eventId, eventType, credentialId, agentLearnerKey, occurredAt };
  if (eventType !== 'credential.issued') return event;
  const candidate = toCandidate(envelope.credential);
  // The envelope and the signed credential inside it must name the same credential and learner.
  if (!candidate || candidate.credentialId !== credentialId || candidate.agentLearnerKey !== agentLearnerKey) return null;
  const { credentialId: _id, agentLearnerKey: _key, ...fields } = candidate;
  return { ...event, credential: fields };
}

function createCredentialConsumer({ store, redis, stream = DEFAULT_STREAM, group = DEFAULT_GROUP,
  clock = () => new Date().toISOString(), intervalMs = TICK_INTERVAL_MS }) {
  const consumer = randomUUID();
  let running = false;
  let timer;

  async function quarantine(entry, reason) {
    await store.quarantineStreamEntry(entry.id, reason, clock());
    telemetry.log(SERVICE_NAME, 'credential_event_quarantined', { outcome: reason });
    await bounded(() => redis.xAck(stream, group, entry.id));
  }

  async function processEntry(entry) {
    try {
      if (await store.isStreamQuarantined(entry.id)) {
        await bounded(() => redis.xAck(stream, group, entry.id));
        return { outcome: 'quarantined' };
      }
      // The attempt is recorded before the work, so a crash still spends it.
      const attempt = await store.recordStreamAttempt(entry.id);
      if (attempt > MAX_ATTEMPTS) { await quarantine(entry, 'automatic_attempts_exhausted'); return { outcome: 'quarantined' }; }
      const event = toProjectionEvent(entry.message?.envelope);
      // Untrusted content is never stored: the stream id and a reason are enough for an operator.
      if (!event) { await quarantine(entry, 'invalid_or_unrecognized_event'); return { outcome: 'quarantined' }; }
      const result = await applyProjectionEvent(store, event, { now: clock() });
      // A crash between commit and ack redelivers the entry; the inbox makes that a no-op.
      await bounded(() => redis.xAck(stream, group, entry.id));
      return result;
    } catch {
      // Left pending in the group; it is reclaimed and retried on a later tick.
      telemetry.log(SERVICE_NAME, 'consumer_attempt_failed');
      return { outcome: 'retry' };
    }
  }

  async function consume() {
    try { await bounded(() => redis.xGroupCreate(stream, group, '0', { MKSTREAM: true })); }
    catch (error) { if (!String(error?.message).includes('BUSYGROUP')) throw error; }
    const claimed = await bounded(() => redis.xAutoClaim(stream, group, consumer, CLAIM_IDLE_MS, '0-0', { COUNT: BATCH_SIZE }));
    for (const entry of claimed?.messages || []) if (entry) await processEntry(entry);
    const batches = await bounded(() => redis.xReadGroup(group, consumer, { key: stream, id: '>' }, { COUNT: BATCH_SIZE }));
    for (const batch of batches || []) for (const entry of batch.messages) await processEntry(entry);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      if (redis.isReady) await consume();
    } catch {
      telemetry.log(SERVICE_NAME, 'credential_feed_pending', { dependency: 'redis', outcome: 'error' });
    } finally {
      running = false;
    }
  }

  return {
    processEntry, consume, tick,
    start() {
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      void tick();
    },
    stop() { clearInterval(timer); },
  };
}

// A client that fails fast while Redis is down instead of queueing commands
// (same settings as training-service's relay client).
function createRedisClient(url) {
  const redis = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 2000 } });
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

module.exports = { DEFAULT_STREAM, MAX_ATTEMPTS, createCredentialConsumer, createRedisClient, toProjectionEvent };
