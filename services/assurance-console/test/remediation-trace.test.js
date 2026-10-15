'use strict';

// Issue #21: the Console traces one failure through its gap, the remediation
// event, Training's remediation session and the re-examination as a single
// correlated narrative. Identifiers and outcomes only.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let gateway;
let consoleServer;
let consoleModule;
let mode = 'ok';

const CORRELATION = 'corr-failure-1';
function upstreamTrace() {
  return { correlationId: CORRELATION,
    failure: { attemptId: 'attempt-1', status: 'agent_failed', terminalReason: 'valid_failing_result', mode: 'standard',
      failedAt: '2026-10-15T07:00:00.000Z', agentLearnerKey: '<b>learner</b>', admissionCorrelationId: 'corr-admit',
      package: { id: 'pkg', version: '1', digest: 'd', secret: 'RESTRICTED' }, failureReasons: ['critical_violation'],
      responses: ['RESTRICTED RESPONSE'] },
    gap: { objectiveIds: ['o3', 'o4'], criticalViolationRuleIds: ['critical-o4'] },
    remediation: {
      event: { eventId: 'examination.remediation.required:attempt-1', occurredAt: '2026-10-15T07:00:00.000Z',
        correlationId: CORRELATION, failure: { evidenceDigest: `sha256:${'a'.repeat(64)}`, rationale: 'RESTRICTED GRADING' } },
      delivery: { outcome: 'delivered', trainingSessionId: 'session-r1', recordedAt: '2026-10-15T07:00:02.000Z',
        detail: { status: 201 } } },
    reexaminations: [{ attemptId: 'attempt-2', status: 'complete', terminalReason: 'valid_passing_result', passed: true,
      startedAt: '2026-10-15T08:00:00.000Z', trainingSessionId: 'session-r1', correlationId: 'corr-retake',
      prompt: 'RESTRICTED PROMPT' }] };
}
const trainingSession = { sessionId: 'session-r1', kind: 'remediation', status: 'completed', correlationId: CORRELATION,
  remediation: { requestId: 'examination.remediation.required:attempt-1', objectiveIds: ['o3', 'o4'],
    cause: { summary: 'RESTRICTED SUMMARY' } }, completedItems: 4, plannedItems: 4 };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.before(async () => {
  gateway = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/auth/tokens') return json(res, 200, { accessToken: 'token' });
    if (req.headers.authorization !== 'Bearer token') return json(res, 401, { error: 'unauthorized' });
    if (req.url === '/v1/admin/examinations/attempt-1/remediation') {
      if (mode === 'missing') return json(res, 404, { error: 'attempt_not_found' });
      if (mode === 'unavailable') return json(res, 503, { error: 'dependency_unavailable' });
      const trace = upstreamTrace();
      if (mode === 'none') Object.assign(trace, { gap: null, remediation: null, reexaminations: [] });
      return json(res, 200, { apiVersion: 'v1', trace });
    }
    if (req.url === '/v1/admin/training-sessions/session-r1') {
      if (mode === 'training-down') return json(res, 503, { error: 'dependency_unavailable' });
      return json(res, 200, { apiVersion: 'v1', session: trainingSession, events: [] });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  process.env.API_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.ADMIN_CLIENT_SECRET = 'console-secret';
  consoleModule = require('../index');
  consoleServer = http.createServer(consoleModule.app);
  await new Promise((resolve) => consoleServer.listen(0, '127.0.0.1', resolve));
});

test.after(async () => {
  await Promise.all([consoleServer, gateway].map((server) => new Promise((resolve) => server.close(resolve))));
});

const get = async (path) => {
  const response = await fetch(`http://127.0.0.1:${consoleServer.address().port}${path}`);
  const text = await response.text();
  return { status: response.status, text, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
};

test('the JSON trace joins failure, gap, remediation, Training session and re-examination under one correlation id', async () => {
  mode = 'ok';
  const { status, body, text } = await get('/api/examinations/attempt-1/remediation-trace');
  assert.equal(status, 200);
  const { trace } = body;
  assert.equal(trace.correlationId, CORRELATION);
  assert.deepEqual(trace.steps.map((step) => step.stage), ['failure', 'gap', 'remediation', 'training', 'reexamination']);
  assert.deepEqual(trace.steps.find((step) => step.stage === 'gap').criticalViolationRuleIds, ['critical-o4']);
  const training = trace.steps.find((step) => step.stage === 'training');
  assert.deepEqual([training.sessionId, training.status, training.correlated], ['session-r1', 'completed', true]);
  assert.deepEqual(trace.steps.find((step) => step.stage === 'reexamination').attempts.map((value) => [value.attemptId, value.passed]),
    [['attempt-2', true]]);
  assert.equal(/RESTRICTED/.test(text), false, 'nothing restricted crosses the projection');
});

test('the HTML trace renders the narrative in order and escapes content', async () => {
  mode = 'ok';
  const { status, text } = await get('/examinations/attempt-1/remediation');
  assert.equal(status, 200);
  const order = ['Failure', 'Gap', 'Remediation', 'Training remediation session', 'Re-examination'].map((title) => text.indexOf(`<h2>${title}`));
  assert.ok(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1])), String(order));
  assert.ok(text.includes(CORRELATION));
  assert.ok(text.includes('&lt;b&gt;learner&lt;/b&gt;'));
  assert.equal(/RESTRICTED|<b>learner/.test(text), false);
});

test('an attempt with no remediation, and an unavailable Training session, are shown as such', async () => {
  mode = 'none';
  const none = (await get('/api/examinations/attempt-1/remediation-trace')).body.trace;
  assert.deepEqual(none.steps.map((step) => step.stage), ['failure']);
  assert.match(await (await get('/examinations/attempt-1/remediation')).text, /No remediation was required/);
  mode = 'training-down';
  const partial = (await get('/api/examinations/attempt-1/remediation-trace')).body.trace;
  assert.deepEqual(partial.steps.find((step) => step.stage === 'training'), { stage: 'training', sessionId: 'session-r1',
    available: false });
});

test('missing and unavailable traces are never shown as empty', async () => {
  mode = 'missing';
  assert.equal((await get('/api/examinations/attempt-1/remediation-trace')).status, 404);
  assert.equal((await get('/examinations/attempt-1/remediation')).status, 404);
  mode = 'unavailable';
  assert.equal((await get('/api/examinations/attempt-1/remediation-trace')).status, 503);
  assert.equal((await get('/examinations/attempt-1/remediation')).status, 503);
});
