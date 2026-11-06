'use strict';

// The web server holds every credential server-side: the browser only sees
// sanitized reads and an NDJSON stream of lifecycle progress.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../server');

const ATTEMPT_ID = '7d30001b-7452-4f7e-99f4-f43f3b5892f3';

// A gateway stand-in: issues a token and answers the remediation trace,
// which reports a delivery from the second read on.
function fakeGateway() {
  const calls = [];
  let traceReads = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (url.endsWith('/v1/auth/tokens')) return reply(200, { accessToken: 'admin-token', expiresIn: 900 });
    if (url.includes(`/v1/admin/examinations/${ATTEMPT_ID}/remediation`)) {
      traceReads += 1;
      return reply(200, { trace: { gap: { objectiveIds: ['o4'] },
        remediation: { delivery: traceReads > 1 ? { outcome: 'delivered', trainingSessionId: 'remediation-1' } : null } } });
    }
    return reply(404, { error: 'not_found' });
  };
  return { fetchImpl, calls };
}

function failingDriver({ gate } = {}) {
  return {
    async run({ onStep }) {
      onStep({ id: 'examine', status: 'running' });
      if (gate) await gate;
      const failed = { id: 'examine', status: 'failed', error: 'agent_failed_examination', detail: { attemptId: ATTEMPT_ID } };
      onStep(failed);
      return { runId: 'run-1', status: 'failed', error: 'agent_failed_examination', steps: [failed] };
    },
  };
}

async function listen(t, options) {
  const server = createServer({ env: { ADMIN_CLIENT_ID: 'admin', ADMIN_CLIENT_SECRET: 'secret' }, ...options }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a failed run streams its steps, then waits for the remediation delivery before it ends', async (t) => {
  const { fetchImpl } = fakeGateway();
  const base = await listen(t, { fetchImpl, driver: failingDriver() });
  const reply = await post(base, '/api/lifecycle/run', { scenario: 'hostile-instruction' });
  assert.equal(reply.headers.get('content-type'), 'application/x-ndjson');
  const messages = (await reply.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(messages.map((message) => message.type), ['plan', 'step', 'step', 'remediation', 'done']);
  assert.equal(messages[3].remediation.trace.remediation.delivery.trainingSessionId, 'remediation-1');
  assert.equal(messages[4].report.status, 'failed');
});

test('only one run at a time, and a bad scenario is refused', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const base = await listen(t, { fetchImpl: fakeGateway().fetchImpl, driver: failingDriver({ gate }) });
  const first = await post(base, '/api/lifecycle/run', { scenario: 'safe-escalation' });
  const second = await post(base, '/api/lifecycle/run', { scenario: 'safe-escalation' });
  assert.equal(second.status, 409);
  release();
  await first.text();
  assert.equal((await post(base, '/api/lifecycle/run', { scenario: 'DROP TABLE' })).status, 400);
});

test('status changes and verification validate input before calling the gateway', async (t) => {
  const { fetchImpl, calls } = fakeGateway();
  const base = await listen(t, { fetchImpl, driver: failingDriver() });
  assert.equal((await post(base, '/api/credentials/not-a-uuid/revoke', { reason: 'x' })).status, 400);
  assert.equal((await post(base, `/api/credentials/${ATTEMPT_ID}/delete`, { reason: 'x' })).status, 400);
  assert.equal((await post(base, `/api/credentials/${ATTEMPT_ID}/suspend`, { reason: '  ' })).status, 400);
  assert.equal((await post(base, '/api/verify', { jws: '' })).status, 400);
  assert.equal(calls.length, 0, 'nothing reached the gateway');
});

test('a run can only be started by this app: same origin, local host, JSON body', async (t) => {
  let runs = 0;
  const driver = { async run() { runs += 1; return { runId: 'run-1', status: 'passed', steps: [] }; } };
  const base = await listen(t, { fetchImpl: fakeGateway().fetchImpl, driver });
  const start = (headers, body = JSON.stringify({ scenario: 'safe-escalation' })) =>
    fetch(`${base}/api/lifecycle/run`, { method: 'POST', headers, body });

  // A plain form post from another site needs no CORS preflight, so it must be refused here.
  assert.equal((await start({ 'content-type': 'text/plain' })).status, 415);
  assert.equal((await start({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403);
  // fetch() ignores a Host header, so the rebinding case goes through node:http.
  assert.equal(await statusWithHost(base, 'rebound.example:4300'), 403);
  assert.equal(runs, 0, 'no refused request started a run');

  const own = await start({ 'content-type': 'application/json', origin: base });
  assert.equal(own.status, 200);
  await own.text();
  assert.equal(runs, 1);
});

function statusWithHost(base, host) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/api/lifecycle/run', method: 'POST',
      headers: { host, 'content-type': 'application/json' } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end(JSON.stringify({ scenario: 'safe-escalation' }));
  });
}

