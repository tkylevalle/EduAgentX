'use strict';

// Persistence for Training Sessions. Writes go through decideAndAppend: lock
// the Agent Learner, load, decide with the pure functions, append, commit.
// Rows are only ever inserted; schema.sql forbids UPDATE and DELETE.

const { deriveSessionState } = require('./session');

const isUniqueViolation = (error) => error?.code === '23505';
// At most one of these per session, enforced by a unique index in schema.sql.
const isTerminal = (eventType) => eventType === 'session_completed' || eventType === 'session_blocked';
// One relay at a time publishes the completion outbox, across every Training instance.
const RELAY_LOCK = 'training-relay:completions';

async function decideAndAppend(store, lockKey, decide) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await store.transaction(lockKey, async (tx) => {
        const decision = await decide(tx);
        // A session row is written with its first event, whether that is a
        // learner's start or a remediation assignment.
        if (decision.events.some((event) => event.seq === 1)) await tx.insertSession(decision.session);
        if (decision.events.length) await tx.insertEvents(decision.events);
        // The completion event commits with the session_completed row or not at all.
        if (decision.completion) await tx.insertCompletion(decision.completion);
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
  package_id, package_version, package_digest, started_at, correlation_id, kind, remediation, completion_policy,
  delivery_plan`;
const iso = (value) => (value instanceof Date ? value.toISOString() : value);
const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));

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
    kind: row.kind,
    remediation: row.remediation,
    completionPolicy: row.completion_policy,
    deliveryPlan: row.delivery_plan,
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
    itemKind: row.item_kind,
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
    async findRemediation(agentLearnerKey, requestId) {
      const result = await db.query(
        `SELECT ${SESSION_COLUMNS} FROM training_service.sessions
         WHERE agent_learner_key = $1 AND kind = 'remediation' AND remediation->>'requestId' = $2`,
        [agentLearnerKey, requestId]);
      if (!result.rows[0]) return null;
      const session = toSession(result.rows[0]);
      return { session, events: await this.getEvents(session.sessionId) };
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
        `INSERT INTO training_service.sessions (${SESSION_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)`,
        [s.sessionId, s.agentLearnerKey, s.configurationFingerprint, s.configurationVersion,
          s.packageId, s.packageVersion, s.packageDigest, s.startedAt, s.correlationId, s.kind,
          json(s.remediation), json(s.completionPolicy), json(s.deliveryPlan)]);
    },
    async insertEvents(events) {
      for (const e of events) {
        await db.query(
          `INSERT INTO training_service.session_events (session_id, seq, event_type, package_id, package_version,
             module_id, module_sequence, objective_ids, delivery_item_id, evidence_mode, evidence_environment,
             occurred_at, correlation_id, actor, idempotency_key, request_fingerprint, response_digest,
             stored_response, block_reason, item_kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20)`,
          [e.sessionId, e.seq, e.eventType, e.packageId, e.packageVersion, e.moduleId, e.moduleSequence,
            e.objectiveIds, e.deliveryItemId, e.evidenceMode, e.evidenceEnvironment, e.occurredAt, e.correlationId,
            e.actor, e.idempotencyKey, e.requestFingerprint, e.responseDigest, json(e.storedResponse), e.blockReason,
            e.itemKind ?? null]);
      }
    },
    async insertCompletion(envelope) {
      await db.query(
        `INSERT INTO training_service.completion_events (event_id, session_id, envelope, occurred_at)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [envelope.eventId, envelope.sessionId, JSON.stringify(envelope), envelope.occurredAt]);
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
    // Every session, with only the fields the metrics need, so the counts
    // cover all sessions and not just the latest page.
    async metricsInput() {
      const result = await pool.query(
        `SELECT s.session_id, s.kind,
                COALESCE(array_agg(e.event_type ORDER BY e.seq) FILTER (WHERE e.seq IS NOT NULL), '{}') AS event_types,
                max(e.block_reason) AS block_reason
         FROM training_service.sessions s
         LEFT JOIN training_service.session_events e ON e.session_id = s.session_id
         GROUP BY s.session_id, s.kind`);
      return result.rows.map((row) => ({
        session: { sessionId: row.session_id, kind: row.kind },
        events: row.event_types.map((eventType) => ({
          eventType, blockReason: eventType === 'session_blocked' ? row.block_reason : null,
        })),
      }));
    },
    async listCompletionEvents({ limit = 100 } = {}) {
      const result = await pool.query(
        'SELECT envelope FROM training_service.completion_events ORDER BY occurred_at DESC, event_id LIMIT $1', [limit]);
      return result.rows.map((row) => row.envelope);
    },
    // Started sessions with no terminal event and no event since `cutoff`, oldest first.
    async listIdleOpenSessions(cutoff, limit = 100) {
      const result = await pool.query(
        `SELECT s.session_id, s.agent_learner_key
         FROM training_service.sessions s
         JOIN training_service.session_events e ON e.session_id = s.session_id
         GROUP BY s.session_id, s.agent_learner_key
         HAVING bool_or(e.event_type = 'session_started')
            AND NOT bool_or(e.event_type IN ('session_completed', 'session_blocked'))
            AND max(e.occurred_at) < $1
         ORDER BY max(e.occurred_at), s.session_id LIMIT $2`, [cutoff, limit]);
      return result.rows.map((row) => ({ sessionId: row.session_id, agentLearnerKey: row.agent_learner_key }));
    },
    async publishPendingCompletions(publish, limit = 100) {
      return publishUnderRelayLock(pool, publish, limit);
    },
    async completionPublicationCounts() {
      const result = await pool.query(
        `SELECT count(*)::int AS total, count(p.event_id)::int AS published
         FROM training_service.completion_events c
         LEFT JOIN training_service.completion_publications p ON p.event_id = c.event_id`);
      const { total, published } = result.rows[0];
      return { total, published, pending: total - published };
    },
  };
}

