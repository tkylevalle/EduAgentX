'use strict';

// Training's completion-delivery incidents, forwarded to the one Assurance
// Incident log (assurance audit E9). Training keeps its own table as the
// source of record; the log gets one incident per event, so re-sending is safe.

const { clipSummary, startIncidentForwarding: start } = require('../../packages/incident-log');

// The newest incidents each run sends; older ones were sent by earlier runs.
const FORWARD_BATCH = 500;
const SEVERITY = Object.freeze({ critical: 'critical', high: 'high', major: 'high' });

/** @param {object} row  from store.listCompletionIncidents @returns {object} the incident the log stores */
const toIncident = (row) => ({
  sourceId: `completion:${row.eventId}`, severity: SEVERITY[row.severity] || 'medium', kind: 'completion_delivery_failed',
  summary: clipSummary(`Training completion ${row.eventId} was not delivered: ${row.causeCode} (${row.safeState}).`),
  detail: { category: row.category, causeCode: row.causeCode, retryCount: row.retryCount },
  safeState: row.safeState, requiredAction: 'Find why the completion was not delivered, then redeliver it from the Training outbox.',
  occurredAt: new Date(row.occurredAt).toISOString(),
});

/** @returns {{ runOnce: Function, stop: Function } | null} the forwarder, or null when the log is not configured */
const startIncidentForwarding = (store, { env, onError } = {}) => start({ source: 'training-service', env, onError,
  list: async () => (await store.listCompletionIncidents({ limit: FORWARD_BATCH })).map(toIncident) });

module.exports = { startIncidentForwarding, toIncident };
