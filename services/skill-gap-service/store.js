'use strict';
const { fail } = require('./model');

function createPgStore(pool) {
  async function transaction(key, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`skill-gap:${key}`]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  const get = async (db, id) => (await db.query('SELECT document FROM skill_gap_service.recommendations WHERE id=$1', [id])).rows[0]?.document ?? null;
  const byCommand = async (db, actor, key) => (await db.query(`SELECT c.digest,r.document FROM skill_gap_service.commands c
    JOIN skill_gap_service.recommendations r ON r.id=c.recommendation_id WHERE c.actor=$1 AND c.command_key=$2`, [actor,key])).rows[0] ?? null;
  return {
    health: () => pool.query('SELECT 1 FROM skill_gap_service.recommendations LIMIT 1'),
    get: (id) => get(pool, id),
    async delivery(id) { return (await pool.query('SELECT document FROM skill_gap_service.handoff_attempts WHERE recommendation_id=$1 ORDER BY sequence DESC LIMIT 1',[id])).rows[0]?.document ?? null; },
    byCommand: (actor, key) => byCommand(pool, actor, key),
    async create(r, actor, key, fingerprint) {
      // Global ordering prevents both source-identity and per-actor command races.
      return transaction('create', async (db) => {
        const prior = await byCommand(db, actor, key);
        if (prior) {
          if (prior.digest !== fingerprint) throw fail('idempotency_conflict', 409);
          return { recommendation: prior.document, replay: true };
        }
        const existing = await get(db, r.recommendationId);
        if (existing && existing.source.digest !== r.source.digest) throw fail('source_conflict', 409);
        if (!existing) await db.query('INSERT INTO skill_gap_service.recommendations VALUES ($1,$2::jsonb)', [r.recommendationId, JSON.stringify(r)]);
        await db.query('INSERT INTO skill_gap_service.commands VALUES ($1,$2,$3,$4)', [actor,key,fingerprint,r.recommendationId]);
        return { recommendation: existing || r, replay: Boolean(existing) };
      });
    },
    async handoff(id, work) {
      // Bounded HTTP call under the per-recommendation lock serializes concurrent handoffs.
      // Lost COMMIT/response is safe: Training owns durable requestId deduplication.
      return transaction(`delivery:${id}`, async (db) => {
        const r = await get(db, id);
        if (!r) throw fail('recommendation_not_found', 404);
        const prior = (await db.query('SELECT document FROM skill_gap_service.deliveries WHERE recommendation_id=$1', [id])).rows[0]?.document;
        if (prior) return prior;
        const delivery = await work(r);
        await db.query('INSERT INTO skill_gap_service.handoff_attempts (recommendation_id,document) VALUES ($1,$2::jsonb)',[id,JSON.stringify(delivery)]);
        if (['delivered','refused'].includes(delivery.outcome)) await db.query('INSERT INTO skill_gap_service.deliveries VALUES ($1,$2::jsonb)', [id, JSON.stringify(delivery)]);
        return delivery;
      });
    },
  };
}

// Route tests only; production startup always uses PostgreSQL.
function createMemoryStore() {
  let state = { recommendations: new Map(), commands: new Map(), deliveries: new Map(), attempts: new Map() };
  let queue = Promise.resolve();
  const copy = (v) => structuredClone(v ?? null);
  const transaction = (work) => {
    const run = queue.then(async () => {
      const draft = copy(state), result = await work(draft);
      state = draft;
      return copy(result);
    });
    queue = run.catch(() => {});
    return run;
  };
  return {
    async health() {},
    async get(id) { return copy(state.recommendations.get(id)); },
    async delivery(id) { return copy(state.attempts.get(id)); },
    async byCommand(actor,key) { return copy(state.commands.get(JSON.stringify([actor,key]))); },
    create(r,actor,key,fingerprint) {
      return transaction(async (s) => {
        const commandKey = JSON.stringify([actor,key]), prior = s.commands.get(commandKey);
        if (prior && prior.digest !== fingerprint) throw fail('idempotency_conflict',409);
        const existing = s.recommendations.get(r.recommendationId);
        if (existing && existing.source.digest !== r.source.digest) throw fail('source_conflict',409);
        s.recommendations.set(r.recommendationId, existing || r);
        s.commands.set(commandKey, { digest: fingerprint, document: existing || r });
        return { recommendation: existing || r, replay: Boolean(existing) };
      });
    },
    handoff(id,work) {
      return transaction(async (s) => {
        if (!s.recommendations.has(id)) throw fail('recommendation_not_found',404);
        if (s.deliveries.has(id)) return s.deliveries.get(id);
        const d = await work(copy(s.recommendations.get(id)));
        s.attempts.set(id,d);
        if (['delivered','refused'].includes(d.outcome)) s.deliveries.set(id,d);
        return d;
      });
    },
  };
}
module.exports = { createPgStore, createMemoryStore };
