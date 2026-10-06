const { randomUUID } = require('node:crypto');
const express = require('express');
const fetch = require('node-fetch');

const telemetry = require('../../packages/telemetry');

const PORT = Number(process.env.PORT || 4100);
const SERVICE_NAME = process.env.SERVICE_NAME || 'assurance-console';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';
const ADMIN_CLIENT_ID = process.env.ADMIN_CLIENT_ID || 'capstone-admin-dev';
const ADMIN_CLIENT_SECRET = process.env.ADMIN_CLIENT_SECRET;
// The page loads each session's event history, so it shows only the most recent ones.
const MAX_TRAINING_SESSION_ROWS = 20;

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
    telemetry.log(SERVICE_NAME, 'trace_read_failed', { outcome: 'error' });
    return res.status(503).json({ apiVersion: 'v1', error: 'trace_unavailable', message: 'Registration trace is unavailable' });
  }
});

// Read-only Training Session evidence. Any failure is reported as
// unavailable, never as an empty list.
app.get('/api/training-sessions', async (req, res) => {
  try {
    const get = await adminClient(`console-training-${randomUUID()}`);
    const list = await get('/v1/admin/training-sessions');
    if (!list.ok || !Array.isArray(list.body.sessions)) throw new Error(`training sessions request returned ${list.status}`);
    return res.status(200).json({ apiVersion: 'v1', sessions: list.body.sessions });
  } catch (error) {
    telemetry.log(SERVICE_NAME, 'training_sessions_read_failed', { outcome: 'error' });
    return res.status(503).json({ apiVersion: 'v1', error: 'training_sessions_unavailable', message: 'Training Sessions are unavailable' });
  }
});

app.get('/api/training-sessions/:sessionId', async (req, res) => {
  try {
    const get = await adminClient(`console-training-${randomUUID()}`);
    const detail = await get(`/v1/admin/training-sessions/${encodeURIComponent(req.params.sessionId)}`);
    if (detail.status === 404) return res.status(404).json({ apiVersion: 'v1', error: 'session_not_found' });
    if (!detail.ok || !detail.body.session) throw new Error(`training session request returned ${detail.status}`);
    return res.status(200).json({ apiVersion: 'v1', session: detail.body.session, events: detail.body.events });
  } catch (error) {
    telemetry.log(SERVICE_NAME, 'training_sessions_read_failed', { outcome: 'error' });
    return res.status(503).json({ apiVersion: 'v1', error: 'training_sessions_unavailable', message: 'Training Sessions are unavailable' });
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

  let trainingState;
  try {
    trainingState = await readTrainingSessions();
  } catch (error) {
    trainingState = { error: 'Training Sessions unavailable' };
  }

  res.status(200).send(renderPage(gatewayStatus, traceState, trainingState));
});

// Same admin client credentials and token route as the registration trace.
// Without a secret, or if the Gateway refuses the token, this throws.
async function adminClient(correlationId) {
  if (!ADMIN_CLIENT_SECRET) throw new Error('admin client secret is not configured');
  const tokenResponse = await requestJson(`${API_GATEWAY_URL}/v1/auth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ clientId: ADMIN_CLIENT_ID, clientSecret: ADMIN_CLIENT_SECRET }),
  });
  if (!tokenResponse.ok) throw new Error(`admin token request returned ${tokenResponse.status}`);
  const authorization = `Bearer ${tokenResponse.body.accessToken}`;
  return (path) => requestJson(`${API_GATEWAY_URL}${path}`, {
    headers: { authorization, 'x-correlation-id': correlationId },
  });
}

// The list holds status and timestamps; module, item, mode and environment
// live in each session's event history, so the newest sessions are expanded.
async function readTrainingSessions() {
  const get = await adminClient(`console-training-${randomUUID()}`);
  const list = await get('/v1/admin/training-sessions');
  if (!list.ok || !Array.isArray(list.body.sessions)) throw new Error(`training sessions request returned ${list.status}`);
  const sessions = list.body.sessions.slice(0, MAX_TRAINING_SESSION_ROWS);
  const rows = await Promise.all(sessions.map(async (session) => {
    const detail = await get(`/v1/admin/training-sessions/${encodeURIComponent(session.sessionId)}`)
      .catch(() => ({ ok: false }));
    return { ...session, events: detail.ok && Array.isArray(detail.body.events) ? detail.body.events : null };
  }));
  return { rows, total: list.body.sessions.length };
}

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

function renderTrainingSessions(training) {
  if (!training || training.error) return `<p>${escapeHtml(training?.error || 'Training Sessions unavailable')}</p>`;
  if (!training.rows.length) return '<p>No Training Sessions exist yet.</p>';
  const table = (rows) => (rows.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Agent Learner</th><th>Package</th><th>Status</th><th>Module / item</th><th>Mode</th><th>Environment</th><th>Started</th><th>Last event</th></tr></thead>
        <tbody>${rows.map(renderSessionRow).join('')}</tbody>
      </table></div>`
    : '<p>None.</p>');
  const shown = training.rows.length < training.total
    ? `<p>Showing the ${training.rows.length} most recent of ${training.total} sessions.</p>` : '';
  return `${shown}
    <h3>Current</h3>${table(training.rows.filter((row) => row.status === 'open'))}
    <h3>History</h3>${table(training.rows.filter((row) => row.status !== 'open'))}`;
}

// Fields that come from the event history say "unavailable" if it could not
// be read, rather than showing a guess.
function renderSessionRow(row) {
  const events = row.events;
  const latest = events?.at(-1);
  const lastItem = events?.findLast((event) => event.deliveryItemId);
  const item = !events ? 'unavailable' : lastItem ? `${lastItem.moduleId} / ${lastItem.deliveryItemId}` : 'not started';
  const status = row.blockReason ? `${row.status} (${row.blockReason})` : row.status;
  return `<tr>
      <td>${escapeHtml(row.agentLearnerKey)}</td>
      <td>${escapeHtml(row.packageId)} ${escapeHtml(row.packageVersion)}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(item)}</td>
      <td>${escapeHtml(events ? latest?.evidenceMode : 'unavailable')}</td>
      <td>${escapeHtml(events ? latest?.evidenceEnvironment : 'unavailable')}</td>
      <td>${escapeHtml(row.startedAt)}</td>
      <td>${escapeHtml(row.lastEventAt)}</td>
    </tr>`;
}

function renderPage(gatewayStatus, trace, training) {
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
      .table-wrap { overflow-x: auto; }
      table { border-collapse: collapse; font-size: .9em; }
      th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #d5dae3; vertical-align: top; }
    </style>
  </head>
  <body>
    <h1>EduAgentX Assurance Console</h1>
    <p>Read-only registration evidence for the current local demonstration.</p>
    <p>API Gateway status: <strong class="status">${escapeHtml(gatewayStatus)}</strong></p>
    <h2>Latest Agent Registry trace</h2>
    ${traceContent}
    <h2>Training Sessions</h2>
    ${renderTrainingSessions(training)}
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
  if (!ADMIN_CLIENT_SECRET) {
    console.error(`[${SERVICE_NAME}] ADMIN_CLIENT_SECRET is required`);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });
}

module.exports = { app, escapeHtml, renderPage };
