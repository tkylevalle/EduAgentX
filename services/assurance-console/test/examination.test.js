'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let renderExamination;
let safeExamination;
let gateway;
let consoleServer;
let upstreamAttempt;
let gatewayMode = 'ok';
const requests = [];

function fixture(status = 'in_progress') {
  return { attemptId: 'attempt-1', status, mode: 'standard', sequence: 17,
    responsesReceived: 15, responseCollectionComplete: true,
    terminalReason: status === 'agent_failed' ? 'assessment_failed'
      : status === 'system_aborted' ? 'governance_changed' : null,
    completedAt: status === 'complete' ? '2026-10-12T07:05:00Z' : null,
    failedAt: status === 'agent_failed' ? '2026-10-12T07:05:00Z' : null,
    abortedAt: status === 'system_aborted' ? '2026-10-12T07:05:00Z' : null,
    agentLearnerKey: '<script>alert(1)</script>', configurationFingerprint: 'fingerprint',
    package: { id: 'pkg', version: '1', digest: 'digest', responses: ['RESTRICTED RESPONSE'] },
    template: { id: 'template', version: '1', digest: 'template-digest', privatePrompt: 'RESTRICTED PROMPT' },
    rubric: { id: 'rubric', version: '1', digest: 'rubric-digest', expectedAnswer: 'RESTRICTED ANSWER' },
    generationPolicySha256: 'policy-hash', trainingEventId: 'event-1', formDigest: 'form-hash',
    startedAt: '2026-10-12T06:00:00Z', deadlineAt: '2026-10-12T07:00:00Z',
    responses: [{ itemId: 'item-1', response: 'RESTRICTED RESPONSE' }],
    grade: { graderRationale: 'RESTRICTED GRADING' },
    events: [{ payload: { response: 'RESTRICTED RESPONSE' } }],
    itemReferences: [{ id: 'item-1', slotId: 'r1', tier: 'recall', promptSha256: 'prompt-hash',
      moduleIds: ['m1'], objectiveIds: ['o1'],
      prompt: 'RESTRICTED PROMPT', expectedAnswer: 'RESTRICTED ANSWER' }],
  };
}

