'use strict';

// The registry's event-delivery incidents, forwarded to the one Assurance
// Incident log (assurance audit E9). The registry keeps its own table as the
// source of record; the log gets one incident per row, so re-sending is safe.

const { clipSummary, startIncidentForwarding: start } = require('../../packages/incident-log');

// The newest incidents each run sends; older ones were sent by earlier runs.
const FORWARD_BATCH = 500;

/** @param {object} row  an agent_registry.delivery_incidents row @returns {object} the incident the log stores */
const toIncident = (row) => ({
  sourceId: `delivery:${row.id}`, severity: row.severity === 'critical' ? 'critical' : 'high', kind: String(row.cause),
  summary: clipSummary(`Registry event ${row.affected_id} not delivered: ${row.cause}. ${row.safe_state}; ${row.recovery_condition}.`),
  detail: { affectedId: row.affected_id, category: row.category },
  safeState: row.safe_state, requiredAction: String(row.recovery_condition).replaceAll('_', ' '),
  occurredAt: new Date(row.occurred_at).toISOString(),
});

const listRecent = (pool) => async () => (await pool.query(`SELECT id, category, severity, affected_id, cause, safe_state, recovery_condition, occurred_at
  FROM agent_registry.delivery_incidents ORDER BY id DESC LIMIT $1`, [FORWARD_BATCH])).rows.map(toIncident);

/** @returns {{ runOnce: Function, stop: Function } | null} the forwarder, or null when the log is not configured */
const startIncidentForwarding = (pool, { env, onError } = {}) => start({ source: 'agent-registry', env, onError, list: listRecent(pool) });

module.exports = { startIncidentForwarding, toIncident };
