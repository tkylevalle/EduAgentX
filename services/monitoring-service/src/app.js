'use strict';

// Monitoring service: read-only projections (projections.js), the one
// Assurance Incident log (target design 7.3; audit E9) and the Runtime
// Monitor's service side (target design 7.2).
//
// The incident and runtime routes are internal: a caller presents the
// monitoring key and names itself (x-actor-subject); the Gateway adds the
// role of the person or agent it authenticated (x-actor-role).

const express = require('express');
const { parseIncident } = require('../../../packages/incident-log');
const { evaluateTelemetry, parseManifest, parseTelemetry } = require('../../../packages/runtime-monitor');
const { ingestEvent, getSnapshot, getServiceHealth, getAgentAssurance, getAllKPIs, getAttention, updateServiceHealth } = require('./projections');

const UPDATE_STATUSES = Object.freeze(['acknowledged', 'resolved']);
const MAX_NOTE_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

/**
 * @param {{ store: object, internalKey?: string, credentialStatus?: { suspend: Function }, now?: () => Date }} deps
 *   credentialStatus.suspend(credentialId, reason, agentId): what a critical runtime violation triggers
 */
function createApp({ store, internalKey, credentialStatus, now = () => new Date() }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  const route = (method, path, handler) => app[method](path, (req, res) => Promise.resolve(handler(req, res)).catch(() => {
    if (!res.headersSent) res.status(503).json({ error: 'incident_log_unavailable' });
  }));
  const internal = (req, res) => {
    if (!internalKey || req.header('x-internal-service-key') !== internalKey) { res.status(403).json({ error: 'forbidden' }); return false; }
    if (!IDENTIFIER.test(req.header('x-actor-subject') || '')) { res.status(400).json({ error: 'actor_required' }); return false; }
    return true;
  };

  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: 'monitoring-service' }); }
    catch { res.status(503).json({ status: 'unavailable', service: 'monitoring-service' }); }
  });
  app.get('/snapshot', (_req, res) => res.json(getSnapshot()));
  app.get('/health/services', (_req, res) => res.json(getSnapshot().operationalHealth));
  app.get('/health/services/:serviceId', (req, res) => res.json(getServiceHealth(req.params.serviceId)));
  app.get('/assurance/:agentId', (req, res) => res.json(getAgentAssurance(req.params.agentId)));
  app.get('/kpis', (_req, res) => res.json(getAllKPIs()));
  app.get('/attention', (_req, res) => res.json(getAttention()));
  // POST /events — ingest a domain event (read-only projection, never writes authoritative data)
  app.post('/events', (req, res) => {
    const event = req.body;
    if (!event || !event.type) return res.status(400).json({ error: 'missing_event_type' });
    ingestEvent(event);
    res.status(202).json({ accepted: true, type: event.type });
  });
  app.post('/heartbeat', (req, res) => {
    const { serviceId, status, metrics } = req.body || {};
    if (!serviceId) return res.status(400).json({ error: 'missing_serviceId' });
    updateServiceHealth(serviceId, status || 'ok', metrics || {});
    res.json({ recorded: true, serviceId });
  });

  // ── Assurance Incident log ─────────────────────────────────────────
  // A service appends; the same source and sourceId append once (200 on a repeat).
  route('post', '/internal/incidents', async (req, res) => {
    if (!internal(req, res)) return;
    const parsed = parseIncident(req.body);
    if (parsed.errors) return res.status(400).json({ error: 'invalid_incident', details: parsed.errors });
    if (parsed.incident.source !== req.header('x-actor-subject')) return res.status(403).json({ error: 'source_must_be_the_caller' });
    const { incident, created } = await store.append(parsed.incident);
    res.status(created ? 201 : 200).json({ incidentId: incident.incidentId, created });
  });
  // The Attention Queue: open incidents by default, newest first.
  route('get', '/internal/incidents', async (req, res) => {
    if (!internal(req, res)) return;
    const status = req.query.status || 'open';
    if (!['open', 'all', ...UPDATE_STATUSES].includes(status)) return res.status(400).json({ error: 'invalid_status' });
    res.json({ incidents: await store.list({ status: status === 'all' ? undefined : status }) });
  });
  // A person acknowledges or resolves an incident; the update is appended, the incident is never edited.
  route('post', '/internal/incidents/:incidentId/updates', async (req, res) => {
    if (!internal(req, res)) return;
    if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const { status, note } = req.body || {};
    if (!UUID.test(req.params.incidentId) || !UPDATE_STATUSES.includes(status) || typeof note !== 'string' || !note.trim() || note.length > MAX_NOTE_CHARS)
      return res.status(400).json({ error: 'invalid_update' });
    const incident = await store.get(req.params.incidentId);
    if (!incident) return res.status(404).json({ error: 'incident_not_found' });
    if (incident.status === 'resolved') return res.status(409).json({ error: 'already_resolved' });
    await store.addUpdate(incident.incidentId, { status, note: note.trim(), actor: req.header('x-actor-subject') });
    res.json({ incident: await store.get(incident.incidentId) });
  });

  // ── Runtime Monitor ────────────────────────────────────────────────
  // An operator registers what one certified deployment may do.
  route('post', '/internal/runtime/manifests', async (req, res) => {
    if (!internal(req, res)) return;
    if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const { credentialId, agentId, manifest } = req.body || {};
    const parsed = parseManifest(manifest);
    if (!IDENTIFIER.test(String(credentialId ?? '')) || !IDENTIFIER.test(String(agentId ?? '')) || parsed.errors)
      return res.status(400).json({ error: 'invalid_manifest', details: parsed.errors || ['credentialId or agentId'] });
    await store.addManifest({ credentialId, agentId, manifest: parsed.manifest, registeredBy: req.header('x-actor-subject') });
    res.status(201).json({ credentialId, agentId, manifest: parsed.manifest });
  });
  // The deployment reports each tool call. The service re-checks tool and
  // address rules itself; a critical finding records an incident and
  // suspends the credential.
  route('post', '/internal/runtime/tool-calls', async (req, res) => {
    if (!internal(req, res)) return;
    const parsed = parseTelemetry(req.body);
    if (parsed.errors) return res.status(400).json({ error: 'invalid_telemetry', details: parsed.errors });
    const { telemetry } = parsed;
    const registered = await store.manifestFor(telemetry.credentialId);
    if (!registered) return res.status(404).json({ error: 'manifest_not_registered' });
    if (registered.agentId !== req.header('x-actor-subject')) return res.status(403).json({ error: 'not_this_agents_credential' });
    const findings = evaluateTelemetry(registered.manifest, telemetry);
    if (!findings.length) return res.json({ verdict: 'allowed', findings });
    const { incident } = await store.append({ source: 'runtime-monitor', sourceId: `${telemetry.credentialId}:${telemetry.callId}`, severity: 'critical',
      kind: 'runtime_violation', summary: `Production tool call ${telemetry.tool} broke ${findings.map((item) => item.ruleId).join(', ')}`,
      subject: { agentId: registered.agentId, credentialId: telemetry.credentialId },
      detail: { tool: telemetry.tool, addresses: telemetry.addresses, argsDigest: telemetry.argsDigest, findings }, occurredAt: new Date(telemetry.observedAt).toISOString() });
    const suspension = await suspend(telemetry.credentialId, registered.agentId, incident.incidentId);
    res.status(409).json({ verdict: 'violation', findings, incidentId: incident.incidentId, suspension });
  });

  // Suspends the credential; a failure is recorded as its own incident rather than lost.
  async function suspend(credentialId, agentId, incidentId) {
    if (!credentialStatus) return 'not_configured';
    try {
      await credentialStatus.suspend(credentialId, `Runtime Monitor critical violation (incident ${incidentId})`, agentId);
      return 'suspended';
    } catch (error) {
      await store.append({ source: 'runtime-monitor', sourceId: `${incidentId}:suspension`, severity: 'critical', kind: 'suspension_failed',
        summary: `The credential could not be suspended after incident ${incidentId}; suspend it by hand.`, subject: { agentId, credentialId },
        detail: { reason: String(error.code || error.message) }, occurredAt: now().toISOString() });
      return 'failed';
    }
  }

  return app;
}

/**
 * Suspension through Credential Verification's internal status route.
 * @returns {{ suspend: (credentialId: string, reason: string, agentId: string) => Promise<void> }}
 */
function createCredentialStatusClient({ url, key, fetchImpl = fetch }) {
  return {
    async suspend(credentialId, reason, agentId) {
      const response = await fetchImpl(`${url}/status/suspend`, { method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', 'x-internal-service-key': key }, body: JSON.stringify({ credentialId, reason, agentId }) });
      // 409: already suspended or revoked, which is the state the monitor wants.
      if (response.status !== 200 && response.status !== 409) throw Object.assign(new Error('suspension_refused'), { code: `status_${response.status}` });
    },
  };
}

module.exports = { createApp, createCredentialStatusClient };
