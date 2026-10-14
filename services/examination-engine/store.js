'use strict';

const { randomUUID } = require('node:crypto');
const { sha256 } = require('../curriculum-engine/model');
const { fail, validateCommand, commandDigest, derive, stateReceipt, isResponseExpired } = require('./lifecycle');

const rowToAttempt = (row) => row && ({
  attemptId: row.attempt_id, agentLearnerKey: row.agent_learner_key,
  idempotencyKey: row.idempotency_key, configurationFingerprint: row.configuration_fingerprint,
  package: { id: row.package_id, version: row.package_version, digest: row.package_digest },
  formDigest: row.form_digest, form: row.form, mode: row.mode,
  startedAt: new Date(row.started_at).toISOString(), deadlineAt: new Date(row.deadline_at).toISOString(),
  correlationId: row.correlation_id,
  fallbackCauseAttemptId: row.fallback_cause_attempt_id ?? null, fallbackReason: row.fallback_reason ?? null,
  fallbackBankId: row.fallback_bank_id ?? null, fallbackBankVersion: row.fallback_bank_version ?? null,
  fallbackBankDigest: row.fallback_bank_digest ?? null,
});
const NO_FALLBACK = Object.freeze({ fallbackCauseAttemptId: null, fallbackReason: null, fallbackBankId: null,
  fallbackBankVersion: null, fallbackBankDigest: null });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Checked before any write, identically for both stores: PostgreSQL's CHECK
// would refuse these rows, and a form whose mode differs from the row would
// commit but then fail derive() on every read.
function checkFallbackAdmission({ form, causeAttemptId = null, reason, bankId, bankVersion, bankDigest }) {
  const text = (value) => typeof value === 'string' && value.length > 0;
  if (form?.mode !== 'fallback' || !text(reason) || !text(bankId) || !text(bankVersion) || !text(bankDigest) ||
    (causeAttemptId !== null && (typeof causeAttemptId !== 'string' || !UUID.test(causeAttemptId))))
    throw fail('invalid_fallback_admission', 400);
}
const snapshot = (record) => derive(record.attempt, record.events, record.responses);
const reply = (record, receipt, replay) => ({ attempt: snapshot(record), receipt: structuredClone(receipt), replay });