// The Engine's fallback admin projection, plus fields it must never pass on.
function fallbackFixture(status = 'complete', causeAttemptId = 'aborted-attempt-1') {
  return { ...fixture(status), mode: 'fallback', template: undefined, generationPolicySha256: undefined, trainingEventId: undefined,
    rubric: { id: 'fallback-scoring/1.0.0', version: '1.0.0', digest: 'policy-digest' },
    causeAttemptId, reason: causeAttemptId ? 'standard_grading_unavailable' : 'standard_generation_unavailable',
    bank: { id: 'ai-safety-fallback', version: '0.1.5-draft', expectedAnswers: ['RESTRICTED ANSWER'] },
    vaSelectionId: 'RESTRICTED SELECTION ID',
    itemReferences: [{ id: 'fallback-06', tier: 'applied', answerType: 'multiple_choice', objectiveIds: ['o1'],
      choices: ['RESTRICTED CHOICE'], expectedAnswer: 'RESTRICTED ANSWER' }] };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.before(async () => {
  gateway = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    if (req.method === 'POST' && req.url === '/v1/auth/tokens')
      return json(res, 200, { accessToken: 'console-admin-token' });
    if (req.headers.authorization !== 'Bearer console-admin-token')
      return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/v1/admin/examinations/attempt-1') {
      if (gatewayMode === 'missing') return json(res, 404, { error: 'attempt_not_found' });
      if (gatewayMode === 'unavailable') return json(res, 503, { error: 'dependency_unavailable' });
      return json(res, 200, { apiVersion: 'v1', attempt: upstreamAttempt });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  process.env.API_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.ADMIN_CLIENT_ID = 'console-admin';
  process.env.ADMIN_CLIENT_SECRET = 'console-secret';
  const consoleModule = require('../index');
  renderExamination = consoleModule.renderExamination;
  safeExamination = consoleModule.safeExamination;
  consoleServer = http.createServer(consoleModule.app);
  await new Promise((resolve) => consoleServer.listen(0, '127.0.0.1', resolve));
});

test.after(async () => {
  await Promise.all([consoleServer, gateway].filter(Boolean).map((server) =>
    new Promise((resolve) => server.close(resolve))));
});

test('read-only examination view renders governing identifiers, escapes content and omits restricted material', () => {
  const html = renderExamination(fixture());
  assert.match(html, /policy-hash/);
  assert.match(html, /item-1/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|RESTRICTED|<form|<button/);
});

test('Console projection allowlists nested identifiers and lifecycle evidence', () => {
  const projected = safeExamination(fixture('complete'));
  assert.deepEqual(projected.package, { id: 'pkg', version: '1', digest: 'digest' });
  assert.deepEqual(projected.rubric, { id: 'rubric', version: '1', digest: 'rubric-digest' });
  assert.deepEqual(projected.itemReferences[0].objectiveIds, ['o1']);
  assert.equal(projected.sequence, 17);
  assert.equal(projected.responsesReceived, 15);
  assert.equal(projected.responseCollectionComplete, true);
  assert.equal(projected.completedAt, '2026-10-12T07:05:00Z');
  assert.doesNotMatch(JSON.stringify(projected), /RESTRICTED|graderRationale|expectedAnswer/);
});

for (const status of ['in_progress', 'complete', 'agent_failed', 'system_aborted']) {
  test(`Console JSON and HTML retain the authoritative ${status} lifecycle state`, async () => {
    gatewayMode = 'ok';
    upstreamAttempt = fixture(status);
    requests.length = 0;
    const api = await request('/api/examinations/attempt-1');
    assert.equal(api.status, 200);
    assert.equal(api.body.attempt.status, status);
    assert.equal(api.body.attempt.responsesReceived, 15);
    assert.equal(api.body.attempt.responseCollectionComplete, true);
    assert.equal(api.body.attempt.sequence, 17);
    assert.equal(api.body.attempt.terminalReason, upstreamAttempt.terminalReason);
    assert.equal(api.body.attempt.completedAt, upstreamAttempt.completedAt);
    assert.equal(api.body.attempt.failedAt, upstreamAttempt.failedAt);
    assert.equal(api.body.attempt.abortedAt, upstreamAttempt.abortedAt);
    assert.doesNotMatch(JSON.stringify(api.body), /RESTRICTED|graderRationale|expectedAnswer/);
    const page = await request('/examinations/attempt-1');
    assert.equal(page.status, 200);
    assert.match(page.body, new RegExp(`<dd>${status}</dd>`));
    assert.match(page.body, /Responses received<\/dt><dd>15<\/dd>/);
    assert.match(page.body, /Response collection complete<\/dt><dd>true<\/dd>/);
    assert.doesNotMatch(page.body, /RESTRICTED|<form|<button/);
    assert.ok(requests.filter((req) => req.method === 'GET').every((req) =>
      req.path === '/v1/admin/examinations/attempt-1' && req.authorization === 'Bearer console-admin-token'));
  });
}

test('a fallback attempt leads with a FALLBACK banner and shows only fallback identifiers', () => {
  for (const cause of ['aborted-attempt-1', null]) {
    const html = renderExamination(fallbackFixture('complete', cause));
    const banner = html.indexOf('FALLBACK ATTEMPT');
    assert.ok(banner > -1 && banner < html.indexOf('<h1>') && banner < html.indexOf('<dl>'), 'banner precedes all content');
    assert.match(html, /evidence fallback\/simulation/);
    assert.match(html, /<dt>Mode<\/dt><dd>fallback<\/dd>/);
    assert.match(html, /<dt>Fallback bank<\/dt><dd>ai-safety-fallback 0\.1\.5-draft<\/dd>/);
    assert.match(html, /<dt>Scoring policy<\/dt><dd>fallback-scoring\/1\.0\.0 1\.0\.0 \(policy-digest\)<\/dd>/);
    assert.match(html, new RegExp(`<dt>Fallback reason</dt><dd>${cause ? 'standard_grading_unavailable' : 'standard_generation_unavailable'}</dd>`));
    assert.match(html, new RegExp(`<dt>Cause attempt</dt><dd>${cause || 'none'}</dd>`));
    assert.match(html, /<li>fallback-06 — applied — multiple_choice<\/li>/);
    assert.doesNotMatch(html, /undefined|null|Template|Generation policy|Training event|policy-hash|event-1/);
    assert.doesNotMatch(html, /RESTRICTED|<script>|<form|<button/);
  }
  // Standard attempts are unchanged and carry no banner.
  assert.doesNotMatch(renderExamination(fixture()), /FALLBACK/);
});

test('fallback Console projection allowlists fallback identifiers only', () => {
  const projected = safeExamination(fallbackFixture());
  assert.deepEqual(projected.bank, { id: 'ai-safety-fallback', version: '0.1.5-draft' });
  assert.deepEqual(projected.rubric, { id: 'fallback-scoring/1.0.0', version: '1.0.0', digest: 'policy-digest' });
  assert.deepEqual(projected.itemReferences, [{ id: 'fallback-06', tier: 'applied', answerType: 'multiple_choice', objectiveIds: ['o1'] }]);
  assert.deepEqual([projected.causeAttemptId, projected.reason], ['aborted-attempt-1', 'standard_grading_unavailable']);
  for (const field of ['template', 'generationPolicySha256', 'trainingEventId', 'vaSelectionId'])
    assert.equal(Object.hasOwn(projected, field), false, field);
  assert.doesNotMatch(JSON.stringify(projected), /RESTRICTED|expectedAnswer|choices/);
});

test('Console JSON and HTML for a fallback attempt keep the fallback label end to end', async () => {
  gatewayMode = 'ok';
  upstreamAttempt = fallbackFixture('agent_failed');
  const api = await request('/api/examinations/attempt-1');
  assert.deepEqual([api.status, api.body.attempt.mode, api.body.attempt.status], [200, 'fallback', 'agent_failed']);
  assert.doesNotMatch(JSON.stringify(api.body), /RESTRICTED|vaSelectionId|template/);
  const page = await request('/examinations/attempt-1');
  assert.equal(page.status, 200);
  assert.match(page.body, /FALLBACK ATTEMPT/);
  assert.doesNotMatch(page.body, /undefined|RESTRICTED/);
});

test('unavailable or unknown examination state is never presented as in_progress', async () => {
  upstreamAttempt = fixture();
  gatewayMode = 'unavailable';
  assert.deepEqual((await request('/api/examinations/attempt-1')).body,
    { apiVersion: 'v1', error: 'examination_unavailable' });
  assert.equal((await request('/examinations/attempt-1')).status, 503);
  gatewayMode = 'ok';
  upstreamAttempt.status = 'unknown';
  assert.equal((await request('/api/examinations/attempt-1')).status, 503);
  assert.equal((await request('/examinations/attempt-1')).status, 503);
});

test('missing examination remains not found in both read-only views', async () => {
  gatewayMode = 'missing';
  assert.deepEqual((await request('/api/examinations/attempt-1')).body,
    { apiVersion: 'v1', error: 'attempt_not_found' });
  assert.equal((await request('/examinations/attempt-1')).status, 404);
});

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: consoleServer.address().port, path }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode,
        body: res.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : raw }));
    });
    req.on('error', reject);
  });
}
