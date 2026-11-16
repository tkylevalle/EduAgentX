'use strict';
// Issue #30: Marketplace forwarding. The listing interaction an Agent Learner
// sends through the lifecycle route, and the Capability Request routes.

// Who may change Capability Requests and run checks, and who may only read them.
const MARKETPLACE_WRITERS = Object.freeze(['admin', 'demo_operator']);
const MARKETPLACE_READERS = Object.freeze([...MARKETPLACE_WRITERS, 'viewer', 'evaluator', 'governance_operator']);
// Heavy evaluation rechecks the complete candidate inventory. MATCH-POLICY's
// approved p95 floor is 30s (10s target); unrelated forwarding stays at 5s.
const MARKETPLACE_EVALUATION_TIMEOUT_MS = 30000;

/**
 * @param {{ requireRole: Function, proxyJson: Function, forwardJson: Function, proxyFailure: Function, decorateProtocolResponse: Function,
 *   marketplaceServiceUrl: string, marketplaceInternalKey: string }} deps
 * @returns {{ forwardListingInteraction: Function, registerRoutes: (app: import('express').Express) => void }}
 */
function createMarketplaceGateway({ requireRole, proxyJson, forwardJson, proxyFailure, decorateProtocolResponse, marketplaceServiceUrl,
  marketplaceInternalKey }) {
  // Issue #30: Marketplace. Like Training, marketplace-service trusts the two
  // headers, so the actor is always the token subject, never a body field.
  const marketplaceHeaders = (req) => ({
    'x-internal-service-key': marketplaceInternalKey,
    'x-actor-subject': req.auth.subject,
  });
  const marketplaceUnavailable = (req, res, message) => {
    const body = { apiVersion: 'v1', error: 'marketplace_unavailable', correlationId: req.correlationId };
    return res.status(503).json(message ? decorateProtocolResponse(message, body) : body);
  };

  async function forwardListingInteraction(req, res, message, action) {
    // Only the identity and the protocol's acknowledgement are allowed; the learner listed is the token subject.
    const unexpected = Object.keys(message.payload.data).filter((name) => !['agentLearnerKey', 'response'].includes(name));
    if (unexpected.length) {
      return res.status(400).json(decorateProtocolResponse(message, { apiVersion: 'v1', error: 'invalid_lifecycle_payload',
        details: unexpected.map((name) => ({ field: `payload.data.${name}`, code: 'unexpected', message: `${name} is not accepted` })),
        correlationId: req.correlationId }));
    }
    if (!marketplaceServiceUrl || !marketplaceInternalKey) return marketplaceUnavailable(req, res, message);
    try {
      const upstream = await forwardJson(req, `${marketplaceServiceUrl}/internal/listings/${action}`, {
        method: 'POST', body: { idempotencyKey: message.idempotencyKey }, correlationId: message.correlationId,
        timeoutMs: message.timeoutMs, headers: marketplaceHeaders(req),
      });
      // Not cached here: marketplace-service keeps the durable idempotency record.
      return res.status(upstream.status).json(decorateProtocolResponse(message, upstream.body));
    } catch (error) {
      return proxyFailure(req, res, error, message);
    }
  }

  // One forwarding route. Unknown body fields are refused before anything is
  // sent; marketplace-service validates the rest and stores the actor.
  const marketplaceRoute = (method, buildPath, allowedFields, timeoutMs) => async (req, res) => {
    let body;
    if (method === 'POST') {
      body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: ['body'], correlationId: req.correlationId });
      }
      const unexpected = Object.keys(body).filter((name) => !allowedFields.includes(name));
      if (unexpected.length) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request',
          details: unexpected.map((name) => `unexpected:${name}`), correlationId: req.correlationId });
      }
    }
    if (!marketplaceServiceUrl || !marketplaceInternalKey) return marketplaceUnavailable(req, res);
    await proxyJson(req, res, `${marketplaceServiceUrl}${buildPath(req)}`,
      { method, ...(body === undefined ? {} : { body }), headers: marketplaceHeaders(req),
        ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  };
  const requestPath = (req, suffix = '') =>
    `/internal/capability-requests/${encodeURIComponent(req.params.id)}${suffix}`;

  function registerRoutes(app) {
    app.post('/v1/marketplace/capability-requests', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', () => '/internal/capability-requests', ['idempotencyKey', 'request']));
    app.post('/v1/marketplace/capability-requests/:id/versions', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', (req) => requestPath(req, '/versions'), ['idempotencyKey', 'request']));
    app.post('/v1/marketplace/capability-requests/:id/open', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', (req) => requestPath(req, '/open'), ['version']));
    app.post('/v1/marketplace/capability-requests/:id/close', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', (req) => requestPath(req, '/close'), []));
    app.post('/v1/marketplace/capability-requests/:id/eligibility-checks', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', (req) => requestPath(req, '/eligibility-checks'), ['idempotencyKey'], MARKETPLACE_EVALUATION_TIMEOUT_MS));
    app.post('/v1/marketplace/capability-requests/:id/matches', requireRole(...MARKETPLACE_WRITERS),
      marketplaceRoute('POST', (req) => requestPath(req, '/matches'), ['idempotencyKey'], MARKETPLACE_EVALUATION_TIMEOUT_MS));
    app.get('/v1/marketplace/match-results/:resultId', requireRole(...MARKETPLACE_READERS),
      marketplaceRoute('GET', (req) => `/internal/match-results/${encodeURIComponent(req.params.resultId)}`));
    app.get('/v1/marketplace/capability-requests', requireRole(...MARKETPLACE_READERS),
      marketplaceRoute('GET', () => '/internal/capability-requests'));
    app.get('/v1/marketplace/capability-requests/:id', requireRole(...MARKETPLACE_READERS),
      marketplaceRoute('GET', (req) => requestPath(req)));
    app.get('/v1/marketplace/eligibility-checks/:checkId', requireRole(...MARKETPLACE_READERS),
      marketplaceRoute('GET', (req) => `/internal/eligibility-checks/${encodeURIComponent(req.params.checkId)}`));
    app.get('/v1/marketplace/listings/:agentLearnerKey', requireRole(...MARKETPLACE_READERS),
      marketplaceRoute('GET', (req) => `/internal/listings/${encodeURIComponent(req.params.agentLearnerKey)}`));
  }

  return { forwardListingInteraction, registerRoutes };
}

module.exports = { MARKETPLACE_EVALUATION_TIMEOUT_MS, MARKETPLACE_READERS, MARKETPLACE_WRITERS, createMarketplaceGateway };