function execute(record, command) {
  validateCommand(command);
  let current = snapshot(record);
  const system = ['timeout', 'system_abort'].includes(command.type);
  const digest = system ? null : commandDigest(current.attemptId, command);
  if (!system) {
    const saved = record.commands.find((c) => c.key === command.idempotencyKey);
    if (saved) {
      if (saved.digest !== digest) throw fail('idempotency_conflict');
      return reply(record, saved.receipt, true);
    }
    const duplicate = command.eventId && record.commands.find((c) => c.eventId === command.eventId);
    if (duplicate) {
      if (duplicate.digest !== digest) throw fail('event_identity_conflict');
      record.commands.push({ key: command.idempotencyKey, digest, receipt: duplicate.receipt, eventId: null });
      return reply(record, duplicate.receipt, true);
    }
    // An item's first accepted answer is final, even across distinct command keys.
    if (command.type === 'response') {
      if (!current.form.items.some((item) => item.id === command.itemId)) throw fail('unknown_item', 400);
      const accepted = record.responses.find((r) => r.itemId === command.itemId);
      if (accepted) {
        if (accepted.response !== command.response) throw fail('answer_conflict');
        record.commands.push({ key: command.idempotencyKey, digest, receipt: accepted.receipt, eventId: null });
        return reply(record, accepted.receipt, true);
      }
    }
    if (current.status !== 'in_progress') throw fail('attempt_terminal');
    if (command.expectedSequence !== current.sequence) throw fail('sequence_conflict');
  } else if (current.status !== 'in_progress') return { attempt: current, replay: true };
  if (command.type === 'timeout' && !isResponseExpired(current, command.now)) return { attempt: current, replay: true };
  if (Date.parse(command.now) < Date.parse(record.events.at(-1).occurredAt)) throw fail('timestamp_conflict');

  const append = (eventType, payload, eventId = randomUUID()) => {
    record.events.push({ attemptId: current.attemptId, seq: record.events.length + 1, eventId,
      eventType, payload, occurredAt: command.now, correlationId: command.correlationId || current.correlationId });
  };
  if (command.type === 'timeout' || (command.type === 'response' && isResponseExpired(current, command.now))) {
    if (!isResponseExpired(current, command.now)) return { attempt: current, replay: true };
    append('agent_failed', { reason: 'response_deadline_elapsed' }, `timeout:${current.attemptId}`);
    current = snapshot(record);
    // Commit timeout evidence even though the late submission itself is rejected.
    return command.type === 'response' ? { error: fail('attempt_deadline_elapsed'), attempt: current } : { attempt: current, replay: false };
  }
  if (command.type === 'response') {
    const responseDigest = sha256(command.response);
    append('response_accepted', { itemId: command.itemId, responseDigest });
    const response = { itemId: command.itemId, response: command.response, responseDigest,
      acceptedAt: command.now, seq: record.events.length };
    record.responses.push(response);
    current = snapshot(record);
    response.receipt = stateReceipt(current);
  } else if (command.type === 'finalize') {
    if (!current.responseCollectionComplete) throw fail('responses_incomplete');
    if (command.formDigest !== current.formDigest || command.rubricDigest !== current.form.rubric.digest ||
      command.responseSetDigest !== current.responseSetDigest) throw fail('result_binding_mismatch');
    append('grade_recorded', { result: command.result, formDigest: command.formDigest,
      rubricDigest: command.rubricDigest, responseSetDigest: command.responseSetDigest }, command.eventId);
    append(command.result.passed ? 'attempt_completed' : 'agent_failed',
      { reason: command.result.passed ? 'valid_passing_result' : 'valid_failing_result' }, `${command.eventId}:terminal`);
    current = snapshot(record);
  } else {
    append('system_aborted', { reason: command.reason }, command.eventId || `abort:${current.attemptId}`);
    current = snapshot(record);
  }
  const receipt = stateReceipt(current);
  if (!system) record.commands.push({ key: command.idempotencyKey, digest, receipt, eventId: command.eventId || null });
  return reply(record, receipt, false);
}


async function guardedExecute(record, command, options = {}) {
  // Validate and replay before consulting live dependencies: committed receipts survive outages.
  command = { ...command, now: options.clock ? options.clock() : command.now };
  const preview = execute(structuredClone(record), command);
  if (!preview.replay && !preview.error && options.guard) {
    try { await options.guard(snapshot(record)); }
    catch (error) {
      execute(record, { type: 'system_abort', reason: error.status === 409 ? 'governance_changed' : 'infrastructure_failure',
        now: options.clock ? options.clock() : command.now, correlationId: command.correlationId });
      return { error, attempt: snapshot(record) };
    }
  }
  const now = options.clock ? options.clock() : command.now;
  const result = execute(record, { ...command, now });
  if (result.replay && options.clock) {
    execute(record, { type: 'timeout', now, correlationId: command.correlationId });
    result.attempt = snapshot(record);
  }
  return result;
}