// Sends each unpublished completion event, oldest first, and records its
// stream id. A send that fails stops the run with nothing recorded for that
// event, so the next run sends it again: delivery is at least once.
async function publishUnderRelayLock(pool, publish, limit) {
  const client = await pool.connect();
  let releaseError;
  // pg-pool removes its idle 'error' listener on checkout. The relay holds this
  // client while it waits on Redis, so a Postgres restart then must not crash
  // the process; the error destroys the client instead of returning it.
  const onError = (error) => { releaseError = error; };
  client.on('error', onError);
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [RELAY_LOCK]);
    if (!lock.rows[0].locked) return 0;
    try {
      const pending = await client.query(
        `SELECT c.event_id, c.envelope FROM training_service.completion_events c
         WHERE NOT EXISTS (SELECT 1 FROM training_service.completion_publications p WHERE p.event_id = c.event_id)
         ORDER BY c.occurred_at, c.event_id LIMIT $1`, [limit]);
      for (const row of pending.rows) {
        const streamId = await publish(row.envelope);
        await client.query(
          `INSERT INTO training_service.completion_publications (event_id, stream_id) VALUES ($1, $2)
           ON CONFLICT (event_id) DO NOTHING`, [row.event_id, streamId]);
      }
      return pending.rows.length;
    } finally {
      // A session lock outlives the query; if the unlock fails, the connection
      // is destroyed instead of returned, which releases the lock with it.
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [RELAY_LOCK])
        .catch((error) => { releaseError = error; });
    }
  } finally {
    client.off('error', onError);
    client.release(releaseError);
  }
}

// --- In-memory store with the same interface, for route tests only. It
// enforces the same unique constraints so the retry path can be exercised.

