'use strict';

// Continuous assurance routes (target design 7): the Assurance Incident log
// and its Attention Queue, and the Runtime Monitor. Each is forwarded with
// monitoring's Gateway key, which never leaves the Gateway, and the token's
// own subject and role. The Release Gate is a certification route, so it
// lives with the others in assurance-routes.js.

const { UUID, unavailable } = require('./route-helpers');

// Monitoring's own page bounds for the incident log.
const INCIDENT_PAGE_MAX = 500;
// A cursor is '<recordedAt>,<incidentId>': an ISO timestamp (about 30
// characters) and a UUID (36); 100 leaves room without accepting junk.
const INCIDENT_CURSOR_MAX_CHARS = 100;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** @param {unknown} value @returns {boolean} whether value is a whole number of incidents monitoring will page by */
function validPageSize(value) {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return false;
  const size = Number(value);
  return size >= 1 && size <= INCIDENT_PAGE_MAX;
}

/** @param {unknown} value @returns {boolean} whether value is a '<recordedAt>,<incidentId>' cursor */
function validCursor(value) {
  if (typeof value !== 'string' || value.length > INCIDENT_CURSOR_MAX_CHARS) return false;
  const parts = value.split(',');
  return parts.length === 2 && ISO_TIMESTAMP.test(parts[0]) && UUID.test(parts[1]);
}

// The incident query monitoring receives: status as before, and the page
// size and cursor only when the caller sent them. Null when either is invalid.
function incidentQuery(query) {
  if (query.limit !== undefined && !validPageSize(query.limit)) return null;
  if (query.before !== undefined && !validCursor(query.before)) return null;
  return `status=${encodeURIComponent(String(query.status || 'open'))}` +
    (query.limit !== undefined ? `&limit=${encodeURIComponent(query.limit)}` : '') +
    (query.before !== undefined ? `&before=${encodeURIComponent(query.before)}` : '');
}

function registerContinuousAssuranceRoutes(app, { requireRole, proxyJson, monitoringServiceUrl, monitoringGatewayKey }) {
  const invalid = (req, res, error) => res.status(400).json({ apiVersion: 'v1', error, correlationId: req.correlationId });
  const monitoring = (req) => ({ 'x-internal-service-key': monitoringGatewayKey, 'x-actor-subject': req.auth.subject, 'x-actor-role': req.auth.role });
  const toMonitoring = (method, path) => async (req, res) => {
    if (!monitoringServiceUrl || !monitoringGatewayKey) return unavailable(req, res, 'monitoring_unavailable');
    await proxyJson(req, res, `${monitoringServiceUrl}${path(req)}`, { method, ...(method === 'POST' ? { body: req.body } : {}), headers: monitoring(req) });
  };

  // The Attention Queue: incidents across every service, a page at a time.
  app.get('/v1/admin/incidents', requireRole('admin'), async (req, res, next) => {
    const query = incidentQuery(req.query);
    if (!query) return invalid(req, res, 'invalid_request');
    return toMonitoring('GET', () => `/internal/incidents?${query}`)(req, res, next);
  });
  app.post('/v1/admin/incidents/:incidentId/updates', requireRole('admin'), async (req, res, next) => {
    if (!UUID.test(req.params.incidentId)) return invalid(req, res, 'invalid_incident_id');
    return toMonitoring('POST', () => `/internal/incidents/${req.params.incidentId}/updates`)(req, res, next);
  });

  // Runtime Monitor: an operator registers a deployment's manifest; the agent's own deployment reports its tool calls.
  app.post('/v1/admin/runtime/manifests', requireRole('admin'), toMonitoring('POST', () => '/internal/runtime/manifests'));
  app.post('/v1/runtime/tool-calls', requireRole('agent'), toMonitoring('POST', () => '/internal/runtime/tool-calls'));
}

module.exports = { registerContinuousAssuranceRoutes };