async function readRecord(client, attemptId) {
  const manifest = await client.query('SELECT * FROM examination_engine.attempts WHERE attempt_id = $1 FOR UPDATE', [attemptId]);
  if (!manifest.rows.length) return null;
  const events = await client.query('SELECT * FROM examination_engine.attempt_events WHERE attempt_id = $1 ORDER BY seq', [attemptId]);
  const responses = await client.query('SELECT * FROM examination_engine.attempt_responses WHERE attempt_id = $1 ORDER BY seq', [attemptId]);
  const commands = await client.query('SELECT * FROM examination_engine.attempt_commands WHERE attempt_id = $1', [attemptId]);
  return { attempt: rowToAttempt(manifest.rows[0]), events: events.rows.map((r) => ({ attemptId: r.attempt_id,
    seq: r.seq, eventType: r.event_type, eventId: r.event_id, payload: r.payload,
    occurredAt: new Date(r.occurred_at).toISOString(), correlationId: r.correlation_id })),
  responses: responses.rows.map((r) => ({ itemId: r.item_id, response: r.response, responseDigest: r.response_digest,
    acceptedAt: new Date(r.accepted_at).toISOString(), seq: r.seq, receipt: r.receipt })),
  commands: commands.rows.map((r) => ({ key: r.idempotency_key, digest: r.command_digest, eventId: r.event_id, receipt: r.receipt })) };
}

