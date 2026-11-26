'use strict';
// Admin routes into training-service: read-only session views for the
// Assurance Console and the one human write route, an operator's remediation.
// Training's own read routes do not check roles, so the admin role is enforced here.

const execution = require('../../packages/execution-provenance');
const { isPlainObject } = require('./route-helpers');

const REMEDIATION_FIELDS = Object.freeze([
  'requestId', 'agentLearnerKey', 'packageId', 'packageVersion', 'objectiveIds', 'cause', 'evidence',
]);

/**
 * @param {import('express').Express} app
 * @param {{ requireRole: Function, proxyJson: Function, trainingServiceUrl: string, trainingInternalKey: string,
 *   trainingHeaders: Function, trainingUnavailable: Function, enrolledExecutors: object }} deps
 */
function registerTrainingAdminRoutes(app, { requireRole, proxyJson, trainingServiceUrl, trainingInternalKey, trainingHeaders,
  trainingUnavailable, enrolledExecutors }) {
  app.get('/v1/admin/training-sessions', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    const query = new URLSearchParams();
    for (const name of ['agentLearnerKey', 'status']) {
      if (typeof req.query[name] === 'string' && req.query[name]) query.set(name, req.query[name]);
    }
    await proxyJson(req, res, `${trainingServiceUrl}/internal/sessions${query.size ? `?${query}` : ''}`,
      { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-sessions/:sessionId', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/sessions/${encodeURIComponent(req.params.sessionId)}`,
      { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-metrics', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/metrics`, { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-completion-events', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/completion-events`, { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-completion-incidents', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/completion-incidents`, { headers: trainingHeaders(req) });
  });

  // The one human write route into Training: an operator assigns targeted
  // remediation. An unknown field is refused here, as Training would refuse
  // it; Training validates the rest and records the admin as requestedBy.
  app.post('/v1/admin/training-remediations', requireRole('admin'), async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) {
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: ['body'], correlationId: req.correlationId });
    }
    const unexpected = Object.keys(body).filter((name) => !REMEDIATION_FIELDS.includes(name));
    if (unexpected.length) {
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request',
        details: unexpected.map((name) => `unexpected:${name}`), correlationId: req.correlationId });
    }
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    const plannedAuthority = execution.authority(enrolledExecutors, { subject: body.agentLearnerKey, role: 'agent' });
    await proxyJson(req, res, `${trainingServiceUrl}/internal/remediations`,
      { method: 'POST', body: { ...body, ...(plannedAuthority ? { trustedExecution: plannedAuthority } : {}) },
      headers: trainingHeaders(req) });
  });
}

module.exports = { registerTrainingAdminRoutes };
