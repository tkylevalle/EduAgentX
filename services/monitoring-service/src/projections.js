'use strict';
/**
 * Read-only correlated projections.
 * Monitoring NEVER writes authoritative service data.
 * Each domain projection is independent.
 */
const { ASSURANCE_POSTURE, OPERATIONAL_HEALTH, KPI_EVIDENCE, ATTENTION_SEVERITY, STALE_THRESHOLD_MS } = require('./signals');

// In-memory projection store
const projections = {
  services: new Map(),      // serviceId → { health, lastSeen, metrics }
  agents: new Map(),        // agentId → { assurancePosture, certificationId, lastEvent }
  kpis: new Map(),          // kpiId → { evidence, value, target, measuredAt }
  attention: [],            // deduplicated attention records
  events: [],               // recent domain events
};

// ── Service health projection ──────────────────────────────────────
function updateServiceHealth(serviceId, status, metrics = {}) {
  const now = Date.now();
  projections.services.set(serviceId, {
    serviceId,
    health: status === 'ok' ? OPERATIONAL_HEALTH.HEALTHY : OPERATIONAL_HEALTH.UNHEALTHY,
    lastSeen: now,
    metrics,
  });
}

function getServiceHealth(serviceId) {
  const record = projections.services.get(serviceId);
  if (!record) return { serviceId, health: OPERATIONAL_HEALTH.UNKNOWN, reason: 'never_seen' };
  const stale = Date.now() - record.lastSeen > STALE_THRESHOLD_MS;
  return { ...record, health: stale ? OPERATIONAL_HEALTH.UNKNOWN : record.health, stale };
}

// ── Agent assurance projection ─────────────────────────────────────
function updateAgentAssurance(agentId, event) {
  const stateMap = {
    'credential.issued': ASSURANCE_POSTURE.VERIFIED,
    'credential.suspended': ASSURANCE_POSTURE.SUSPENDED,
    'credential.revoked': ASSURANCE_POSTURE.REVOKED,
    'credential.reinstated': ASSURANCE_POSTURE.VERIFIED,
    'exam.failed': ASSURANCE_POSTURE.UNVERIFIED,
    'training.started': ASSURANCE_POSTURE.UNVERIFIED,
  };
  const posture = stateMap[event.type] || ASSURANCE_POSTURE.INDETERMINATE;
  projections.agents.set(agentId, {
    agentId,
    assurancePosture: posture,
    certificationId: event.certificationId || null,
    lastEvent: event,
    updatedAt: new Date().toISOString(),
  });
}

function getAgentAssurance(agentId) {
  return projections.agents.get(agentId) || {
    agentId, assurancePosture: ASSURANCE_POSTURE.INDETERMINATE, reason: 'no_events'
  };
}

// ── KPI evidence projection ────────────────────────────────────────
function updateKPI(kpiId, value, target, unit = '') {
  const met = typeof value === 'number' && typeof target === 'number' ? value >= target : false;
  projections.kpis.set(kpiId, {
    kpiId, value, target, unit,
    evidence: met ? KPI_EVIDENCE.MET : (value === null ? KPI_EVIDENCE.UNMEASURED : KPI_EVIDENCE.NOT_MET),
    measuredAt: new Date().toISOString(),
  });
}

function getAllKPIs() {
  const domains = ['registration', 'curriculum', 'training', 'examination', 'certification', 'grading', 'operations', 'provider', 'cost'];
  const result = {};
  for (const domain of domains) {
    result[domain] = projections.kpis.get(domain) || { kpiId: domain, evidence: KPI_EVIDENCE.UNMEASURED };
  }
  return result;
}

// ── Attention records ──────────────────────────────────────────────
function raiseAttention({ severity, scope, reason, safeState, owner, nextAction, evidenceLink }) {
  const record = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    severity,
    scope,
    time: new Date().toISOString(),
    freshness: 'FRESH',
    reason,
    safeState,
    owner,
    nextAction,
    evidenceLink: evidenceLink || null,
  };
  // Deduplicate by scope+reason
  const exists = projections.attention.find(a => a.scope === scope && a.reason === reason && a.severity === severity);
  if (!exists) projections.attention.push(record);
  return record;
}

function getAttention() {
  const now = Date.now();
  return projections.attention.map(a => ({
    ...a,
    freshness: (now - new Date(a.time).getTime()) > STALE_THRESHOLD_MS ? 'STALE' : 'FRESH',
  }));
}

// ── Domain event ingestion ─────────────────────────────────────────
function ingestEvent(event) {
  if (!event || !event.type) return;
  projections.events.push({ ...event, receivedAt: new Date().toISOString() });
  if (projections.events.length > 500) projections.events.shift(); // keep last 500

  // Update projections from events
  if (event.agentId) updateAgentAssurance(event.agentId, event);
  if (event.serviceId) updateServiceHealth(event.serviceId, event.status || 'ok', event.metrics);
  if (event.kpiId) updateKPI(event.kpiId, event.value, event.target, event.unit);

  // Auto-raise attention on critical events
  if (event.severity === ATTENTION_SEVERITY.CRITICAL) {
    raiseAttention({
      severity: ATTENTION_SEVERITY.CRITICAL,
      scope: event.serviceId || event.agentId || 'platform',
      reason: event.reason || event.type,
      safeState: event.safeState || 'investigate_immediately',
      owner: event.owner || 'team-lead',
      nextAction: event.nextAction || 'check logs and escalate',
      evidenceLink: event.evidenceLink || null,
    });
  }
}

// ── Full projection snapshot ───────────────────────────────────────
const RECENT_EVENT_LIMIT = 25;

function getSnapshot() {
  const serviceList = ['api-gateway', 'agent-registry', 'curriculum-engine', 'curriculum-index',
    'training-service', 'grading-service', 'certification-service', 'credential-verification',
    'validation-activation', 'monitoring-service'];

  return {
    snapshotAt: new Date().toISOString(),
    assurancePosture: Object.fromEntries(projections.agents),
    operationalHealth: Object.fromEntries(
      serviceList.map(s => [s, getServiceHealth(s)])
    ),
    kpiEvidence: getAllKPIs(),
    attention: getAttention(),
    eventCount: projections.events.length,
    // Most recent first, bounded, for the activity feed.
    recentEvents: projections.events.slice(-RECENT_EVENT_LIMIT).reverse(),
  };
}

module.exports = {
  updateServiceHealth, getServiceHealth,
  updateAgentAssurance, getAgentAssurance,
  updateKPI, getAllKPIs,
  raiseAttention, getAttention,
  ingestEvent, getSnapshot,
};
