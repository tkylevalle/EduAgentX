// Delivers assurance events from the PostgreSQL outbox to a Redis Stream, and
// consumes that stream back into an ordered per-aggregate projection.
//
// Producer: event_outbox -> XADD. One dispatcher at a time (advisory lock).
// Consumer: XREADGROUP -> event_inbox -> event_projection, applied strictly in
// sequence order per aggregate. Poison entries are quarantined, never applied.
// Every exhausted retry budget records a delivery incident for an operator.
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const telemetry = require('../../packages/telemetry');
const { bounded } = require('./dependency-health');
const { isUuid } = require('./domain');

const DISPATCH_LOCK_ID = 17342001;   // pg advisory lock: one outbox dispatcher
const MAX_ATTEMPTS = 3;              // per outbox event and per stream entry
const BATCH_SIZE = 50;
const TICK_INTERVAL_MS = 500;
const CLAIM_IDLE_MS = 1000;          // reclaim entries a dead consumer left pending

function createStreamWorker({ pool, redis, stream = 'agent-registry.assurance', group = 'registry-audit-v1' }) {
  const consumer = randomUUID();
  let running = false;
  let timer;

  async function publish(eventId) {
    if (!redis.isReady) throw new Error('Redis unavailable');
    const client = await pool.connect();
    let locked = false;
    try {
      // One dispatcher reserves attempts durably before sending. A process crash
      // consumes its reservation; it cannot reset the attempt budget.
      locked = (await client.query('SELECT pg_try_advisory_lock($1) AS locked', [DISPATCH_LOCK_ID])).rows[0].locked;
      if (!locked) return;
      // Recover an attempt reservation whose process died before recording its
      // failure. Do not resend an exhausted operation or invent a success.
      await client.query(`INSERT INTO agent_registry.delivery_incidents
        (severity,affected_id,cause,safe_state,recovery_condition)
        SELECT 'major',event_id::text,'automatic_attempts_exhausted','queued','operator_review_required'
        FROM agent_registry.event_outbox WHERE published_at IS NULL AND attempts>=$1
        ON CONFLICT DO NOTHING`, [MAX_ATTEMPTS]);
      const result = await client.query(`SELECT event_id, envelope FROM agent_registry.event_outbox
        WHERE published_at IS NULL AND attempts<$2 AND ($1::uuid IS NULL OR event_id=$1)
        ORDER BY aggregate_id, sequence LIMIT $3`, [eventId || null, MAX_ATTEMPTS, BATCH_SIZE]);
      for (const row of result.rows) await dispatch(client, row);
    } finally {
      let releaseError;
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock($1)', [DISPATCH_LOCK_ID]); }
        catch (error) { releaseError = error; }
      }
      client.release(releaseError);
    }
  }

  async function dispatch(client, row) {
    const attempt = await client.query(
      'UPDATE agent_registry.event_outbox SET attempts=attempts+1 WHERE event_id=$1 RETURNING attempts', [row.event_id]);
    try {
      await telemetry.observe('agent-registry', 'redis', 'xadd', () => bounded(() => redis.xAdd(stream, '*', {
        envelope: JSON.stringify(row.envelope),
      })), row.envelope.correlationId);
      await client.query('UPDATE agent_registry.event_outbox SET published_at=now() WHERE event_id=$1', [row.event_id]);
    } catch {
      const exhausted = attempt.rows[0].attempts >= MAX_ATTEMPTS;
      await incident(client, row.event_id, 'stream_publication_failed', 'queued',
        exhausted ? 'operator_review_required' : 'bounded_retry_after_dependency_recovery');
      telemetry.log('agent-registry', 'publication_pending', { correlationId: row.envelope.correlationId });
    }
  }

  async function processEntry(entry) {
    try {
      const existing = await pool.query('SELECT status FROM agent_registry.event_inbox WHERE stream_id=$1', [entry.id]);
      if (existing.rows[0]) {
        await bounded(() => redis.xAck(stream, group, entry.id));
        return;
      }
      // The counter stops at MAX_ATTEMPTS + 1: enough to know the budget is spent.
      const attempts = await pool.query(`INSERT INTO agent_registry.event_attempts (stream_id,attempts) VALUES ($1,1)
        ON CONFLICT (stream_id) DO UPDATE SET attempts=LEAST(event_attempts.attempts+1,$2) RETURNING attempts`,
      [entry.id, MAX_ATTEMPTS + 1]);
      if (attempts.rows[0].attempts > MAX_ATTEMPTS) {
        await pool.query(`INSERT INTO agent_registry.event_inbox (stream_id,status,reason)
          VALUES ($1,'quarantined','automatic_attempts_exhausted') ON CONFLICT DO NOTHING`, [entry.id]);
        await incident(pool, entry.id, 'automatic_attempts_exhausted', 'quarantined', 'operator_review_required');
        await bounded(() => redis.xAck(stream, group, entry.id));
        return;
      }
      await receive(entry);
    } catch {
      telemetry.log('agent-registry', 'consumer_attempt_failed');
    }
  }

  async function receive(entry) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let event;
      try { event = JSON.parse(entry.message.envelope); } catch { /* quarantined below */ }
      let authoritative;
      if (event && isUuid(event.eventId)) {
        authoritative = (await client.query(
          'SELECT envelope FROM agent_registry.event_outbox WHERE event_id=$1', [event.eventId])).rows[0]?.envelope;
      }
      if (!authoritative || !isDeepStrictEqual(event, authoritative)) {
        // Do not persist an untrusted payload or credentials. A reason and stream ID suffice.
        await client.query(`INSERT INTO agent_registry.event_inbox (stream_id,status,reason)
          VALUES ($1,'quarantined','invalid_or_unrecognized_event') ON CONFLICT DO NOTHING`, [entry.id]);
        await incident(client, entry.id, 'invalid_or_unrecognized_event', 'quarantined', 'operator_review_required');
      } else {
        await applyInOrder(client, entry, event);
      }
      await client.query('COMMIT');
      // A crash here leaves a Redis pending entry. Reclaim repeats no SQL effect.
      await bounded(() => redis.xAck(stream, group, entry.id));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Gaps remain durable and cannot advance the projection. Arrival of a
  // missing predecessor releases only this aggregate's contiguous sequence.
  async function applyInOrder(client, entry, event) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [event.aggregateId]);
    await client.query(`INSERT INTO agent_registry.event_projection (aggregate_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [event.aggregateId]);
    await client.query(`INSERT INTO agent_registry.event_inbox (stream_id,event_id,aggregate_id,sequence,status)
      VALUES ($1,$2,$3,$4,'waiting') ON CONFLICT DO NOTHING`, [entry.id, event.eventId, event.aggregateId, event.sequence]);
    while (true) {
      const next = await client.query(`SELECT i.event_id, i.sequence FROM agent_registry.event_inbox i
        JOIN agent_registry.event_projection p ON p.aggregate_id=i.aggregate_id
        WHERE i.aggregate_id=$1 AND i.status='waiting' AND i.sequence=p.sequence+1`, [event.aggregateId]);
      if (!next.rows[0]) break;
      await client.query(`UPDATE agent_registry.event_inbox SET status='applied' WHERE event_id=$1`, [next.rows[0].event_id]);
      await client.query(`UPDATE agent_registry.event_projection SET sequence=$2,event_id=$3 WHERE aggregate_id=$1`,
        [event.aggregateId, next.rows[0].sequence, next.rows[0].event_id]);
    }
  }

  async function consume() {
    try { await bounded(() => redis.xGroupCreate(stream, group, '0', { MKSTREAM: true })); }
    catch (error) { if (!error.message.includes('BUSYGROUP')) throw error; }
    const claimed = await bounded(() => redis.xAutoClaim(stream, group, consumer, CLAIM_IDLE_MS, '0-0', { COUNT: BATCH_SIZE }));
    for (const entry of claimed.messages || []) if (entry) await processEntry(entry);
    const batches = await bounded(() => redis.xReadGroup(group, consumer, { key: stream, id: '>' }, { COUNT: BATCH_SIZE }));
    for (const batch of batches || []) for (const entry of batch.messages) await processEntry(entry);
  }

  async function incident(client, affectedId, cause, safeState, recoveryCondition) {
    await client.query(`INSERT INTO agent_registry.delivery_incidents
      (severity,affected_id,cause,safe_state,recovery_condition) VALUES ('major',$1,$2,$3,$4)
      ON CONFLICT DO NOTHING`,
    [affectedId, cause, safeState, recoveryCondition]);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      await publish();
      if (process.env.REGISTRY_CONSUMER_ENABLED !== 'false') await consume();
    } catch {
      telemetry.log('agent-registry', 'event_delivery_pending');
    } finally {
      running = false;
    }
  }

  return {
    publish,
    consume,
    receive,
    start() {
      timer = setInterval(tick, TICK_INTERVAL_MS);
      timer.unref();
      void tick();
    },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createStreamWorker };
