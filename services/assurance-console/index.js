const { randomUUID } = require('node:crypto');
const express = require('express');
const fetch = require('node-fetch');

const PORT = Number(process.env.PORT || 4100);
const SERVICE_NAME = process.env.SERVICE_NAME || 'assurance-console';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';
const ADMIN_CLIENT_ID = process.env.ADMIN_CLIENT_ID || 'capstone-admin-dev';
const ADMIN_CLIENT_SECRET = process.env.ADMIN_CLIENT_SECRET || 'changeme_local_only_admin_secret';

const app = express();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: SERVICE_NAME });
});

app.get('/api/registration-trace', async (req, res) => {
  try {
    const trace = await readLatestTrace();
    if (!trace) {
      return res.status(200).json({ apiVersion: 'v1', status: 'empty', message: 'No registration assurance evidence exists' });
    }
    return res.status(200).json({ apiVersion: 'v1', status: 'available', trace });
  } catch (error) {
    console.error(`[${SERVICE_NAME}] trace read failed`, error);
    return res.status(503).json({ apiVersion: 'v1', error: 'trace_unavailable', message: 'Registration trace is unavailable' });
  }
});

app.get('/', async (req, res) => {
  let gatewayStatus = 'unknown';
  try {
    const health = await fetch(`${API_GATEWAY_URL}/health`);
    gatewayStatus = health.ok ? 'reachable' : `unreachable (${health.status})`;
  } catch (error) {
    gatewayStatus = `unreachable (${error.message})`;
  }

  let traceState;
  try {
    traceState = await readLatestTrace();
  } catch (error) {
    traceState = { error: 'Registration trace unavailable' };
  }

  res.status(200).send(renderPage(gatewayStatus, traceState));
});

async function readLatestTrace() {
  const correlationId = `console-trace-${randomUUID()}`;
  const tokenResponse = await requestJson(`${API_GATEWAY_URL}/v1/auth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ clientId: ADMIN_CLIENT_ID, clientSecret: ADMIN_CLIENT_SECRET }),
  });
  if (!tokenResponse.ok) throw new Error(`admin token request returned ${tokenResponse.status}`);

  const traceResponse = await requestJson(`${API_GATEWAY_URL}/v1/admin/registration-traces/latest`, {
    headers: {
      authorization: `Bearer ${tokenResponse.body.accessToken}`,
      'x-correlation-id': correlationId,
    },
  });
  if (traceResponse.status === 404) return null;
  if (!traceResponse.ok) throw new Error(`trace request returned ${traceResponse.status}`);
  return traceResponse.body.trace;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: raw ? JSON.parse(raw) : {},
  };
}

function renderPage(gatewayStatus, trace) {
  const hasTrace = trace && !trace.error;
  const traceContent = hasTrace
    ? `<dl>
        <dt>Outcome</dt><dd>${escapeHtml(trace.outcome)}</dd>
        <dt>Agent Learner ID</dt><dd>${escapeHtml(trace.registration.agentLearnerId)}</dd>
        <dt>Agent Learner key</dt><dd>${escapeHtml(trace.registration.agentLearnerKey)}</dd>
        <dt>Configuration version</dt><dd>${escapeHtml(trace.registration.configurationVersion)}</dd>
        <dt>Configuration fingerprint</dt><dd><code>${escapeHtml(trace.registration.configurationFingerprint)}</code></dd>
        <dt>Assurance event</dt><dd>${escapeHtml(trace.assurance.eventType)} (${escapeHtml(trace.assurance.eventId)})</dd>
        <dt>Correlation ID</dt><dd><code>${escapeHtml(trace.assurance.correlationId)}</code></dd>
      </dl>`
    : `<p>${escapeHtml(trace?.error || 'No registration assurance evidence exists yet.')}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>EduAgentX Assurance Console</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 50rem; margin: 0 auto; padding: 2rem; color: #172033; }
      dt { font-weight: 700; margin-top: 1rem; }
      dd { margin: .25rem 0 0; overflow-wrap: anywhere; }
      code { font-size: .9em; }
      .status { color: #176b3a; }
    </style>
  </head>
  <body>
    <h1>EduAgentX Assurance Console</h1>
    <p>Read-only registration evidence for the current local demonstration.</p>
    <p>API Gateway status: <strong class="status">${escapeHtml(gatewayStatus)}</strong></p>
    <h2>Latest Agent Registry trace</h2>
    ${traceContent}
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });
}

module.exports = { app, escapeHtml, renderPage };
