'use strict';

// The web server holds every credential server-side: the browser only sees
// sanitized reads and an NDJSON stream of lifecycle progress.

const test = require('node:test');
const assert = require('node:assert/strict');
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