// --- marketplace (Issue #35): a stand-in for the Gateway's own marketplace
// routes, so these tests check this app's proxying/validation, not #30/#31's logic.
function fakeMarketplaceGateway() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (url.endsWith('/v1/auth/tokens')) return reply(200, { accessToken: 'admin-token', expiresIn: 900 });
    const method = init.method || 'GET';
    if (url.endsWith('/v1/marketplace/capability-requests') && method === 'POST')
      return reply(201, { apiVersion: 'v1', outcome: 'created',
        request: { id: 'req-1', state: { status: 'draft', openVersion: null }, versions: [{ version: 1 }] } });
    if (url.endsWith('/v1/marketplace/capability-requests') && method === 'GET')
      return reply(200, { apiVersion: 'v1', requests: [] });
    if (/\/v1\/marketplace\/capability-requests\/[^/]+\/open$/.test(url))
      return reply(200, { apiVersion: 'v1', outcome: 'opened', request: { id: 'req-1', state: { status: 'open', openVersion: 1 } } });
    if (/\/v1\/marketplace\/capability-requests\/[^/]+\/matches$/.test(url))
      return reply(201, { apiVersion: 'v1', outcome: 'created',
        matchResult: { resultId: 'result-1', outcome: 'MATCHED', eligibleMatches: [], nearMatches: [], exclusions: [] } });
    if (/\/v1\/marketplace\/match-results\/[^/]+$/.test(url))
      return reply(200, { apiVersion: 'v1', outcome: 'found', matchResult: { resultId: 'result-1' } });
    return reply(404, { error: 'not_found' });
  };
  return { fetchImpl, calls };
}

test('marketplace routes validate input before calling the gateway', async (t) => {
  const { fetchImpl, calls } = fakeMarketplaceGateway();
  const base = await listen(t, { fetchImpl, driver: failingDriver() });
  assert.equal((await post(base, '/api/marketplace/capability-requests', { idempotencyKey: '', request: {} })).status, 400);
  assert.equal((await post(base, '/api/marketplace/capability-requests', { idempotencyKey: 'k1' })).status, 400);
  assert.equal((await post(base, '/api/marketplace/capability-requests/not-a-uuid/open', { version: 1 })).status, 400);
  assert.equal((await post(base, `/api/marketplace/capability-requests/${ATTEMPT_ID}/open`, { version: 0 })).status, 400);
  assert.equal((await post(base, '/api/marketplace/capability-requests/not-a-uuid/matches', { idempotencyKey: 'k1' })).status, 400);
  assert.equal((await post(base, `/api/marketplace/capability-requests/${ATTEMPT_ID}/matches`, { idempotencyKey: '' })).status, 400);
  assert.equal((await fetch(`${base}/api/marketplace/match-results/not-a-uuid`)).status, 400);
  assert.equal(calls.length, 0, 'nothing reached the gateway');
});

test('marketplace routes proxy to the gateway and forward its response through', async (t) => {
  const { fetchImpl, calls } = fakeMarketplaceGateway();
  const base = await listen(t, { fetchImpl, driver: failingDriver() });

  const created = await post(base, '/api/marketplace/capability-requests', { idempotencyKey: 'k1', request: { title: 'x' } });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.outcome, 'created');
  assert.equal(createdBody.request.id, 'req-1');

  const opened = await post(base, `/api/marketplace/capability-requests/${ATTEMPT_ID}/open`, { version: 1 });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).request.state.status, 'open');

  const matched = await post(base, `/api/marketplace/capability-requests/${ATTEMPT_ID}/matches`, { idempotencyKey: 'k2' });
  assert.equal(matched.status, 201);
  assert.equal((await matched.json()).matchResult.resultId, 'result-1');

  const result = await fetch(`${base}/api/marketplace/match-results/${ATTEMPT_ID}`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).matchResult.resultId, 'result-1');

  assert.equal((await fetch(`${base}/api/marketplace/capability-requests`)).status, 200);

  const marketplaceCalls = calls.filter((c) => c.url.includes('/v1/marketplace/'));
  assert.equal(marketplaceCalls.length, 5, 'one gateway call per route, no retries or extra round-trips');
  assert.deepEqual(marketplaceCalls[0].body, { idempotencyKey: 'k1', request: { title: 'x' } });
});

test('an unreachable gateway reports marketplace_unavailable, not a crash', async (t) => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const base = await listen(t, { fetchImpl, driver: failingDriver() });
  const reply = await post(base, '/api/marketplace/capability-requests', { idempotencyKey: 'k1', request: { title: 'x' } });
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).error, 'marketplace_unavailable');
});
