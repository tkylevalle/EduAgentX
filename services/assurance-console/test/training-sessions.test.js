const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const OPEN_ID = '00000000-0000-4000-8000-0000000000a1';
const BLOCKED_ID = '00000000-0000-4000-8000-0000000000b2';
const REMEDIATION_ID = '00000000-0000-4000-8000-0000000000c3';
const sessions = [
  { sessionId: OPEN_ID, agentLearnerKey: 'learner-<b>1</b>', packageId: 'ai-safety', packageVersion: '1.0.0',
    status: 'open', blockReason: null, startedAt: '2026-10-06T10:00:00.000Z', lastEventAt: '2026-10-06T10:05:00.000Z',
    objectiveProgress: [
      { objectiveId: 'o1', plannedItems: 2, completedItems: 2, plannedPractice: 1, completedPractice: 1, complete: true },
      { objectiveId: 'o<2>', plannedItems: 3, completedItems: 1, plannedPractice: 2, completedPractice: 0, complete: false }] },
  { sessionId: BLOCKED_ID, agentLearnerKey: 'learner-2', packageId: 'ai-safety', packageVersion: '0.9.0',
    status: 'blocked', blockReason: 'package_state:Quarantined', startedAt: '2026-10-05T09:00:00.000Z',
    lastEventAt: '2026-10-05T09:30:00.000Z' },
  { sessionId: REMEDIATION_ID, kind: 'remediation', agentLearnerKey: 'learner-3', packageId: 'ai-safety',
    packageVersion: '1.0.0', status: 'assigned', blockReason: null, startedAt: '2026-10-07T09:00:00.000Z',
    lastEventAt: '2026-10-07T09:00:00.000Z',
    remediation: { requestId: 'req-1', objectiveIds: ['o2'], cause: { type: 'examination_failure', reference: 'attempt-<7>' } } },
];
const metrics = {
  apiVersion: 'v1', sessions: 3, completionRate: 0.6667,
  counts: { started: 3, completed: 2, remediated: 1, resumed: 4, aborted: 1, open: 0, assigned: 1 },
};
const events = {
  [OPEN_ID]: [
    { seq: 1, eventType: 'session_started', evidenceMode: 'synthetic', evidenceEnvironment: 'simulation' },
    { seq: 2, eventType: 'item_delivered', moduleId: 'm2', deliveryItemId: 'm2-lesson-1',
      evidenceMode: 'synthetic', evidenceEnvironment: 'simulation' },
  ],
  [BLOCKED_ID]: [
    { seq: 1, eventType: 'session_started', evidenceMode: 'live', evidenceEnvironment: 'live' },
    { seq: 2, eventType: 'session_blocked', evidenceMode: 'live', evidenceEnvironment: 'live' },
  ],
  [REMEDIATION_ID]: [
    { seq: 1, eventType: 'remediation_assigned', evidenceMode: 'synthetic', evidenceEnvironment: 'simulation' },
  ],
};

// One stub Gateway for the whole file; `gatewayMode` switches its behaviour per test.
let gatewayMode = 'ok';
const gatewayRequests = [];
let consoleServer;
let gateway;

test.after(() => {
  consoleServer?.close();
  gateway?.close();
});

test.before(async () => {
  gateway = http.createServer((req, res) => {
    gatewayRequests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/v1/auth/tokens') {
      return gatewayMode === 'token-refused' ? json(res, 401, { error: 'invalid_client' }) : json(res, 200, { accessToken: 'console-admin-token' });
    }
    if (req.headers.authorization !== 'Bearer console-admin-token') return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/v1/admin/training-sessions') {
      return gatewayMode === 'training-down' ? json(res, 503, { error: 'training_unavailable' }) : json(res, 200, { apiVersion: 'v1', sessions });
    }
    if (req.method === 'GET' && req.url === '/v1/admin/training-metrics') {
      return gatewayMode === 'metrics-down' ? json(res, 503, { error: 'training_unavailable' }) : json(res, 200, metrics);
    }
    const match = req.method === 'GET' && req.url.match(/^\/v1\/admin\/training-sessions\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!events[id]) return json(res, 404, { error: 'session_not_found' });
      return json(res, 200, { apiVersion: 'v1', session: sessions.find((s) => s.sessionId === id), events: events[id] });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));

  process.env.API_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.ADMIN_CLIENT_ID = 'console-admin';
  process.env.ADMIN_CLIENT_SECRET = 'console-secret';
  const { app } = require('../index');
  consoleServer = http.createServer(app);
  await new Promise((resolve) => consoleServer.listen(0, '127.0.0.1', resolve));
});

