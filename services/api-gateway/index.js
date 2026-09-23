// api-gateway (Sprint 1)
//
// This is a stub - just enough to route a request through to the
// registry and prove the platform boots end to end. No real auth yet,
// that's #3's job. Swap requireTestToken() out when that lands.

const express = require('express');
const fetch = require('node-fetch');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 4000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const AGENT_REGISTRY_URL = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001';
const GATEWAY_TEST_TOKEN = process.env.GATEWAY_TEST_TOKEN || '';

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
function requireTestToken(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!GATEWAY_TEST_TOKEN || token !== GATEWAY_TEST_TOKEN) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'missing or invalid test token',
      correlationId: req.correlationId,
    });
  }
  next();
}

// proxies straight to the registry - lets us prove gateway -> registry
// -> postgres/redis with one request, without the caller touching the db
app.post('/v1/registrations', requireTestToken, async (req, res) => {
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
