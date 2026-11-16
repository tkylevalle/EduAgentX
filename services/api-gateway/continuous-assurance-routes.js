'use strict';

// Continuous assurance routes (target design 7): the Assurance Incident log
// and its Attention Queue, the Runtime Monitor, and the Release Gate. Each
// is forwarded with the owning service's internal key, which never leaves the
// Gateway, and the token's own subject and role.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerContinuousAssuranceRoutes(app, {
  requireRole, proxyJson,
  monitoringServiceUrl, monitoringInternalKey,
  certificationServiceUrl, certificationInternalKey,
}) {
  const unavailable = (req, res, error) => res.status(503).json({ apiVersion: 'v1', error, correlationId: req.correlationId });
  const monitoring = (req) => ({ 'x-internal-service-key': monitoringInternalKey, 'x-actor-subject': req.auth.subject, 'x-actor-role': req.auth.role });
  const toMonitoring = (method, path) => async (req, res) => {
    if (!monitoringServiceUrl || !monitoringInternalKey) return unavailable(req, res, 'monitoring_unavailable');
    await proxyJson(req, res, `${monitoringServiceUrl}${path(req)}`, { method, ...(method === 'POST' ? { body: req.body } : {}), headers: monitoring(req) });
  };

  // The Attention Queue: open incidents across every service.
  app.get('/v1/admin/incidents', requireRole('admin'), toMonitoring('GET',
    (req) => `/internal/incidents?status=${encodeURIComponent(String(req.query.status || 'open'))}`));
  app.post('/v1/admin/incidents/:incidentId/updates', requireRole('admin'), async (req, res, next) => {
    if (!UUID.test(req.params.incidentId)) return res.status(400).json({ apiVersion: 'v1', error: 'invalid_incident_id', correlationId: req.correlationId });
    return toMonitoring('POST', () => `/internal/incidents/${req.params.incidentId}/updates`)(req, res, next);
  });

  // Runtime Monitor: an operator registers a deployment's manifest; the agent's own deployment reports its tool calls.
  app.post('/v1/admin/runtime/manifests', requireRole('admin'), toMonitoring('POST', () => '/internal/runtime/manifests'));
  app.post('/v1/runtime/tool-calls', requireRole('agent'), toMonitoring('POST', () => '/internal/runtime/tool-calls'));

  // Release Gate: a CI step asks whether a re-examined agent may ship.
  app.post('/v1/release-gate/checks', requireRole('admin'), async (req, res) => {
    if (!certificationServiceUrl || !certificationInternalKey) return unavailable(req, res, 'certification_unavailable');
    await proxyJson(req, res, `${certificationServiceUrl}/internal/release-gate/checks`, { method: 'POST', body: req.body,
      headers: { 'x-internal-service-key': certificationInternalKey, 'x-actor-subject': req.auth.subject, 'x-actor-role': 'gateway' } });
  });
}

module.exports = { registerContinuousAssuranceRoutes };
