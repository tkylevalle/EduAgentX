'use strict';

// Issue #21: the remediation outbox and its trace reads, for both stores.
// The event itself is written by store.js in the attempt's terminal
// transaction. A delivery outcome is final: the first one recorded wins, and
// the immutable table refuses any change.

const { fail } = require('./lifecycle');

const DELIVERY_OUTCOMES = ['delivered', 'refused'];
// A claimed event is leased for its backoff: 2 s, then doubling, at most 5 min.
// The lease keeps two relays from sending one event at once, and the backoff
// lets newer events go ahead of one that keeps failing.
const BACKOFF_BASE_SECONDS = 2;
const BACKOFF_MAX_SECONDS = 300;
const backoffSeconds = (attempts) => Math.min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * 2 ** attempts);
const TERMINAL_EVENTS = ['attempt_completed', 'agent_failed', 'system_aborted'];

function checkDelivery({ eventId, outcome, trainingSessionId, recordedAt }) {
  if (typeof eventId !== 'string' || !DELIVERY_OUTCOMES.includes(outcome) || !Number.isFinite(Date.parse(recordedAt)) ||
    (outcome === 'delivered' ? typeof trainingSessionId !== 'string' || !trainingSessionId : trainingSessionId !== null))
    throw fail('invalid_remediation_delivery', 400);
}

const rowToDelivery = (row) => (row ? { eventId: row.event_id, outcome: row.outcome,
  trainingSessionId: row.training_session_id, detail: row.detail, recordedAt: new Date(row.recorded_at).toISOString() } : null);

