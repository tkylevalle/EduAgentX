// api-gateway (Sprint 1)
//
// Routes requests through to the registry and enforces the platform's
// authN/authZ contract (work package "API Gateway, authentication, and
// contracts", #3). Real JWT issuance/verification lives in auth.js -
// see that file for the design rationale and its mapping to SEC-01 in
// the Software Design Document.

const express = require('express');
const fetch = require('node-fetch');
const { randomUUID } = require('crypto');
const { issueToken, requireRole } = require('./auth');

const PORT = process.env.PORT || 4000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const AGENT_REGISTRY_URL = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001';
const app = express();
app.use(express.json({ limit: '64kb' }));

// every request gets a correlation id, either passed in or generated here
app.use((req, res, next) => {
  req.correlationId = req.header('x-correlation-id') || randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

app.get('/health', async (req, res) => {
  try {
    const r = await fetch(`${AGENT_REGISTRY_URL}/health`);
    if (!r.ok) throw new Error(`agent-registry health returned ${r.status}`);
    res.status(200).json({ status: 'ok', service: SERVICE_NAME });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, error: err.message });
  }
});

// exchanges pre-shared Sprint 1 client credentials for a short-lived
// RS256 JWT. See auth.js for the full contract.
app.post('/v1/auth/tokens', issueToken);

// demonstrates admin-vs-agent role separation (SEC-01: "Admin endpoints
// reject agent tokens"). No real admin capability lives here yet - this
// is a minimal, testable proof that role enforcement works.
app.get('/v1/admin/whoami', requireRole('admin'), (req, res) => {
  res.status(200).json({ apiVersion: 'v1', subject: req.auth.subject, role: req.auth.role, correlationId: req.correlationId });
});

// The gateway owns the public versioned seam. The registry container only
// receives requests on the internal network, through its matching /v1 route.
app.post('/v1/registrations', requireRole('agent'), requireAgentIdentity, async (req, res) => {
  await proxyJson(req, res, `${AGENT_REGISTRY_URL}/v1/registrations`, {
    method: 'POST',
    body: req.body || {},
    headers: { 'x-agent-subject': req.auth.subject },
  });
});

app.get('/v1/registrations', requireRole('agent', 'admin'), async (req, res) => {
  const key = req.query.agentLearnerKey;
  if (req.auth.role === 'agent' && key !== req.auth.subject) {
    return identityMismatch(req, res);
  }
  await proxyJson(
    req,
    res,
    `${AGENT_REGISTRY_URL}/v1/registrations?agentLearnerKey=${encodeURIComponent(key || '')}`
  );
});

app.get('/v1/registrations/:agentLearnerId', requireRole('agent', 'admin'), async (req, res) => {
  await proxyJson(req, res, `${AGENT_REGISTRY_URL}/v1/registrations/${encodeURIComponent(req.params.agentLearnerId)}`, {
    enforceAgentOwnership: req.auth.role === 'agent',
  });
});

app.get('/v1/admin/registration-traces/latest', requireRole('admin'), async (req, res) => {
  await proxyJson(req, res, `${AGENT_REGISTRY_URL}/v1/registration-traces/latest`);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      apiVersion: 'v1',
      error: 'payload_too_large',
      message: 'Request body exceeds the 64kb limit',
      correlationId: req.correlationId,
    });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      apiVersion: 'v1',
      error: 'invalid_request',
      message: 'Request body must contain valid JSON',
      correlationId: req.correlationId,
    });
  }
  console.error(`[${SERVICE_NAME}] unhandled request error`, error);
  return res.status(500).json({ apiVersion: 'v1', error: 'internal_error', correlationId: req.correlationId });
});

function requireAgentIdentity(req, res, next) {
  if (!req.body || req.body.agentLearnerKey !== req.auth.subject) {
    return identityMismatch(req, res);
  }
  next();
}

function identityMismatch(req, res) {
  return res.status(403).json({
    apiVersion: 'v1',
    error: 'identity_mismatch',
    message: 'agentLearnerKey must match the authenticated Agent Learner identity',
    correlationId: req.correlationId,
  });
}

async function proxyJson(req, res, url, options = {}) {
  try {
    const upstream = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'x-correlation-id': req.correlationId,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers || {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await upstream.text();
    const body = raw ? JSON.parse(raw) : {};

    if (options.enforceAgentOwnership && upstream.ok && body.registration?.agentLearnerKey !== req.auth.subject) {
      return identityMismatch(req, res);
    }
    return res.status(upstream.status).json(body);
  } catch (error) {
    console.error(`[${SERVICE_NAME}] proxy error`, error);
    return res.status(502).json({
      apiVersion: 'v1',
      error: 'upstream_unavailable',
      correlationId: req.correlationId,
    });
  }
}

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
});
