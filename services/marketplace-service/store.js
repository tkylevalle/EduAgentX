'use strict';

// Persistence for Marketplace. Writes go through withRetry: lock, read, decide,
// insert, commit. Only credential_projection is ever updated (schema.sql).

const { applyCredentialEvent } = require('./projection');

const isUniqueViolation = (error) => error?.code === '23505';

async function withRetry(store, lockKey, work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await store.transaction(lockKey, work);
    } catch (error) {
      // The advisory lock should prevent this. If another writer still won the
      // race, re-read its committed rows once; a second collision is reported.
      if (attempt === 1 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

// One credential event, applied together with its inbox row so a redelivered
// event id is recognised and changes nothing.
async function applyProjectionEvent(store, event, { now = new Date().toISOString() } = {}) {
  if (!event || typeof event.eventId !== 'string' || !event.eventId) return { outcome: 'ignored', reason: 'invalid_event' };
  return withRetry(store, `projection:${event.credentialId}`, async (tx) => {
    if (await tx.hasInboxEvent(event.eventId)) return { outcome: 'duplicate', reason: null };
    const current = typeof event.credentialId === 'string' ? await tx.getProjection(event.credentialId) : null;
    const result = applyCredentialEvent(current, event);
    if (result.applied) await tx.upsertProjection(result.record, now);
    await tx.insertInboxEvent(event.eventId, result.applied ? 'applied' : `ignored:${result.reason}`, now);
    return { outcome: result.applied ? 'applied' : 'ignored', reason: result.reason };
  });
}

// --- PostgreSQL store (role marketplace_owner, schema marketplace_service only).

const S = 'marketplace_service';
const iso = (value) => (value instanceof Date ? value.toISOString() : value);
const toRequest = (r) => ({ id: r.id, createdBy: r.created_by, createdAt: iso(r.created_at),
  idempotencyKey: r.idempotency_key, requestFingerprint: r.request_fingerprint });
const toVersion = (r) => ({ requestId: r.request_id, version: r.version, content: r.content, digest: r.digest,
  createdBy: r.created_by, createdAt: iso(r.created_at), idempotencyKey: r.idempotency_key });
const toEvent = (r) => ({ requestId: r.request_id, eventType: r.event_type, version: r.version, actor: r.actor, at: iso(r.at) });
const toListing = (r) => ({ agentLearnerKey: r.agent_learner_key, eventType: r.event_type, actor: r.actor,
  at: iso(r.at), idempotencyKey: r.idempotency_key });
const toCheck = (r) => ({ checkId: r.check_id, requestId: r.request_id, version: r.version, requestDigest: r.request_digest,
  actor: r.actor, at: iso(r.at), idempotencyKey: r.idempotency_key, summary: r.summary });
const toResult = (r) => ({ checkId: r.check_id, agentLearnerKey: r.agent_learner_key, credentialId: r.credential_id,
  eligible: r.eligible, reasons: r.reasons, sources: r.sources });

function pgQueries(db) {
  const one = async (sql, params, map) => { const { rows } = await db.query(sql, params); return rows[0] ? map(rows[0]) : null; };
  const many = async (sql, params, map) => (await db.query(sql, params)).rows.map(map);
  const queries = {
    findRequestByKey: (createdBy, key) => one(`SELECT * FROM ${S}.capability_requests
      WHERE created_by = $1 AND idempotency_key = $2`, [createdBy, key], toRequest),
    getRequest: (id) => one(`SELECT * FROM ${S}.capability_requests WHERE id = $1`, [id], toRequest),
    getRequestsPage: (limit) => many(`SELECT * FROM ${S}.capability_requests
      ORDER BY created_at DESC, id DESC LIMIT $1`, [limit], toRequest),
    async insertRequest(r) {
      await db.query(`INSERT INTO ${S}.capability_requests (id, created_by, created_at, idempotency_key, request_fingerprint)
        VALUES ($1, $2, $3, $4, $5)`, [r.id, r.createdBy, r.createdAt, r.idempotencyKey, r.requestFingerprint]);
    },
    getVersions: (id) => many(`SELECT * FROM ${S}.capability_request_versions WHERE request_id = $1 ORDER BY version`, [id], toVersion),
    findVersionByKey: (id, createdBy, key) => one(`SELECT * FROM ${S}.capability_request_versions
      WHERE request_id = $1 AND created_by = $2 AND idempotency_key = $3`, [id, createdBy, key], toVersion),
    async insertVersion(v) {
      await db.query(`INSERT INTO ${S}.capability_request_versions
        (request_id, version, content, digest, created_by, created_at, idempotency_key) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [v.requestId, v.version, JSON.stringify(v.content), v.digest, v.createdBy, v.createdAt, v.idempotencyKey]);
    },
    getEvents: (id) => many(`SELECT * FROM ${S}.capability_request_events WHERE request_id = $1 ORDER BY event_id`, [id], toEvent),
    async insertEvent(e) {
      await db.query(`INSERT INTO ${S}.capability_request_events (request_id, event_type, version, actor, at)
        VALUES ($1, $2, $3, $4, $5)`, [e.requestId, e.eventType, e.version, e.actor, e.at]);
    },
    getListingEvents: (agentLearnerKey) => many(`SELECT * FROM ${S}.listing_events WHERE agent_learner_key = $1
      ORDER BY event_id`, [agentLearnerKey], toListing),
    findListingByKey: (agentLearnerKey, key) => one(`SELECT * FROM ${S}.listing_events
      WHERE agent_learner_key = $1 AND idempotency_key = $2`, [agentLearnerKey, key], toListing),
    async insertListingEvent(e) {
      await db.query(`INSERT INTO ${S}.listing_events (agent_learner_key, event_type, actor, at, idempotency_key)
        VALUES ($1, $2, $3, $4, $5)`, [e.agentLearnerKey, e.eventType, e.actor, e.at, e.idempotencyKey]);
    },
    async findCheckByKey(actor, key) {
      const check = await one(`SELECT * FROM ${S}.eligibility_checks WHERE actor = $1 AND idempotency_key = $2`, [actor, key], toCheck);
      return check ? { check, results: await queries.getResults(check.checkId) } : null;
    },
    async getCheck(checkId) {
      const check = await one(`SELECT * FROM ${S}.eligibility_checks WHERE check_id = $1`, [checkId], toCheck);
      return check ? { check, results: await queries.getResults(checkId) } : null;
    },
    getResults: (checkId) => many(`SELECT * FROM ${S}.eligibility_check_results WHERE check_id = $1
      ORDER BY agent_learner_key, credential_id`, [checkId], toResult),
    async insertCheck(c, results) {
      await db.query(`INSERT INTO ${S}.eligibility_checks
        (check_id, request_id, version, request_digest, actor, at, idempotency_key, summary)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [c.checkId, c.requestId, c.version, c.requestDigest, c.actor, c.at, c.idempotencyKey, JSON.stringify(c.summary)]);
      for (const r of results) {
        await db.query(`INSERT INTO ${S}.eligibility_check_results
          (check_id, agent_learner_key, credential_id, eligible, reasons, sources) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [c.checkId, r.agentLearnerKey, r.credentialId, r.eligible, JSON.stringify(r.reasons), JSON.stringify(r.sources)]);
      }
    },
    listProjection: () => many(`SELECT record FROM ${S}.credential_projection ORDER BY agent_learner_key, credential_id`,
      [], (r) => r.record),
    getProjection: (credentialId) => one(`SELECT record FROM ${S}.credential_projection WHERE credential_id = $1`,
      [credentialId], (r) => r.record),
    async upsertProjection(record, now) {
      await db.query(`INSERT INTO ${S}.credential_projection (credential_id, agent_learner_key, record, last_event_id, updated_at)
        VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (credential_id) DO UPDATE
        SET record = EXCLUDED.record, last_event_id = EXCLUDED.last_event_id, updated_at = EXCLUDED.updated_at`,
      [record.credentialId, record.agentLearnerKey, JSON.stringify(record), record.lastEventId, now]);
    },
    hasInboxEvent: async (eventId) => (await db.query(`SELECT 1 FROM ${S}.projection_inbox WHERE event_id = $1`, [eventId])).rowCount > 0,
    async insertInboxEvent(eventId, outcome, now) {
      await db.query(`INSERT INTO ${S}.projection_inbox (event_id, outcome, applied_at) VALUES ($1, $2, $3)`, [eventId, outcome, now]);
    },
  };
  return queries;
}

function createPgStore(pool) {
  const reads = pgQueries(pool);
  return {
    async health() { await pool.query('SELECT 1'); },
    async transaction(lockKey, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // One writer per request, listing or credential at a time, across every
        // Marketplace instance; released automatically at COMMIT or ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`marketplace:${lockKey}`]);
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
    async listRequests({ limit = 100 } = {}) {
      const requests = await reads.getRequestsPage(limit);
      return Promise.all(requests.map(async (request) => ({ request,
        versions: await reads.getVersions(request.id), events: await reads.getEvents(request.id) })));
    },
    async readRequest(id) {
      const request = await reads.getRequest(id);
      return request ? { request, versions: await reads.getVersions(id), events: await reads.getEvents(id) } : null;
    },
    readListing: (agentLearnerKey) => reads.getListingEvents(agentLearnerKey),
    readCheck: (checkId) => reads.getCheck(checkId),
    listProjection: () => reads.listProjection(),
  };
}

// --- In-memory store with the same interface, for route tests only. It enforces
// the same unique constraints so the retry and conflict paths can be exercised.

function createMemoryStore() {
  let state = { requests: [], versions: [], events: [], listings: [], checks: [], results: [],
    projection: new Map(), inbox: new Map() };
  let queue = Promise.resolve();
  const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });
  const copy = (value) => structuredClone(value ?? null);

  function queriesFor(s) {
    const guardWrite = () => {
      if (store.failNextWrite > 0) { store.failNextWrite -= 1; throw uniqueViolation(); }
    };
    const resultsOf = (checkId) => s.results.filter((r) => r.checkId === checkId)
      .sort((a, b) => a.agentLearnerKey.localeCompare(b.agentLearnerKey) || a.credentialId.localeCompare(b.credentialId));
    const queries = {
      async findRequestByKey(createdBy, key) { return copy(s.requests.find((r) => r.createdBy === createdBy && r.idempotencyKey === key)); },
      async getRequest(id) { return copy(s.requests.find((r) => r.id === id)); },
      async insertRequest(r) {
        guardWrite();
        if (s.requests.some((x) => x.id === r.id || (x.createdBy === r.createdBy && x.idempotencyKey === r.idempotencyKey)))
          throw uniqueViolation();
        s.requests.push(copy(r));
      },
      async getVersions(id) { return copy(s.versions.filter((v) => v.requestId === id).sort((a, b) => a.version - b.version)); },
      async findVersionByKey(id, createdBy, key) {
        return copy(s.versions.find((v) => v.requestId === id && v.createdBy === createdBy && v.idempotencyKey === key));
      },
      async insertVersion(v) {
        guardWrite();
        if (s.versions.some((x) => x.requestId === v.requestId && (x.version === v.version ||
          (x.createdBy === v.createdBy && x.idempotencyKey === v.idempotencyKey)))) throw uniqueViolation();
        s.versions.push(copy(v));
      },
      async getEvents(id) { return copy(s.events.filter((e) => e.requestId === id)); },
      async insertEvent(e) {
        guardWrite();
        if (e.eventType === 'closed' && s.events.some((x) => x.requestId === e.requestId && x.eventType === 'closed'))
          throw uniqueViolation();
        s.events.push(copy(e));
      },
      async getListingEvents(agentLearnerKey) { return copy(s.listings.filter((e) => e.agentLearnerKey === agentLearnerKey)); },
      async findListingByKey(agentLearnerKey, key) {
        return copy(s.listings.find((e) => e.agentLearnerKey === agentLearnerKey && e.idempotencyKey === key));
      },
      async insertListingEvent(e) {
        guardWrite();
        if (e.actor !== e.agentLearnerKey) throw new Error('listing actor must be the learner');
        if (s.listings.some((x) => x.agentLearnerKey === e.agentLearnerKey && x.idempotencyKey === e.idempotencyKey))
          throw uniqueViolation();
        s.listings.push(copy(e));
      },
      async findCheckByKey(actor, key) {
        const check = s.checks.find((c) => c.actor === actor && c.idempotencyKey === key);
        return check ? copy({ check, results: resultsOf(check.checkId) }) : null;
      },
      async getCheck(checkId) {
        const check = s.checks.find((c) => c.checkId === checkId);
        return check ? copy({ check, results: resultsOf(checkId) }) : null;
      },
      async insertCheck(c, results) {
        guardWrite();
        if (s.checks.some((x) => x.checkId === c.checkId || (x.actor === c.actor && x.idempotencyKey === c.idempotencyKey)))
          throw uniqueViolation();
        s.checks.push(copy(c));
        s.results.push(...results.map((r) => copy({ ...r, checkId: c.checkId })));
      },
      async listProjection() {
        return copy([...s.projection.values()].sort((a, b) =>
          a.agentLearnerKey.localeCompare(b.agentLearnerKey) || a.credentialId.localeCompare(b.credentialId)));
      },
      async getProjection(credentialId) { return copy(s.projection.get(credentialId)); },
      async upsertProjection(record) { s.projection.set(record.credentialId, copy(record)); },
      async hasInboxEvent(eventId) { return s.inbox.has(eventId); },
      async insertInboxEvent(eventId, outcome) {
        if (s.inbox.has(eventId)) throw uniqueViolation();
        s.inbox.set(eventId, outcome);
      },
    };
    return queries;
  }

  const store = {
    failNextWrite: 0,
    async health() {},
    transaction(_lockKey, work) {
      // Every transaction is serialised and works on a copy, so a throw rolls everything back.
      const run = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await work(queriesFor(draft));
        state = draft;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
    async listRequests({ limit = 100 } = {}) {
      const q = queriesFor(state);
      const page = [...state.requests].reverse().slice(0, limit);
      return Promise.all(page.map(async (request) => ({ request: copy(request),
        versions: await q.getVersions(request.id), events: await q.getEvents(request.id) })));
    },
    async readRequest(id) {
      const q = queriesFor(state);
      const request = await q.getRequest(id);
      return request ? { request, versions: await q.getVersions(id), events: await q.getEvents(id) } : null;
    },
    readListing: (agentLearnerKey) => queriesFor(state).getListingEvents(agentLearnerKey),
    readCheck: (checkId) => queriesFor(state).getCheck(checkId),
    listProjection: () => queriesFor(state).listProjection(),
  };
  return store;
}

module.exports = { createMemoryStore, createPgStore, withRetry, applyProjectionEvent, isUniqueViolation };
