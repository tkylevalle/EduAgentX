'use strict';

// Training's completion-delivery incidents, forwarded to the one Assurance
// Incident log (assurance audit E9). Training keeps its own table as the
// source of record; the log gets one incident per event, so re-sending is safe.

const { createIncidentReporter, forwardIncidents } = require('../../packages/incident-log');

// The newest incidents each run sends; older ones were sent by earlier runs.
const FORWARD_BATCH = 500;
// Once a minute: incidents reach the Attention Queue well inside an operator's response time.
const DEFAULT_INTERVAL_MS = 60000;
const SEVERITY = Object.freeze({ critical: 'critical', high: 'high', major: 'high' });

/** @param {object} row  from store.listCompletionIncidents @returns {object} the incident the log stores */
const toIncident = (row) => ({
  sourceId: `completion:${row.eventId}`, severity: SEVERITY[row.severity] || 'medium', kind: 'completion_delivery_failed',
  summary: `Training completion ${row.eventId} was not delivered: ${row.causeCode} (${row.safeState}).`,
  detail: { category: row.category, causeCode: row.causeCode, safeState: row.safeState, retryCount: row.retryCount },
  occurredAt: new Date(row.occurredAt).toISOString(),
});

/** @returns {{ runOnce: Function, stop: Function } | null} the forwarder, or null when the log is not configured */
function startIncidentForwarding(store, { env = process.env, onError } = {}) {
  const reporter = createIncidentReporter({ url: env.MONITORING_SERVICE_URL, key: env.MONITORING_INTERNAL_KEY, source: 'training-service' });
  if (!reporter.enabled) return null;
  return forwardIncidents({ reporter, onError, intervalMs: Number(env.INCIDENT_FORWARD_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
    list: async () => (await store.listCompletionIncidents()).slice(0, FORWARD_BATCH).map(toIncident) });
}

module.exports = { startIncidentForwarding, toIncident };
