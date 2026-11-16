'use strict';

// The registry's event-delivery incidents, forwarded to the one Assurance
// Incident log (assurance audit E9). The registry keeps its own table as the
// source of record; the log gets one incident per row, so re-sending is safe.

const { createIncidentReporter, forwardIncidents } = require('../../packages/incident-log');

// The newest incidents each run sends; older ones were sent by earlier runs.
const FORWARD_BATCH = 500;
// Once a minute: incidents reach the Attention Queue well inside an operator's response time.
const DEFAULT_INTERVAL_MS = 60000;

/** @param {object} row  an agent_registry.delivery_incidents row @returns {object} the incident the log stores */
const toIncident = (row) => ({
  sourceId: `delivery:${row.id}`, severity: row.severity === 'critical' ? 'critical' : 'high', kind: String(row.cause),
  summary: `Registry event ${row.affected_id} not delivered: ${row.cause}. ${row.safe_state}; ${row.recovery_condition}.`.slice(0, 500),
  detail: { affectedId: row.affected_id, category: row.category, safeState: row.safe_state, recoveryCondition: row.recovery_condition },
  occurredAt: new Date(row.occurred_at).toISOString(),
});

const listRecent = (pool) => async () => (await pool.query(`SELECT id, category, severity, affected_id, cause, safe_state, recovery_condition, occurred_at
  FROM agent_registry.delivery_incidents ORDER BY id DESC LIMIT $1`, [FORWARD_BATCH])).rows.map(toIncident);

/** @returns {{ runOnce: Function, stop: Function } | null} the forwarder, or null when the log is not configured */
function startIncidentForwarding(pool, { env = process.env, onError } = {}) {
  const reporter = createIncidentReporter({ url: env.MONITORING_SERVICE_URL, key: env.MONITORING_INTERNAL_KEY, source: 'agent-registry' });
  if (!reporter.enabled) return null;
  return forwardIncidents({ reporter, onError, list: listRecent(pool), intervalMs: Number(env.INCIDENT_FORWARD_INTERVAL_MS) || DEFAULT_INTERVAL_MS });
}

module.exports = { startIncidentForwarding, toIncident };
