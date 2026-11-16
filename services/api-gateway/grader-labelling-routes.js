'use strict';
// Grader labelling routes (packages/grading-validity README, "How to label";
// target design 9): a reviewer or admin labels the grader validation dataset
// on validation-activation under their own token subject, and only an admin
// exports every label. The body never names the labeller: the Gateway sends
// only the label's fields and the subject it verified.

// validation-activation's largest batch (labelling-routes.js MAX_BATCH); refused here first.
const MAX_BATCH = 20;
const BATCH = /^[1-9]\d{0,1}$/;

/**
 * @param {import('express').Express} app
 * @param {{ requireRole: Function, proxyJson: Function, validationActivationUrl: string, curriculumInternalKey: string }} deps
 */
function registerGraderLabellingRoutes(app, { requireRole, proxyJson, validationActivationUrl, curriculumInternalKey }) {
  const headers = (req) => ({
    'x-internal-service-key': curriculumInternalKey,
    'x-actor-subject': req.auth.subject,
    'x-actor-role': req.auth.role,
  });
  const labeller = requireRole('reviewer', 'admin');

  app.get('/v1/grader-labels/next', labeller, async (req, res) => {
    const { limit } = req.query;
    if (limit !== undefined && (typeof limit !== 'string' || !BATCH.test(limit) || Number(limit) > MAX_BATCH)) {
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_limit', max: MAX_BATCH, correlationId: req.correlationId });
    }
    const query = limit === undefined ? '' : `?limit=${limit}`;
    await proxyJson(req, res, `${validationActivationUrl}/grader-labels/next${query}`, { headers: headers(req) });
  });

  app.get('/v1/grader-labels/progress', labeller, async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/grader-labels/progress`, { headers: headers(req) });
  });

  app.post('/v1/grader-labels', labeller, async (req, res) => {
    const { itemKey, acceptable, score, safetyViolation } = req.body || {};
    await proxyJson(req, res, `${validationActivationUrl}/grader-labels`,
      { method: 'POST', body: { itemKey, acceptable, score, safetyViolation }, headers: headers(req) });
  });

  app.get('/v1/admin/grader-labels/export', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/grader-labels/export`, { headers: headers(req) });
  });
}

module.exports = { registerGraderLabellingRoutes };