test('console shows current and historical Training Sessions read-only through the Gateway admin routes', async () => {
  gatewayMode = 'ok';
  gatewayRequests.length = 0;
  const page = await request(consoleServer, 'GET', '/');
  assert.equal(page.status, 200);
  const current = page.body.slice(page.body.indexOf('<h3>Current</h3>'), page.body.indexOf('<h3>History</h3>'));
  const history = page.body.slice(page.body.indexOf('<h3>History</h3>'));
  assert.match(current, /learner-&lt;b&gt;1&lt;\/b&gt;/, 'learner keys are escaped');
  assert.match(current, /ai-safety 1\.0\.0/);
  assert.match(current, /m2 \/ m2-lesson-1/);
  assert.match(current, /synthetic/);
  assert.match(current, /simulation/);
  assert.match(current, /2026-10-06T10:00:00\.000Z/);
  assert.match(current, /2026-10-06T10:05:00\.000Z/);
  assert.match(history, /blocked \(package_state:Quarantined\)/);
  assert.match(history, /not started/);
  assert.match(history, />live</);
  assert.doesNotMatch(page.body, /<form|<button/i, 'the view has no controls that change anything');

  const list = await request(consoleServer, 'GET', '/api/training-sessions');
  assert.deepEqual([list.status, list.body.sessions.length], [200, 3]);
  const detail = await request(consoleServer, 'GET', `/api/training-sessions/${OPEN_ID}`);
  assert.deepEqual([detail.status, detail.body.session.sessionId, detail.body.events.length], [200, OPEN_ID, 2]);
  const missing = await request(consoleServer, 'GET', '/api/training-sessions/00000000-0000-4000-8000-000000000000');
  assert.deepEqual([missing.status, missing.body.error], [404, 'session_not_found']);

  assert.equal((await request(consoleServer, 'POST', '/api/training-sessions')).status, 404);
  const toGateway = gatewayRequests.filter((r) => r.path.startsWith('/v1/admin/training-sessions'));
  assert.ok(toGateway.length > 0);
  assert.ok(toGateway.every((r) => r.method === 'GET' && r.authorization === 'Bearer console-admin-token'));
});

test('console shows training metrics and remediation sessions with their cause', async () => {
  gatewayMode = 'ok';
  const page = await request(consoleServer, 'GET', '/');
  const block = page.body.slice(page.body.indexOf('<h3>Metrics</h3>'), page.body.indexOf('<h3>Current</h3>'));
  for (const [label, value] of [['Started', '3'], ['Completed', '2'], ['Remediated', '1'], ['Resumed', '4'],
    ['Aborted', '1'], ['Completion rate', '66.7%']]) {
    assert.match(block, new RegExp(`<dt>${label}</dt><dd>${value}</dd>`), label);
  }
  const current = page.body.slice(page.body.indexOf('<h3>Current</h3>'), page.body.indexOf('<h3>History</h3>'));
  assert.match(current, /assigned/, 'an assigned remediation is current work');
  assert.match(current, /remediation: examination_failure \(attempt-&lt;7&gt;\), objectives o2/);
  assert.match(current, /<td>standard<\/td>/);
  assert.match(current, /<td>o1 2\/2, o&lt;2&gt; 1\/3<\/td>/, 'objective progress, escaped');
  const history = page.body.slice(page.body.indexOf('<h3>History</h3>'));
  assert.match(history, /<td>not tracked<\/td>/, 'a session without a stored plan says so');

  const api = await request(consoleServer, 'GET', '/api/training-metrics');
  assert.deepEqual([api.status, api.body.counts.completed], [200, 2]);
  assert.equal((await request(consoleServer, 'POST', '/api/training-metrics')).status, 404);
});

test('a metrics outage is reported without hiding the session list', async () => {
  gatewayMode = 'metrics-down';
  const page = await request(consoleServer, 'GET', '/');
  assert.match(page.body, /Training metrics unavailable/);
  assert.match(page.body, /<h3>Current<\/h3>/);
  const api = await request(consoleServer, 'GET', '/api/training-metrics');
  assert.deepEqual([api.status, api.body.error], [503, 'training_metrics_unavailable']);
  gatewayMode = 'ok';
});

test('console fails closed when the admin token or Training is unavailable', async () => {
  for (const mode of ['token-refused', 'training-down']) {
    gatewayMode = mode;
    const list = await request(consoleServer, 'GET', '/api/training-sessions');
    assert.deepEqual([list.status, list.body.error], [503, 'training_sessions_unavailable'], mode);
    const detail = await request(consoleServer, 'GET', `/api/training-sessions/${OPEN_ID}`);
    assert.equal(detail.status, mode === 'token-refused' ? 503 : 200, mode);
    const page = await request(consoleServer, 'GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /Training Sessions unavailable/, mode);
    assert.doesNotMatch(page.body, /No Training Sessions exist yet/, `${mode}: an outage is never shown as an empty list`);
  }
  gatewayMode = 'ok';
});

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path, agent: false },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          let body = raw;
          try { body = JSON.parse(raw); } catch {}
          resolve({ status: response.statusCode, body });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}