function createPgStore(pool) {
  async function transaction(id, action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`examination:${id}`]);
      const record = await readRecord(client, id);
      if (!record) throw fail('attempt_not_found', 404);
      const before = { events: record.events.length, responses: record.responses.length, commands: record.commands.length };
      const result = await action(record);
      for (const e of record.events.slice(before.events)) await client.query(
        `INSERT INTO examination_engine.attempt_events (attempt_id,seq,event_type,occurred_at,correlation_id,event_id,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,e.seq,e.eventType,e.occurredAt,e.correlationId,e.eventId,JSON.stringify(e.payload)]);
      for (const r of record.responses.slice(before.responses)) await client.query(
        `INSERT INTO examination_engine.attempt_responses (attempt_id,item_id,response,response_digest,accepted_at,seq,receipt)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,r.itemId,r.response,r.responseDigest,r.acceptedAt,r.seq,JSON.stringify(r.receipt)]);
      for (const c of record.commands.slice(before.commands)) await client.query(
        `INSERT INTO examination_engine.attempt_commands (attempt_id,idempotency_key,command_digest,event_id,receipt)
         VALUES ($1,$2,$3,$4,$5)`, [id,c.key,c.digest,c.eventId,JSON.stringify(c.receipt)]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw fail('event_identity_conflict');
      throw error;
    } finally { client.release(); }
  }
  return {
    async health() { await pool.query('SELECT 1'); },
    async get(id, reconcile) {
      const found = await pool.query('SELECT 1 FROM examination_engine.attempts WHERE attempt_id=$1', [id]);
      if (!found.rows.length) return null;
      return transaction(id, (record) => {
        if (reconcile) execute(record, { type: 'timeout', ...reconcile, now: reconcile.clock ? reconcile.clock() : reconcile.now });
        return snapshot(record);
      });
    },
    async findByKey(actor, key) {
      const result = await pool.query('SELECT attempt_id FROM examination_engine.attempts WHERE agent_learner_key=$1 AND idempotency_key=$2', [actor,key]);
      return result.rows.length ? this.get(result.rows[0].attempt_id) : null;
    },
    async command(id, command, options) {
      const result = await transaction(id, (record) => guardedExecute(record, command, options));
      if (result.error) { result.error.attempt = result.attempt; throw result.error; }
      return result;
    },
    async sweepExpired(now) {
      const ids = await pool.query(`SELECT a.attempt_id FROM examination_engine.attempts a WHERE deadline_at <= $1
        AND NOT EXISTS (SELECT 1 FROM examination_engine.attempt_events e WHERE e.attempt_id=a.attempt_id
          AND e.event_type IN ('attempt_completed','agent_failed','system_aborted'))
        AND (SELECT count(*) FROM examination_engine.attempt_responses r WHERE r.attempt_id=a.attempt_id) < jsonb_array_length(form->'items')`, [now]);
      for (const { attempt_id: id } of ids.rows) await this.command(id, { type: 'timeout', now });
      return ids.rows.length;
    },
    async admit({ actor, key, form, now, deadlineAt, correlationId }) {
      const client = await pool.connect();
      let attemptId, replay = false;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor}:${key}`]);
        const found = await client.query('SELECT attempt_id FROM examination_engine.attempts WHERE agent_learner_key=$1 AND idempotency_key=$2', [actor,key]);
        if (found.rows.length) { attemptId = found.rows[0].attempt_id; replay = true; }
        else {
          attemptId = randomUUID();
          await client.query(`INSERT INTO examination_engine.attempts
            (attempt_id,agent_learner_key,idempotency_key,configuration_fingerprint,package_id,package_version,package_digest,
             form_digest,form,mode,started_at,deadline_at,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'standard',$10,$11,$12)`,
          [attemptId,actor,key,form.subject.configurationFingerprint,form.package.id,form.package.version,form.package.digest,
            sha256(form),JSON.stringify(form),now,deadlineAt,correlationId]);
          await client.query(`INSERT INTO examination_engine.attempt_events (attempt_id,seq,event_type,occurred_at,correlation_id)
            VALUES ($1,1,'attempt_started',$2,$3)`, [attemptId,now,correlationId]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return { attempt: await this.get(attemptId), replay };
    },
    // Issue #20: mirrors admit() with mode='fallback' and the fallback columns.
    async admitFallback(input) {
      checkFallbackAdmission(input);
      const { actor, key, form, now, deadlineAt, correlationId, reason, bankId, bankVersion, bankDigest } = input;
      const causeAttemptId = input.causeAttemptId ?? null;
      const client = await pool.connect();
      let attemptId, replay = false;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor}:${key}`]);
        const found = await client.query('SELECT attempt_id FROM examination_engine.attempts WHERE agent_learner_key=$1 AND idempotency_key=$2', [actor,key]);
        if (found.rows.length) { attemptId = found.rows[0].attempt_id; replay = true; }
        else {
          attemptId = randomUUID();
          await client.query(`INSERT INTO examination_engine.attempts
            (attempt_id,agent_learner_key,idempotency_key,configuration_fingerprint,package_id,package_version,package_digest,
             form_digest,form,mode,started_at,deadline_at,correlation_id,
             fallback_cause_attempt_id,fallback_reason,fallback_bank_id,fallback_bank_version,fallback_bank_digest)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'fallback',$10,$11,$12,$13,$14,$15,$16,$17)`,
          [attemptId,actor,key,form.subject.configurationFingerprint,form.package.id,form.package.version,form.package.digest,
            sha256(form),JSON.stringify(form),now,deadlineAt,correlationId,
            causeAttemptId,reason,bankId,bankVersion,bankDigest]);
          await client.query(`INSERT INTO examination_engine.attempt_events (attempt_id,seq,event_type,occurred_at,correlation_id)
            VALUES ($1,1,'attempt_started',$2,$3)`, [attemptId,now,correlationId]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        // Different keys do not share the advisory lock, so the unique index is
        // what serializes two fallbacks for one cause.
        if (error.code === '23505' && error.constraint === 'attempt_fallback_one_per_cause') throw fail('fallback_already_admitted');
        if (error.code === '23503') throw fail('fallback_cause_not_found');
        throw error;
      }
      finally { client.release(); }
      return { attempt: await this.get(attemptId), replay };
    },
  };
}

