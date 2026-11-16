'use strict';

// One Assurance Incident log for every service (target design 7.3; assurance
// audit E9). Services append to it; nothing edits or deletes an incident.
// This module holds the incident shape shared by the log and its writers,
// and the client a service uses to append.

const SEVERITIES = Object.freeze(['critical', 'high', 'medium']);
// An incident's free text stays short enough to read in the Attention Queue.
const MAX_SUMMARY_CHARS = 500;
// Detail is structured context, not a dump: 8 KB fits any recorded cause.
const MAX_DETAIL_BYTES = 8192;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const SUBJECT_FIELDS = Object.freeze(['agentId', 'credentialId', 'packageId', 'attemptId', 'sessionId']);
// How long a report waits for the log; an incident must not hold up the work that raised it.
const REPORT_TIMEOUT_MS = 5000;

/**
 * @param {unknown} input
 * @returns {{ incident: object } | { errors: string[] }} the incident as the log stores it, or what is wrong with it
 *   input: { source, sourceId, severity, kind, summary, subject?, detail?, occurredAt }
 */
function parseIncident(input) {
  const errors = [];
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const field of ['source', 'sourceId', 'kind']) if (!IDENTIFIER.test(String(value[field] ?? ''))) errors.push(field);
  if (!SEVERITIES.includes(value.severity)) errors.push('severity');
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > MAX_SUMMARY_CHARS) errors.push('summary');
  if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(value.occurredAt ?? '')) || !Number.isFinite(Date.parse(value.occurredAt))) errors.push('occurredAt');
  const subject = value.subject ?? {};
  if (typeof subject !== 'object' || Array.isArray(subject) || Object.keys(subject).some((key) => !SUBJECT_FIELDS.includes(key)) ||
    Object.values(subject).some((id) => !IDENTIFIER.test(String(id)))) errors.push('subject');
  const detail = value.detail ?? {};
  if (typeof detail !== 'object' || Array.isArray(detail) || Buffer.byteLength(JSON.stringify(detail)) > MAX_DETAIL_BYTES) errors.push('detail');
  const unexpected = Object.keys(value).filter((key) => !['source', 'sourceId', 'severity', 'kind', 'summary', 'subject', 'detail', 'occurredAt'].includes(key));
  errors.push(...unexpected.map((key) => `unexpected:${key}`));
  if (errors.length) return { errors };
  return { incident: { source: value.source, sourceId: value.sourceId, severity: value.severity, kind: value.kind, summary: value.summary.trim(),
    subject: { ...subject }, detail: structuredClone(detail), occurredAt: new Date(value.occurredAt).toISOString() } };
}

/**
 * The client a service appends with. Appending twice with the same source and
 * sourceId records one incident, so a writer may simply retry.
 * @param {{ url?: string, key?: string, source: string, fetchImpl?: Function }} options  url: the monitoring service
 * @returns {{ enabled: boolean, report: (incident: object) => Promise<{ incidentId: string, created: boolean }> }}
 */
function createIncidentReporter({ url, key, source, fetchImpl = fetch }) {
  const enabled = Boolean(url && key);
  async function report(incident) {
    if (!enabled) throw new Error('incident_log_not_configured');
    const parsed = parseIncident({ ...incident, source });
    if (parsed.errors) throw new Error(`invalid_incident: ${parsed.errors.join(', ')}`);
    const response = await fetchImpl(`${url}/internal/incidents`, { method: 'POST', signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-internal-service-key': key, 'x-actor-subject': source },
      body: JSON.stringify(parsed.incident) });
    if (![200, 201].includes(response.status)) throw new Error(`incident_log_refused_${response.status}`);
    return response.json();
  }
  return { enabled, report };
}

/**
 * Forwards a service's own incident records to the log on a timer. Each run
 * sends every record list() returns; the log keeps one per sourceId, so
 * re-sending is harmless and a failed run is simply repeated.
 * @param {{ list: () => Promise<object[]>, reporter: object, intervalMs: number, onError: (error: Error) => void }} options
 * @returns {{ runOnce: () => Promise<number>, stop: () => void }} runOnce resolves to how many were sent
 */
function forwardIncidents({ list, reporter, intervalMs, onError }) {
  async function runOnce() {
    const incidents = await list();
    for (const incident of incidents) await reporter.report(incident);
    return incidents.length;
  }
  const timer = intervalMs > 0 ? setInterval(() => runOnce().catch(onError), intervalMs) : null;
  timer?.unref();
  return { runOnce, stop: () => timer && clearInterval(timer) };
}

module.exports = { MAX_DETAIL_BYTES, MAX_SUMMARY_CHARS, SEVERITIES, SUBJECT_FIELDS, createIncidentReporter, forwardIncidents, parseIncident };
