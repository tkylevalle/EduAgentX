'use strict';

// Monitoring service: read-only projections (projections.js), the one
// Assurance Incident log (target design 7.3; audit E9) and the Runtime
// Monitor's service side (target design 7.2).
//
// Two keys. A service holding the service key may only append incidents as
// itself. Only the Gateway holds the gateway key, and only a call with it may
// carry the role of the person or agent the Gateway authenticated
// (x-actor-role): admins read and handle incidents and register manifests;
// an agent reports its own deployment's tool calls.

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const telemetry = require('../../../packages/telemetry');
const { IDENTIFIER, clipSummary, parseIncident } = require('../../../packages/incident-log');
const { evaluateTelemetry, parseManifest, parseTelemetry } = require('../../../packages/runtime-monitor');
const projections = require('./projections');
const { MAX_LIST, parseCursor } = require('./incidents');

const SERVICE = 'monitoring-service';
// The source every Runtime Monitor incident is appended under.
const RUNTIME_SOURCE = 'runtime-monitor';
const UPDATE_STATUSES = Object.freeze(['acknowledged', 'resolved']);
const MAX_NOTE_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A suspension or status read either answers within five seconds or counts as failed.
const CREDENTIAL_STATUS_TIMEOUT_MS = 5000;
// A monitored deployment that sends no tool call for an hour is reported as
// silent: the monitor can no longer say what it does.
const DEFAULT_SILENCE_MS = 60 * 60 * 1000;

const matches = (given, expected) => typeof given === 'string' && typeof expected === 'string' && given.length === expected.length &&
  timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/**
 * @param {{ store: object, internalKey: string, gatewayKey: string, credentialStatus?: object, now?: () => Date, silenceMs?: number }} deps
 *   credentialStatus: { suspend(credentialId, reason, agentId), statusOf(credentialId) } in Credential Verification
 */
function createApp({ store, internalKey, gatewayKey, credentialStatus, now = () => new Date(), silenceMs = DEFAULT_SILENCE_MS }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  const context = { store, credentialStatus, now, silenceMs };
  const route = (method, path, caller, handler) => app[method](path, (req, res) => {
    const who = authenticate(req, caller);
    if (who.error) return res.status(who.status).json({ error: who.error });
    return Promise.resolve(handler(req, res, who)).catch((error) => {
      telemetry.log(SERVICE, 'request_failed', { method, path, outcome: String(error.code || error.name) });
      if (!res.headersSent) res.status(503).json({ error: 'incident_log_unavailable' });
    });
  });
  // caller: 'service' (either key; no role) or 'gateway' (gateway key; the role it sends).
  function authenticate(req, caller) {
    const given = req.header('x-internal-service-key');
    const viaGateway = matches(given, gatewayKey);
    if (!viaGateway && (caller === 'gateway' || !matches(given, internalKey))) return { status: 403, error: 'forbidden' };
    const subject = req.header('x-actor-subject') || '';
    if (!IDENTIFIER.test(subject)) return { status: 400, error: 'actor_required' };
    return { subject, role: viaGateway ? req.header('x-actor-role') || null : null };
  }

  registerProjectionRoutes(app, store);
  registerIncidentRoutes(route, context);
  registerRuntimeRoutes(route, context);
  app.locals.sweepSilence = () => sweepSilence(context);
  return app;
}

function registerProjectionRoutes(app, store) {
  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: SERVICE }); }
    catch (error) {
      telemetry.log(SERVICE, 'health_failed', { outcome: String(error.code || error.name) });
      res.status(503).json({ status: 'unavailable', service: SERVICE });
    }
  });
  app.get('/snapshot', (_req, res) => res.json(projections.getSnapshot()));
  app.get('/health/services', (_req, res) => res.json(projections.getSnapshot().operationalHealth));
  app.get('/health/services/:serviceId', (req, res) => res.json(projections.getServiceHealth(req.params.serviceId)));
  app.get('/assurance/:agentId', (req, res) => res.json(projections.getAgentAssurance(req.params.agentId)));
  app.get('/kpis', (_req, res) => res.json(projections.getAllKPIs()));
  app.get('/attention', (_req, res) => res.json(projections.getAttention()));
  // POST /events — ingest a domain event (read-only projection, never writes authoritative data)
  app.post('/events', (req, res) => {
    const event = req.body;
    if (!event || !event.type) return res.status(400).json({ error: 'missing_event_type' });
    projections.ingestEvent(event);
    res.status(202).json({ accepted: true, type: event.type });
  });
  app.post('/heartbeat', (req, res) => {
    const { serviceId, status, metrics } = req.body || {};
    if (!serviceId) return res.status(400).json({ error: 'missing_serviceId' });
    projections.updateServiceHealth(serviceId, status || 'ok', metrics || {});
    res.json({ recorded: true, serviceId });
  });
}

