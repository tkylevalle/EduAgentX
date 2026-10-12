'use strict';

const { randomUUID } = require('node:crypto');
const { sha256 } = require('../curriculum-engine/model');

const rowToAttempt = (row) => row && ({
  attemptId: row.attempt_id, agentLearnerKey: row.agent_learner_key,
  idempotencyKey: row.idempotency_key, configurationFingerprint: row.configuration_fingerprint,
  package: { id: row.package_id, version: row.package_version, digest: row.package_digest },
  formDigest: row.form_digest, form: row.form, mode: row.mode,
  startedAt: new Date(row.started_at).toISOString(), deadlineAt: new Date(row.deadline_at).toISOString(),
  correlationId: row.correlation_id,
});

function createPgStore(pool) {
  return {
    async health() { await pool.query('SELECT 1'); },
    async get(attemptId) {
      const result = await pool.query('SELECT * FROM examination_engine.attempts WHERE attempt_id = $1', [attemptId]);
      return rowToAttempt(result.rows[0]);
    },
    async findByKey(actor, key) {
      const result = await pool.query(
        'SELECT * FROM examination_engine.attempts WHERE agent_learner_key = $1 AND idempotency_key = $2',
        [actor, key]);
      return rowToAttempt(result.rows[0]);
    },
    async admit({ actor, key, form, now, deadlineAt, correlationId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor}:${key}`]);
        const found = await client.query(
          'SELECT * FROM examination_engine.attempts WHERE agent_learner_key = $1 AND idempotency_key = $2',
          [actor, key]);
        if (found.rows.length) {
          await client.query('COMMIT');
          return { attempt: rowToAttempt(found.rows[0]), replay: true };
        }
        const attemptId = randomUUID();
        const result = await client.query(
          `INSERT INTO examination_engine.attempts
           (attempt_id, agent_learner_key, idempotency_key, configuration_fingerprint,
            package_id, package_version, package_digest, form_digest, form, mode,
            started_at, deadline_at, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'standard',$10,$11,$12) RETURNING *`,
          [attemptId, actor, key, form.subject.configurationFingerprint,
            form.package.id, form.package.version, form.package.digest, sha256(form), JSON.stringify(form),
            now, deadlineAt, correlationId]);
        await client.query(
          `INSERT INTO examination_engine.attempt_events
           (attempt_id, seq, event_type, occurred_at, correlation_id)
           VALUES ($1, 1, 'attempt_started', $2, $3)`, [attemptId, now, correlationId]);
        await client.query('COMMIT');
        return { attempt: rowToAttempt(result.rows[0]), replay: false };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

function createMemoryStore() {
  const attempts = new Map();
  let serial = Promise.resolve();
  return {
    async health() {},
    async get(id) { return structuredClone(attempts.get(id) || null); },
    async findByKey(actor, key) {
      return structuredClone([...attempts.values()].find((a) => a.agentLearnerKey === actor && a.idempotencyKey === key) || null);
    },
    admit(input) {
      const run = serial.then(async () => {
        const existing = [...attempts.values()].find((a) => a.agentLearnerKey === input.actor && a.idempotencyKey === input.key);
        if (existing) return { attempt: structuredClone(existing), replay: true };
        const attempt = {
          attemptId: randomUUID(), agentLearnerKey: input.actor, idempotencyKey: input.key,
          configurationFingerprint: input.form.subject.configurationFingerprint,
          package: structuredClone(input.form.package), formDigest: sha256(input.form),
          form: structuredClone(input.form), mode: 'standard', startedAt: input.now,
          deadlineAt: input.deadlineAt, correlationId: input.correlationId,
        };
        attempts.set(attempt.attemptId, attempt);
        return { attempt: structuredClone(attempt), replay: false };
      });
      serial = run.catch(() => {});
      return run;
    },
  };
}

module.exports = { createPgStore, createMemoryStore };