function pgRemediationMethods(pool) {
  const one = async (sql, values) => (await pool.query(sql, values)).rows[0];
  const deliveryOf = async (eventId) =>
    rowToDelivery(await one('SELECT * FROM examination_engine.remediation_deliveries WHERE event_id=$1', [eventId]));
  return {
    async listPendingRemediations(limit) {
      const result = await pool.query(`SELECT e.envelope FROM examination_engine.remediation_events e
        WHERE NOT EXISTS (SELECT 1 FROM examination_engine.remediation_deliveries d WHERE d.event_id = e.event_id)
        ORDER BY e.occurred_at, e.event_id LIMIT $1`, [limit]);
      return result.rows.map((row) => row.envelope);
    },
    // One statement: the row locks with SKIP LOCKED and the lease commit together.
    async claimPendingRemediations({ now, limit }) {
      const result = await pool.query(`WITH due AS (
          SELECT e.event_id, e.envelope, e.seq, coalesce(s.next_attempt_at, e.occurred_at) AS due_at
          FROM examination_engine.remediation_events e
          LEFT JOIN examination_engine.remediation_relay_state s ON s.event_id = e.event_id
          WHERE NOT EXISTS (SELECT 1 FROM examination_engine.remediation_deliveries d WHERE d.event_id = e.event_id)
            AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= $1)
          ORDER BY due_at, e.seq LIMIT $2 FOR UPDATE OF e SKIP LOCKED),
        leased AS (
          INSERT INTO examination_engine.remediation_relay_state (event_id, attempts, next_attempt_at)
          SELECT event_id, 1, $1::timestamptz + make_interval(secs => $3) FROM due
          ON CONFLICT (event_id) DO UPDATE SET attempts = remediation_relay_state.attempts + 1,
            next_attempt_at = $1::timestamptz + make_interval(secs => least($4, $3 * power(2, remediation_relay_state.attempts)))
          RETURNING event_id)
        SELECT due.envelope FROM due JOIN leased ON leased.event_id = due.event_id ORDER BY due.due_at, due.seq`,
      [now, limit, BACKOFF_BASE_SECONDS, BACKOFF_MAX_SECONDS]);
      return result.rows.map((row) => row.envelope);
    },
    async recordRemediationDelivery(delivery) {
      checkDelivery(delivery);
      const { eventId, outcome, trainingSessionId, detail, recordedAt } = delivery;
      if (!await one('SELECT 1 FROM examination_engine.remediation_events WHERE event_id=$1', [eventId]))
        throw fail('remediation_not_found', 404);
      await pool.query(`INSERT INTO examination_engine.remediation_deliveries
        (event_id,outcome,training_session_id,detail,recorded_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, outcome, trainingSessionId, JSON.stringify(detail ?? {}), recordedAt]);
      return deliveryOf(eventId);
    },
    async findRemediation(attemptId) {
      const row = await one('SELECT envelope FROM examination_engine.remediation_events WHERE attempt_id=$1', [attemptId]);
      if (!row) return { event: null, delivery: null };
      return { event: row.envelope, delivery: await deliveryOf(row.envelope.eventId) };
    },
    async latestRemediationEvent({ agentLearnerKey, packageId, packageVersion }) {
      const row = await one(`SELECT envelope FROM examination_engine.remediation_events WHERE agent_learner_key=$1
        AND package_id=$2 AND package_version=$3 ORDER BY occurred_at DESC, seq DESC LIMIT 1`,
      [agentLearnerKey, packageId, packageVersion]);
      return row?.envelope ?? null;
    },
    async hasAttemptAwaitingOutcome({ agentLearnerKey, packageId, packageVersion, now }) {
      return Boolean(await one(`SELECT 1 FROM examination_engine.attempts a WHERE a.agent_learner_key=$1
        AND a.package_id=$2 AND a.package_version=$3 AND a.mode='standard'
        AND NOT EXISTS (SELECT 1 FROM examination_engine.attempt_events e WHERE e.attempt_id=a.attempt_id
          AND e.event_type IN ('attempt_completed','agent_failed','system_aborted'))
        AND (a.deadline_at <= $4 OR (SELECT count(*) FROM examination_engine.attempt_responses r
          WHERE r.attempt_id=a.attempt_id) = jsonb_array_length(a.form->'items')) LIMIT 1`,
      [agentLearnerKey, packageId, packageVersion, now]));
    },
    async findReexaminations(eventId) {
      const result = await pool.query(`SELECT attempt_id FROM examination_engine.attempts
        WHERE form->'training'->>'remediationRequestId' = $1 ORDER BY started_at, attempt_id`, [eventId]);
      return result.rows.map((row) => row.attempt_id);
    },
  };
}

// `records` maps attempt id to { attempt, ..., remediation, remediationSeq, delivery }.
function memoryRemediationMethods(records, transaction) {
  const relayState = new Map();
  const withSeq = () => [...records.values()].filter((r) => r.remediation);
  const events = () => withSeq().sort((a, b) => Date.parse(a.remediation.occurredAt) - Date.parse(b.remediation.occurredAt) ||
    a.remediationSeq - b.remediationSeq).map((r) => r.remediation);
  const recordOf = (eventId) => [...records.values()].find((r) => r.remediation?.eventId === eventId);
  const pending = () => events().filter((event) => !recordOf(event.eventId).delivery);
  return {
    async listPendingRemediations(limit) {
      return structuredClone(pending().slice(0, limit));
    },
    claimPendingRemediations({ now, limit }) {
      return transaction(() => {
        const dueAt = (event) => relayState.get(event.eventId)?.nextAttemptAt ?? Date.parse(event.occurredAt);
        const due = pending().filter((event) => dueAt(event) <= Date.parse(now))
          .sort((a, b) => dueAt(a) - dueAt(b) || recordOf(a.eventId).remediationSeq - recordOf(b.eventId).remediationSeq)
          .slice(0, limit);
        for (const event of due) {
          const attempts = relayState.get(event.eventId)?.attempts ?? 0;
          relayState.set(event.eventId, { attempts: attempts + 1,
            nextAttemptAt: Date.parse(now) + backoffSeconds(attempts) * 1000 });
        }
        return structuredClone(due);
      });
    },
    recordRemediationDelivery(delivery) {
      return transaction(() => {
        checkDelivery(delivery);
        const record = recordOf(delivery.eventId);
        if (!record) throw fail('remediation_not_found', 404);
        if (!record.delivery) records.set(record.attempt.attemptId, { ...record, delivery: {
          eventId: delivery.eventId, outcome: delivery.outcome, trainingSessionId: delivery.trainingSessionId,
          detail: structuredClone(delivery.detail ?? {}), recordedAt: new Date(delivery.recordedAt).toISOString() } });
        return structuredClone(records.get(record.attempt.attemptId).delivery);
      });
    },
    async findRemediation(attemptId) {
      const record = records.get(attemptId);
      if (!record?.remediation) return { event: null, delivery: null };
      return structuredClone({ event: record.remediation, delivery: record.delivery ?? null });
    },
    async latestRemediationEvent({ agentLearnerKey, packageId, packageVersion }) {
      const matching = events().filter((event) => event.agentLearnerKey === agentLearnerKey &&
        event.package.id === packageId && event.package.version === packageVersion);
      return structuredClone(matching.at(-1) ?? null);
    },
    async hasAttemptAwaitingOutcome({ agentLearnerKey, packageId, packageVersion, now }) {
      return [...records.values()].some((r) => r.attempt.agentLearnerKey === agentLearnerKey &&
        r.attempt.package.id === packageId && r.attempt.package.version === packageVersion && r.attempt.mode === 'standard' &&
        !r.events.some((e) => TERMINAL_EVENTS.includes(e.eventType)) &&
        (Date.parse(r.attempt.deadlineAt) <= Date.parse(now) || r.responses.length === r.attempt.form.items.length));
    },
    async findReexaminations(eventId) {
      return [...records.values()].filter((r) => r.attempt.form.training?.remediationRequestId === eventId)
        .sort((a, b) => Date.parse(a.attempt.startedAt) - Date.parse(b.attempt.startedAt)).map((r) => r.attempt.attemptId);
    },
  };
}

module.exports = { pgRemediationMethods, memoryRemediationMethods };
