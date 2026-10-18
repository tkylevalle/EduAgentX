'use strict';

// Certification, credential and monitoring routes. The Gateway only reads
// Certification Decisions; the Examination Engine alone commands them.
// Credential status changes are admin-only and are forwarded with the
// credential-verification internal key, which never leaves the Gateway.

const ASSURANCE_READERS = Object.freeze(['admin', 'viewer', 'evaluator', 'governance_operator', 'demo_operator']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_ACTIONS = Object.freeze(['suspend', 'reinstate', 'revoke']);
const MAX_REASON_CHARS = 500;
const MAX_JWS_CHARS = 60000;

function registerAssuranceRoutes(app, {
  requireRole, proxyJson,
  certificationServiceUrl, certificationInternalKey,
  credentialVerificationUrl, credentialInternalKey,
  monitoringServiceUrl,
}) {
  const unavailable = (req, res, error) => res.status(503).json({ apiVersion: 'v1', error, correlationId: req.correlationId });
  const invalid = (req, res, details) => res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details,
    correlationId: req.correlationId });
  const certificationHeaders = (req) => ({ 'x-internal-service-key': certificationInternalKey,
    'x-actor-subject': req.auth.subject, 'x-actor-role': 'gateway' });

  app.get('/v1/admin/certifications', requireRole(...ASSURANCE_READERS), async (req, res) => {
    if (!certificationServiceUrl || !certificationInternalKey) return unavailable(req, res, 'certification_unavailable');
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return invalid(req, res, ['limit']);
    await proxyJson(req, res, `${certificationServiceUrl}/internal/credentials?limit=${limit}`,
      { headers: certificationHeaders(req) });
  });

  app.get('/v1/admin/certifications/by-examination/:attemptId', requireRole(...ASSURANCE_READERS), async (req, res) => {
    if (!UUID.test(req.params.attemptId)) return invalid(req, res, ['attemptId']);
    if (!certificationServiceUrl || !certificationInternalKey) return unavailable(req, res, 'certification_unavailable');
    await proxyJson(req, res,
      `${certificationServiceUrl}/internal/decisions/by-examination/${encodeURIComponent(req.params.attemptId)}`,
      { headers: certificationHeaders(req) });
  });

  app.get('/v1/admin/certifications/kpi', requireRole(...ASSURANCE_READERS), async (req, res) => {
    if (!certificationServiceUrl || !certificationInternalKey) return unavailable(req, res, 'certification_unavailable');
    await proxyJson(req, res, `${certificationServiceUrl}/internal/kpi/issuance`, { headers: certificationHeaders(req) });
  });

  // Any authenticated role may verify a credential it holds; the report says
  // only what the signature, schema, time, status and policy checks found.
  app.post('/v1/credentials/verify', requireRole('agent', ...ASSURANCE_READERS), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((name) => name !== 'jws') ||
      typeof body.jws !== 'string' || !body.jws || body.jws.length > MAX_JWS_CHARS) return invalid(req, res, ['jws']);
    if (!credentialVerificationUrl) return unavailable(req, res, 'verification_unavailable');
    await proxyJson(req, res, `${credentialVerificationUrl}/verify`, { method: 'POST', body: { jws: body.jws } });
  });

  app.get('/v1/credentials/:credentialId/status', requireRole('agent', ...ASSURANCE_READERS), async (req, res) => {
    if (!UUID.test(req.params.credentialId)) return invalid(req, res, ['credentialId']);
    if (!credentialVerificationUrl) return unavailable(req, res, 'verification_unavailable');
    await proxyJson(req, res, `${credentialVerificationUrl}/status/${encodeURIComponent(req.params.credentialId)}`);
  });

  app.post('/v1/admin/credentials/:credentialId/:action', requireRole('admin'), async (req, res) => {
    const { credentialId, action } = req.params;
    const body = req.body || {};
    const details = [];
    if (!UUID.test(credentialId)) details.push('credentialId');
    if (!STATUS_ACTIONS.includes(action)) details.push('action');
    if (typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((name) => !['reason', 'agentLearnerKey'].includes(name))) details.push('body');
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > MAX_REASON_CHARS) details.push('reason');
    if (body.agentLearnerKey !== undefined && (typeof body.agentLearnerKey !== 'string' || body.agentLearnerKey.length > 256))
      details.push('agentLearnerKey');
    if (details.length) return invalid(req, res, details);
    if (!credentialVerificationUrl || !credentialInternalKey) return unavailable(req, res, 'verification_unavailable');
    await proxyJson(req, res, `${credentialVerificationUrl}/status/${action}`, {
      method: 'POST',
      headers: { 'x-internal-service-key': credentialInternalKey },
      body: { credentialId, reason: `${body.reason.trim()} (by ${req.auth.subject})`,
        ...(body.agentLearnerKey ? { agentId: body.agentLearnerKey } : {}) },
    });
  });

  app.get('/v1/admin/monitoring/snapshot', requireRole(...ASSURANCE_READERS), async (req, res) => {
    if (!monitoringServiceUrl) return unavailable(req, res, 'monitoring_unavailable');
    await proxyJson(req, res, `${monitoringServiceUrl}/snapshot`);
  });
}

module.exports = { registerAssuranceRoutes, ASSURANCE_READERS };