function registerIncidentRoutes(route, { store }) {
  // A service appends as itself; the same source and sourceId append once (200 on a repeat).
  route('post', '/internal/incidents', 'service', async (req, res, who) => {
    const parsed = parseIncident(req.body);
    if (parsed.errors) return res.status(400).json({ error: 'invalid_incident', details: parsed.errors });
    if (parsed.incident.source !== who.subject) return res.status(403).json({ error: 'source_must_be_the_caller' });
    const { incident, created } = await store.append(parsed.incident);
    res.status(created ? 201 : 200).json({ incidentId: incident.incidentId, created });
  });
  // The Attention Queue: open incidents by default, newest first, one page at a time.
  //   status  open (default) | acknowledged | resolved | all
  //   limit   1 to 500 incidents a page (default 500)
  //   before  the `next` value of the previous page, "<recordedAt>,<incidentId>";
  //           the response's `next` is null on the last page.
  route('get', '/internal/incidents', 'gateway', async (req, res, who) => {
    if (who.role !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const status = req.query.status || 'open';
    if (!['open', 'all', ...UPDATE_STATUSES].includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const limit = req.query.limit === undefined ? MAX_LIST : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST) return res.status(400).json({ error: 'invalid_limit', max: MAX_LIST });
    const before = req.query.before === undefined ? undefined : parseCursor(req.query.before);
    if (before === null) return res.status(400).json({ error: 'invalid_cursor' });
    const { incidents, next } = await store.list({ status: status === 'all' ? undefined : status, limit, before });
    res.json({ incidents, next });
  });
  // A person acknowledges or resolves an incident; the update is appended, the incident is never edited.
  route('post', '/internal/incidents/:incidentId/updates', 'gateway', async (req, res, who) => {
    if (who.role !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const { status, note } = req.body || {};
    if (!UUID.test(req.params.incidentId) || !UPDATE_STATUSES.includes(status) || typeof note !== 'string' || !note.trim() || note.length > MAX_NOTE_CHARS)
      return res.status(400).json({ error: 'invalid_update' });
    // The store checks for a resolution and appends in one step, so a concurrent update cannot reopen a resolved incident.
    const outcome = await store.addUpdate(req.params.incidentId, { status, note: note.trim(), actor: who.subject });
    if (outcome === 'incident_not_found') return res.status(404).json({ error: outcome });
    if (outcome === 'already_resolved') return res.status(409).json({ error: outcome });
    res.json({ incident: await store.get(req.params.incidentId) });
  });
}

function registerRuntimeRoutes(route, context) {
  const { store, credentialStatus, now } = context;
  // An operator registers what one certified deployment may do; the credential must be active.
  route('post', '/internal/runtime/manifests', 'gateway', async (req, res, who) => {
    if (who.role !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const { credentialId, agentId, manifest } = req.body || {};
    const parsed = parseManifest(manifest);
    if (!IDENTIFIER.test(String(credentialId ?? '')) || !IDENTIFIER.test(String(agentId ?? '')) || parsed.errors)
      return res.status(400).json({ error: 'invalid_manifest', details: parsed.errors || ['credentialId or agentId'] });
    if (!credentialStatus) return res.status(503).json({ error: 'credential_status_unavailable' });
    const status = await credentialStatus.statusOf(credentialId);
    if (status !== 'active') return res.status(409).json({ error: 'credential_not_active', status });
    await store.addManifest({ credentialId, agentId, manifest: parsed.manifest, registeredBy: who.subject });
    res.status(201).json({ credentialId, agentId, manifest: parsed.manifest });
  });
  // The deployment reports each tool call. The service re-checks tool and
  // address rules itself; a critical finding records an incident and
  // suspends the credential.
  route('post', '/internal/runtime/tool-calls', 'gateway', async (req, res, who) => {
    if (who.role !== 'agent') return res.status(403).json({ error: 'agent_role_required' });
    const parsed = parseTelemetry(req.body);
    if (parsed.errors) return res.status(400).json({ error: 'invalid_telemetry', details: parsed.errors });
    const { telemetry: report } = parsed;
    const registered = await store.manifestFor(report.credentialId);
    if (!registered) return res.status(404).json({ error: 'manifest_not_registered' });
    if (registered.agentId !== who.subject) return res.status(403).json({ error: 'not_this_agents_credential' });
    await store.recordReport(report.credentialId, now().toISOString());
    const findings = evaluateTelemetry(registered.manifest, report);
    if (!findings.length) return res.json({ verdict: 'allowed', findings });
    const ruleIds = findings.map((item) => item.ruleId);
    const { incident } = await store.append(runtimeIncident('runtime_violation', { sourceId: `${report.credentialId}:${report.callId}`, severity: 'critical',
      summary: `Production tool call ${report.tool} broke ${ruleIds.join(', ')}`,
      subject: { agentId: registered.agentId, credentialId: report.credentialId }, safeState: 'credential suspended',
      requiredAction: 'Investigate the call; reinstate the credential only after the deployment is fixed and re-examined.',
      detail: { tool: report.tool, addresses: report.addresses, argsDigest: report.argsDigest, findings },
      compactDetail: { tool: report.tool, addressCount: report.addresses.length, argsDigest: report.argsDigest, ruleIds },
      occurredAt: new Date(report.observedAt).toISOString() }));
    const suspension = await suspend(context, report.credentialId, registered.agentId, incident.incidentId);
    res.status(409).json({ verdict: 'violation', findings, incidentId: incident.incidentId, suspension });
  });
}

// Suspends the credential and reads its status back: only a status of
// suspended or revoked counts. Anything else is recorded as its own critical
// incident, so a failed suspension is never reported as done.
async function suspend({ store, credentialStatus, now }, credentialId, agentId, incidentId) {
  let reason = 'credential_status_not_configured';
  if (credentialStatus) {
    try {
      await credentialStatus.suspend(credentialId, `Runtime Monitor critical violation (incident ${incidentId})`, agentId);
      const status = await credentialStatus.statusOf(credentialId);
      if (['suspended', 'revoked'].includes(status)) return 'suspended';
      reason = `status_after_suspension_${status}`;
    } catch (error) { reason = String(error.code || error.message); }
  }
  await store.append(runtimeIncident('suspension_failed', { sourceId: `${incidentId}:suspension`, severity: 'critical',
    summary: `The credential could not be suspended after incident ${incidentId}; suspend it by hand.`, subject: { agentId, credentialId },
    safeState: 'credential still active', requiredAction: 'Suspend the credential by hand in Credentials.', detail: { reason }, occurredAt: now().toISOString() }));
  return 'failed';
}

// Records one incident per silence of each monitored deployment whose
// credential is still active. The incident is keyed on the deployment's last
// report (or its registration), so later sweeps of the same silence add
// nothing, and a silence after the deployment reported again is a new incident.
async function sweepSilence(context) {
  const { store, now, silenceMs } = context;
  const current = now().getTime();
  const silent = (await store.monitored()).filter((entry) => current - Date.parse(entry.lastReportAt || entry.registeredAt) > silenceMs);
  let recorded = 0;
  for (const entry of silent) {
    if (!(await stillActive(context, entry.credentialId))) continue;
    const since = entry.lastReportAt || entry.registeredAt;
    await store.append(runtimeIncident('runtime_monitor_silent', { sourceId: `${entry.credentialId}:silent:${Date.parse(since)}`, severity: 'high',
      summary: `No tool call reported for credential ${entry.credentialId} since ${since}.`,
      subject: { agentId: entry.agentId, credentialId: entry.credentialId }, safeState: 'unmonitored',
      requiredAction: 'Check that the deployment still runs the Runtime Monitor SDK and reports its calls.',
      detail: { lastReportAt: entry.lastReportAt, registeredAt: entry.registeredAt }, occurredAt: new Date(current).toISOString() }));
    recorded += 1;
  }
  return recorded;
}

// A suspended or revoked credential is not expected to report, so its silence
// is no incident. A failed status read is logged and the silence still
// recorded: an unmonitored deployment must not hide behind an outage.
async function stillActive({ credentialStatus }, credentialId) {
  if (!credentialStatus) return true;
  try { return (await credentialStatus.statusOf(credentialId)) === 'active'; }
  catch (error) {
    telemetry.log(SERVICE, 'silence_status_unavailable', { outcome: String(error.code || error.name) });
    return true;
  }
}

// Every incident the Runtime Monitor raises passes the same shape check as an
// appending service's. A detail over the log's 8 KB limit (one call may name
// hundreds of addresses) is replaced by its compact form, so the incident is
// still recorded.
function runtimeIncident(kind, { compactDetail, ...fields }) {
  const incident = { ...fields, source: RUNTIME_SOURCE, kind, summary: clipSummary(fields.summary) };
  let parsed = parseIncident(incident);
  if (parsed.errors?.includes('detail') && compactDetail) parsed = parseIncident({ ...incident, detail: { ...compactDetail, truncated: true } });
  if (parsed.errors) throw Object.assign(new Error(`invalid_runtime_incident: ${parsed.errors.join(', ')}`), { code: 'invalid_runtime_incident' });
  return parsed.incident;
}

/**
 * Suspension and status reads through Credential Verification.
 * @returns {{ suspend: Function, statusOf: (credentialId: string) => Promise<string | null> }}
 */
function createCredentialStatusClient({ url, key, fetchImpl = fetch }) {
  return {
    async suspend(credentialId, reason, agentId) {
      const response = await fetchImpl(`${url}/status/suspend`, { method: 'POST', signal: AbortSignal.timeout(CREDENTIAL_STATUS_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-internal-service-key': key }, body: JSON.stringify({ credentialId, reason, agentId }) });
      // 409 is a refused transition (already suspended or revoked, or unknown); the status read decides which.
      if (response.status !== 200 && response.status !== 409) throw Object.assign(new Error('suspension_refused'), { code: `status_${response.status}` });
    },
    async statusOf(credentialId) {
      const response = await fetchImpl(`${url}/status/${encodeURIComponent(credentialId)}`, { signal: AbortSignal.timeout(CREDENTIAL_STATUS_TIMEOUT_MS) });
      if (response.status === 404) return null;
      if (response.status !== 200) throw Object.assign(new Error('status_unavailable'), { code: `status_${response.status}` });
      return (await response.json()).status ?? null;
    },
  };
}

module.exports = { DEFAULT_SILENCE_MS, createApp, createCredentialStatusClient };