function createMemoryStore() {
  const records = new Map();
  let serial = Promise.resolve();
  function transaction(action) {
    const run = serial.then(action);
    serial = run.catch(() => {});
    return run;
  }
  return {
    async health() {},
    get(id, reconcile) { return transaction(() => {
      const original = records.get(id);
      if (!original) return null;
      const record = structuredClone(original);
      if (reconcile) execute(record, { type: 'timeout', ...reconcile, now: reconcile.clock ? reconcile.clock() : reconcile.now });
      records.set(id, record);
      return structuredClone(snapshot(record));
    }); },
    async findByKey(actor, key) {
      const found = [...records.values()].find((r) => r.attempt.agentLearnerKey === actor && r.attempt.idempotencyKey === key);
      return found ? this.get(found.attempt.attemptId) : null;
    },
    async command(id, command, options) {
      const result = await transaction(async () => {
        const original = records.get(id);
        if (!original) throw fail('attempt_not_found', 404);
        if (command.eventId && [...records.entries()].some(([other, r]) => other !== id && r.events.some((e) => e.eventId === command.eventId)))
          throw fail('event_identity_conflict');
        const record = structuredClone(original);
        const outcome = await guardedExecute(record, command, options);
        records.set(id, record);
        // Clone results but preserve the error class used after commit.
        return outcome.error ? outcome : structuredClone(outcome);
      });
      if (result.error) { result.error.attempt = result.attempt; throw result.error; }
      return result;
    },
    async sweepExpired(now) {
      let count = 0;
      for (const [id, record] of records) if (isResponseExpired(snapshot(record), now)) {
        await this.command(id, { type: 'timeout', now }); count++;
      }
      return count;
    },
    admit(input) { return transaction(() => {
      const existing = [...records.values()].find((r) => r.attempt.agentLearnerKey === input.actor && r.attempt.idempotencyKey === input.key);
      if (existing) return { attempt: structuredClone(snapshot(existing)), replay: true };
      const attempt = { attemptId: randomUUID(), agentLearnerKey: input.actor, idempotencyKey: input.key,
        configurationFingerprint: input.form.subject.configurationFingerprint, package: structuredClone(input.form.package),
        formDigest: sha256(input.form), form: structuredClone(input.form), mode: 'standard', startedAt: input.now,
        deadlineAt: input.deadlineAt, correlationId: input.correlationId, ...NO_FALLBACK };
      const record = { attempt, events: [{ attemptId: attempt.attemptId, seq: 1, eventType: 'attempt_started',
        eventId: null, payload: {}, occurredAt: input.now, correlationId: input.correlationId }], responses: [], commands: [] };
      records.set(attempt.attemptId, record);
      return { attempt: structuredClone(snapshot(record)), replay: false };
    }); },
    admitFallback(input) { return transaction(() => {
      checkFallbackAdmission(input);
      const existing = [...records.values()].find((r) => r.attempt.agentLearnerKey === input.actor && r.attempt.idempotencyKey === input.key);
      if (existing) return { attempt: structuredClone(snapshot(existing)), replay: true };
      const causeAttemptId = input.causeAttemptId ?? null;
      // No database here: enforce the same foreign key and partial unique index
      // as PostgreSQL, with the same errors.
      if (causeAttemptId !== null) {
        if (!records.has(causeAttemptId)) throw fail('fallback_cause_not_found');
        if ([...records.values()].some((r) => r.attempt.fallbackCauseAttemptId === causeAttemptId))
          throw fail('fallback_already_admitted');
      }
      const attempt = { attemptId: randomUUID(), agentLearnerKey: input.actor, idempotencyKey: input.key,
        configurationFingerprint: input.form.subject.configurationFingerprint, package: structuredClone(input.form.package),
        formDigest: sha256(input.form), form: structuredClone(input.form), mode: 'fallback', startedAt: input.now,
        deadlineAt: input.deadlineAt, correlationId: input.correlationId,
        fallbackCauseAttemptId: causeAttemptId, fallbackReason: input.reason, fallbackBankId: input.bankId,
        fallbackBankVersion: input.bankVersion, fallbackBankDigest: input.bankDigest };
      const record = { attempt, events: [{ attemptId: attempt.attemptId, seq: 1, eventType: 'attempt_started',
        eventId: null, payload: {}, occurredAt: input.now, correlationId: input.correlationId }], responses: [], commands: [] };
      records.set(attempt.attemptId, record);
      return { attempt: structuredClone(snapshot(record)), replay: false };
    }); },
  };
}
module.exports = { createPgStore, createMemoryStore };
