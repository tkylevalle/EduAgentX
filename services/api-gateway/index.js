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
app.use(express.json());

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

// dumb bearer-token check just so the smoke test path isn't wide open.
// #3 replaces this with real authN/authZ.
// exchanges pre-shared Sprint 1 client credentials for a short-lived
// RS256 JWT. See auth.js for the full contract.
app.post('/v1/auth/tokens', issueToken);

// demonstrates admin-vs-agent role separation (SEC-01: "Admin endpoints
// reject agent tokens"). No real admin capability lives here yet - this
// is a minimal, testable proof that role enforcement works.
app.get('/v1/admin/whoami', requireRole('admin'), (req, res) => {
  res.status(200).json({ subject: req.auth.subject, role: req.auth.role, correlationId: req.correlationId });
});

// proxies straight to the registry - lets us prove gateway -> registry
// -> postgres/redis with one request, without the caller touching the db
app.post('/v1/registrations', requireRole('agent'), async (req, res) => {
  try {
    const upstream = await fetch(`${AGENT_REGISTRY_URL}/internal/registrations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': req.correlationId,
      },
      body: JSON.stringify(req.body || {}),
    });

    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    console.error(`[${SERVICE_NAME}] proxy error`, err);
    res.status(502).json({ error: 'upstream_unavailable', correlationId: req.correlationId });
  }
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
});