function createMemoryStore() {
  const sessions = new Map();
  const events = [];
  const completions = new Map();
  const publications = new Map();
  let queue = Promise.resolve();
  const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });
  const store = {
    failNextAppend: 0,
    async health() {},
    transaction(lockKey, work) {
      // Every transaction is serialised, which is stricter than a per-learner lock.
      const run = queue.then(async () => {
        const staged = { sessions: [], events: [], completions: [] };
        const allEvents = () => [...events, ...staged.events];
        const tx = {
          async findOpenSession(agentLearnerKey) {
            const candidates = [...sessions.values(), ...staged.sessions]
              .filter((s) => s.agentLearnerKey === agentLearnerKey)
              .filter((s) => ['open', 'assigned'].includes(
                deriveSessionState(allEvents().filter((e) => e.sessionId === s.sessionId)).status));
            return structuredClone(candidates.at(-1) || null);
          },
          async findRemediation(agentLearnerKey, requestId) {
            const session = [...sessions.values()].find((s) => s.agentLearnerKey === agentLearnerKey &&
              s.kind === 'remediation' && s.remediation.requestId === requestId);
            return session
              ? structuredClone({ session, events: allEvents().filter((e) => e.sessionId === session.sessionId) })
              : null;
          },
          async getSession(sessionId) { return structuredClone(sessions.get(sessionId) || null); },
          async getEvents(sessionId) { return structuredClone(allEvents().filter((e) => e.sessionId === sessionId)); },
          async insertSession(session) {
            if (sessions.has(session.sessionId)) throw uniqueViolation();
            const sameRequest = (s) => s.kind === 'remediation' && session.kind === 'remediation' &&
              s.agentLearnerKey === session.agentLearnerKey && s.remediation.requestId === session.remediation.requestId;
            if ([...sessions.values(), ...staged.sessions].some(sameRequest)) throw uniqueViolation();
            staged.sessions.push(structuredClone(session));
          },
          async insertEvents(list) {
            if (store.failNextAppend > 0) {
              store.failNextAppend -= 1;
              throw uniqueViolation();
            }
            for (const event of list) {
              const clash = allEvents().some((e) => e.sessionId === event.sessionId && (e.seq === event.seq ||
                (event.idempotencyKey && e.idempotencyKey === event.idempotencyKey) ||
                (isTerminal(event.eventType) && isTerminal(e.eventType))));
              if (clash) throw uniqueViolation();
              staged.events.push(structuredClone(event));
            }
          },
          async insertCompletion(envelope) {
            const taken = [...completions.values(), ...staged.completions]
              .some((c) => c.eventId === envelope.eventId || c.sessionId === envelope.sessionId);
            if (taken) throw uniqueViolation();
            staged.completions.push(structuredClone(envelope));
          },
        };
        const result = await work(tx);
        for (const session of staged.sessions) sessions.set(session.sessionId, session);
        events.push(...staged.events);
        for (const completion of staged.completions) completions.set(completion.eventId, completion);
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
    async metricsInput() { return store.listSessions(); },
    async listCompletionEvents() { return structuredClone([...completions.values()].reverse()); },
    async listIdleOpenSessions(cutoff, limit = 100) {
      const before = new Date(cutoff).getTime();
      return [...sessions.values()]
        .map((session) => ({ session, state: deriveSessionState(events.filter((e) => e.sessionId === session.sessionId)) }))
        .filter(({ state }) => state.status === 'open' && new Date(state.lastEventAt).getTime() < before)
        .sort((a, b) => new Date(a.state.lastEventAt).getTime() - new Date(b.state.lastEventAt).getTime())
        .slice(0, limit)
        .map(({ session }) => ({ sessionId: session.sessionId, agentLearnerKey: session.agentLearnerKey }));
    },
    async publishPendingCompletions(publish, limit = 100) {
      const pending = [...completions.values()].filter((c) => !publications.has(c.eventId)).slice(0, limit);
      for (const envelope of pending) publications.set(envelope.eventId, await publish(structuredClone(envelope)));
      return pending.length;
    },
    async completionPublicationCounts() {
      return { total: completions.size, published: publications.size, pending: completions.size - publications.size };
    },
  };
  return store;
}

module.exports = { createMemoryStore, createPgStore, decideAndAppend, isUniqueViolation };
