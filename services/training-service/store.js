'use strict';

// Persistence for Training Sessions. Writes go through decideAndAppend: lock
// the Agent Learner, load, decide with the pure functions, append, commit.
// Rows are only ever inserted; schema.sql forbids UPDATE and DELETE.

const { deriveSessionState } = require('./session');

const isUniqueViolation = (error) => error?.code === '23505';

async function decideAndAppend(store, lockKey, decide) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await store.transaction(lockKey, async (tx) => {
        const decision = await decide(tx);
        if (decision.events.some((event) => event.eventType === 'session_started')) await tx.insertSession(decision.session);
        if (decision.events.length) await tx.insertEvents(decision.events);
        return decision;
      });
    } catch (error) {
      // The advisory lock should prevent this. If another writer still won
      // the race, re-read its committed events and decide once more; a second
      // collision is reported rather than retried forever.
      if (attempt === 1 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

// --- PostgreSQL store (role training_owner, schema training_service only).

const SESSION_COLUMNS = `session_id, agent_learner_key, configuration_fingerprint, configuration_version,
  package_id, package_version, package_digest, started_at, correlation_id`;
const iso = (value) => (value instanceof Date ? value.toISOString() : value);

function toSession(row) {
  return {
    sessionId: row.session_id,
    agentLearnerKey: row.agent_learner_key,
    configurationFingerprint: row.configuration_fingerprint,
    configurationVersion: row.configuration_version,
    packageId: row.package_id,
    packageVersion: row.package_version,
    packageDigest: row.package_digest,
    startedAt: iso(row.started_at),
    correlationId: row.correlation_id,
  };
}

function toEvent(row) {
  return {
    sessionId: row.session_id,
    seq: row.seq,
    eventType: row.event_type,
    packageId: row.package_id,
    packageVersion: row.package_version,
    moduleId: row.module_id,
    moduleSequence: row.module_sequence,
    objectiveIds: row.objective_ids,
    deliveryItemId: row.delivery_item_id,
    evidenceMode: row.evidence_mode,
    evidenceEnvironment: row.evidence_environment,
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    correlationId: row.correlation_id,
    actor: row.actor,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    responseDigest: row.response_digest,
    storedResponse: row.stored_response,
    blockReason: row.block_reason,
  };
}

function pgQueries(db) {
  return {
    async findOpenSession(agentLearnerKey) {
      // Open = started with no completion or block event yet.
      const result = await db.query(
        `SELECT ${SESSION_COLUMNS} FROM training_service.sessions s
         WHERE s.agent_learner_key = $1 AND NOT EXISTS (
           SELECT 1 FROM training_service.session_events e
           WHERE e.session_id = s.session_id AND e.event_type IN ('session_completed', 'session_blocked'))
         ORDER BY s.started_at DESC LIMIT 1`, [agentLearnerKey]);
      return result.rows[0] ? toSession(result.rows[0]) : null;
    },
    async getSession(sessionId) {
      const result = await db.query(`SELECT ${SESSION_COLUMNS} FROM training_service.sessions WHERE session_id = $1`, [sessionId]);
      return result.rows[0] ? toSession(result.rows[0]) : null;
    },
    async getEvents(sessionId) {
      const result = await db.query('SELECT * FROM training_service.session_events WHERE session_id = $1 ORDER BY seq', [sessionId]);
      return result.rows.map(toEvent);
    },
    async insertSession(s) {
      await db.query(
        `INSERT INTO training_service.sessions (${SESSION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [s.sessionId, s.agentLearnerKey, s.configurationFingerprint, s.configurationVersion,
          s.packageId, s.packageVersion, s.packageDigest, s.startedAt, s.correlationId]);
    },
    async insertEvents(events) {
      for (const e of events) {
        await db.query(
          `INSERT INTO training_service.session_events (session_id, seq, event_type, package_id, package_version,
             module_id, module_sequence, objective_ids, delivery_item_id, evidence_mode, evidence_environment,
             occurred_at, correlation_id, actor, idempotency_key, request_fingerprint, response_digest,
             stored_response, block_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19)`,
          [e.sessionId, e.seq, e.eventType, e.packageId, e.packageVersion, e.moduleId, e.moduleSequence,
            e.objectiveIds, e.deliveryItemId, e.evidenceMode, e.evidenceEnvironment, e.occurredAt, e.correlationId,
            e.actor, e.idempotencyKey, e.requestFingerprint, e.responseDigest,
            e.storedResponse === null ? null : JSON.stringify(e.storedResponse), e.blockReason]);
      }
    },
  };
}

function createPgStore(pool) {
  const reads = pgQueries(pool);
  return {
    async health() { await pool.query('SELECT 1'); },
    async transaction(lockKey, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // One writer per Agent Learner at a time, across every Training
        // instance; released automatically at COMMIT or ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`training:${lockKey}`]);
        const result = await work(pgQueries(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async listSessions({ agentLearnerKey, limit = 100 } = {}) {
      const result = agentLearnerKey
        ? await pool.query(`SELECT ${SESSION_COLUMNS} FROM training_service.sessions WHERE agent_learner_key = $1
            ORDER BY started_at DESC, session_id LIMIT $2`, [agentLearnerKey, limit])
        : await pool.query(`SELECT ${SESSION_COLUMNS} FROM training_service.sessions
            ORDER BY started_at DESC, session_id LIMIT $1`, [limit]);
      const sessions = result.rows.map(toSession);
      if (!sessions.length) return [];
      const events = await pool.query(
        'SELECT * FROM training_service.session_events WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, seq',
        [sessions.map((s) => s.sessionId)]);
      const byId = Map.groupBy(events.rows.map(toEvent), (event) => event.sessionId);
      return sessions.map((session) => ({ session, events: byId.get(session.sessionId) || [] }));
    },
    async readSession(sessionId) {
      const session = await reads.getSession(sessionId);
      return session ? { session, events: await reads.getEvents(sessionId) } : null;
    },
  };
}

// --- In-memory store with the same interface, for route tests only. It
// enforces the same unique constraints so the retry path can be exercised.

function createMemoryStore() {
  const sessions = new Map();
  const events = [];
  let queue = Promise.resolve();
  const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });
  const store = {
    failNextAppend: 0,
    async health() {},
    transaction(lockKey, work) {
      // Every transaction is serialised, which is stricter than a per-learner lock.
      const run = queue.then(async () => {
        const staged = { sessions: [], events: [] };
        const allEvents = () => [...events, ...staged.events];
        const tx = {
          async findOpenSession(agentLearnerKey) {
            const candidates = [...sessions.values(), ...staged.sessions]
              .filter((s) => s.agentLearnerKey === agentLearnerKey)
              .filter((s) => deriveSessionState(allEvents().filter((e) => e.sessionId === s.sessionId)).status === 'open');
            return structuredClone(candidates.at(-1) || null);
          },
          async getSession(sessionId) { return structuredClone(sessions.get(sessionId) || null); },
          async getEvents(sessionId) { return structuredClone(allEvents().filter((e) => e.sessionId === sessionId)); },
          async insertSession(session) {
            if (sessions.has(session.sessionId)) throw uniqueViolation();
            staged.sessions.push(structuredClone(session));
          },
          async insertEvents(list) {
            if (store.failNextAppend > 0) {
              store.failNextAppend -= 1;
              throw uniqueViolation();
            }
            for (const event of list) {
              const clash = allEvents().some((e) => e.sessionId === event.sessionId && (e.seq === event.seq ||
                (event.idempotencyKey && e.idempotencyKey === event.idempotencyKey)));
              if (clash) throw uniqueViolation();
              staged.events.push(structuredClone(event));
            }
          },
        };
        const result = await work(tx);
        for (const session of staged.sessions) sessions.set(session.sessionId, session);
        events.push(...staged.events);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
    async listSessions({ agentLearnerKey } = {}) {
      return [...sessions.values()].reverse()
        .filter((s) => !agentLearnerKey || s.agentLearnerKey === agentLearnerKey)
        .map((session) => structuredClone({ session, events: events.filter((e) => e.sessionId === session.sessionId) }));
    },
    async readSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? structuredClone({ session, events: events.filter((e) => e.sessionId === sessionId) }) : null;
    },
  };
  return store;
}

module.exports = { createMemoryStore, createPgStore, decideAndAppend, isUniqueViolation };
