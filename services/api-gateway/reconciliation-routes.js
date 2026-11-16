'use strict';
// Read-only, exact-command reconciliation. Never proxies arbitrary URLs/queries.
const { TRAINING_IDENTIFIER: ID, UUID } = require('./route-helpers');
function registerReconciliationRoutes(app, { requireRole, proxyJson, examinationEngineUrl, examinationInternalKey,
  certificationServiceUrl, certificationInternalKey, marketplaceServiceUrl, marketplaceInternalKey }) {
  const definitions = [
    ['examinations', examinationEngineUrl, examinationInternalKey, ['agentLearnerKey', 'idempotencyKey']],
    ['credentials', certificationServiceUrl, certificationInternalKey, ['examinationId']],
    ['matches', marketplaceServiceUrl, marketplaceInternalKey, ['actor', 'idempotencyKey']],
  ];
  for (const [kind, url, key, fields] of definitions) app.get(`/v1/admin/reconciliation/${kind}`, requireRole('admin'), async (req, res) => {
    if (Object.keys(req.query).sort().join(',') !== [...fields].sort().join(',') || fields.some(f =>
      typeof req.query[f] !== 'string' || !(f === 'examinationId' ? UUID : ID).test(req.query[f])))
      return res.status(400).json({ error: 'invalid_request', correlationId: req.correlationId });
    if (!url || !key) return res.status(503).json({ error: 'reconciliation_unavailable', correlationId: req.correlationId });
    const query = new URLSearchParams(fields.map(f => [f, req.query[f]]));
    await proxyJson(req, res, `${url}/internal/reconciliation/${kind}?${query}`, { headers: {
      'x-internal-service-key': key, 'x-actor-subject': req.auth.subject,
      'x-actor-role': kind === 'credentials' ? 'gateway' : 'admin', 'x-reconciliation-role': 'admin',
    } });
  });
}
module.exports = { registerReconciliationRoutes };
