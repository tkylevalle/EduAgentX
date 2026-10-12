'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp: createExamination } = require('../../examination-engine');
const { createMemoryStore } = require('../../examination-engine/store');

process.env.JWT_ISSUER = 'eduagentx-api-gateway-exam-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-exam-test';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'exam-agent';
process.env.AGENT_CLIENT_SECRET = 'exam-agent-secret';
process.env.ADMIN_CLIENT_ID = 'exam-admin';
process.env.ADMIN_CLIENT_SECRET = 'exam-admin-secret';
delete process.env.EXAMINATION_INTERNAL_KEY;

const { createApp: createGateway } = require('../index');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}
function request(server, method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { ...headers, ...(payload ? { 'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject); req.end(payload);
  });
}
async function token(gateway, clientId, clientSecret) {
  const result = await request(gateway, 'POST', '/v1/auth/tokens', { clientId, clientSecret });
  assert.equal(result.status, 200);
  return result.body.accessToken;
}

async function boot(t) {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId;
  pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg); pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: 'exam-agent', configurationFingerprint: 'sha256:test-config' };
  const completion = { eventType: 'training.session.completed', eventId: 'training.session.completed:one',
    sessionId: 'one', agentLearnerKey: registration.agentLearnerKey,
    configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  const store = createMemoryStore();
  const examination = await listen(http.createServer(createExamination({ internalKey: 'exam-key', gradingKey: 'grading-test-key',
    store, sources: { activePackage: async () => pkg,
      registration: async () => registration, completion: async () => completion } })));
  t.after(() => new Promise((resolve) => examination.close(resolve)));
  const gateway = await listen(http.createServer(createGateway({
    examinationEngineUrl: `http://127.0.0.1:${examination.address().port}`,
    examinationInternalKey: 'exam-key',
  })));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const agent = await token(gateway, 'exam-agent', 'exam-agent-secret');
  const admin = await token(gateway, 'exam-admin', 'exam-admin-secret');
  return { pkg, store, examination, gateway, agent, admin,
    agentHeaders: { authorization: `Bearer ${agent}` }, adminHeaders: { authorization: `Bearer ${admin}` } };
}

test('Gateway delivers admitted exam only to its Agent Learner and an identifier-only admin view', async (t) => {
  const { pkg, gateway, agent, admin } = await boot(t);

  assert.equal((await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'one' })).status, 401);
  assert.equal((await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'one' },
    { authorization: `Bearer ${admin}` })).status, 403);
  assert.equal((await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'one', packageId: pkg.packageId },
    { authorization: `Bearer ${agent}` })).status, 400);
  const started = await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'one' },
    { authorization: `Bearer ${agent}` });
  assert.equal(started.status, 201);
  assert.equal(started.body.attempt.form.items.length, 15);
  const id = started.body.attempt.attemptId;
  const read = await request(gateway, 'GET', `/v1/examinations/${id}`, undefined,
    { authorization: `Bearer ${agent}` });
  assert.deepEqual(read.body.attempt.form, started.body.attempt.form);
  assert.equal((await request(gateway, 'GET', `/v1/admin/examinations/${id}`, undefined,
    { authorization: `Bearer ${agent}` })).status, 403);
  const console = await request(gateway, 'GET', `/v1/admin/examinations/${id}`, undefined,
    { authorization: `Bearer ${admin}` });
  assert.equal(console.status, 200);
  assert.equal(console.body.attempt.itemReferences.length, 15);
  assert.equal(Object.hasOwn(console.body.attempt.itemReferences[0], 'prompt'), false);
});

test('Gateway validates examination responses and keeps finalization unavailable publicly', async (t) => {
  const { gateway, agentHeaders, adminHeaders } = await boot(t);
  const started = await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'response-boundary' }, agentHeaders);
  const id = started.body.attempt.attemptId;
  const route = `/v1/examinations/${id}/responses`;
  const body = { idempotencyKey: 'answer-one', expectedSequence: 1,
    itemId: started.body.attempt.form.items[0].id, response: 'restricted learner answer' };
  assert.equal((await request(gateway, 'POST', route, body)).status, 401);
  assert.equal((await request(gateway, 'POST', route, body, adminHeaders)).status, 403);
  for (const invalid of [null, [], {}, { ...body, agentLearnerKey: 'another-agent' },
    { ...body, idempotencyKey: 42 }, { ...body, expectedSequence: 0 }, { ...body, expectedSequence: 1.5 },
    { ...body, itemId: '' }, { ...body, response: '' }, { ...body, response: '   ' },
    { ...body, response: 'x'.repeat(16001) }, { ...body, response: { value: 'secret' } }]) {
    assert.equal((await request(gateway, 'POST', route, invalid, agentHeaders)).status, 400);
  }
  for (const suffix of ['finalize', 'grade', 'abort']) {
    assert.equal((await request(gateway, 'POST', `/v1/examinations/${id}/${suffix}`, body, adminHeaders)).status, 404);
  }
  const read = await request(gateway, 'GET', `/v1/examinations/${id}`, undefined, agentHeaders);
  assert.equal(read.body.attempt.status, 'in_progress');
  assert.deepEqual(read.body.attempt.form, started.body.attempt.form);
});

test('Gateway response retries use Examination authority and accepted answers stay restricted', async (t) => {
  const { gateway, agentHeaders, adminHeaders } = await boot(t);
  const started = await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'response-replay' }, agentHeaders);
  const id = started.body.attempt.attemptId;
  const route = `/v1/examinations/${id}/responses`;
  const body = { idempotencyKey: 'answer-one', expectedSequence: started.body.attempt.sequence,
    itemId: started.body.attempt.form.items[0].id, response: 'restricted accepted learner answer' };
  const submitted = await request(gateway, 'POST', route, body, {
    ...agentHeaders, 'x-actor-subject': 'forged-identity', 'x-actor-role': 'admin',
    'x-internal-service-key': 'forged-service-key',
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.attempt.responsesReceived, 1);
  const replay = await request(gateway, 'POST', route, body, agentHeaders);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.attempt.sequence, submitted.body.attempt.sequence);
  const conflict = await request(gateway, 'POST', route, { ...body, response: 'a changed answer' }, agentHeaders);
  assert.equal(conflict.status, 409);
  const finalAnswerConflict = await request(gateway, 'POST', route, {
    ...body, idempotencyKey: 'answer-two', expectedSequence: submitted.body.attempt.sequence,
    response: 'an attempted answer replacement',
  }, agentHeaders);
  assert.equal(finalAnswerConflict.status, 409);
  const learner = await request(gateway, 'GET', `/v1/examinations/${id}`, undefined, agentHeaders);
  const admin = await request(gateway, 'GET', `/v1/admin/examinations/${id}`, undefined, adminHeaders);
  assert.deepEqual([learner.body.attempt.status, learner.body.attempt.sequence, learner.body.attempt.responsesReceived],
    [admin.body.attempt.status, admin.body.attempt.sequence, admin.body.attempt.responsesReceived]);
  assert.deepEqual(learner.body.attempt.form, started.body.attempt.form);
  for (const result of [submitted, replay, conflict, finalAnswerConflict, learner, admin]) {
    assert.equal(JSON.stringify(result.body).includes(body.response), false);
    assert.equal(JSON.stringify(result.body).includes('an attempted answer replacement'), false);
  }
});

test('Gateway learner and admin reads agree after trusted finalization of complete responses', async (t) => {
  const { gateway, examination, store, agentHeaders, adminHeaders } = await boot(t);
  const started = await request(gateway, 'POST', '/v1/examinations', { idempotencyKey: 'terminal-projection' }, agentHeaders);
  const id = started.body.attempt.attemptId;
  let attempt = started.body.attempt;
  for (const [index, item] of attempt.form.items.entries()) {
    const submitted = await request(gateway, 'POST', `/v1/examinations/${id}/responses`, {
      idempotencyKey: `item-${index}`, expectedSequence: attempt.sequence, itemId: item.id,
      response: `restricted response ${index}`,
    }, agentHeaders);
    assert.equal(submitted.status, 200);
    attempt = submitted.body.attempt;
  }
  assert.equal(attempt.status, 'in_progress');
  assert.equal(attempt.responseCollectionComplete, true);
  const persisted = await store.get(id);
  const finalized = await request(examination, 'POST', `/internal/attempts/${id}/finalize`, {
    idempotencyKey: 'trusted-final-result', expectedSequence: attempt.sequence,
    eventId: `result:${id}`, formDigest: persisted.formDigest,
    rubricDigest: persisted.form.rubric.digest, responseSetDigest: persisted.responseSetDigest,
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true },
  }, { 'x-internal-service-key': 'exam-key', 'x-internal-grading-key': 'grading-test-key',
    'x-actor-subject': 'trusted-grader', 'x-actor-role': 'examiner' });
  assert.equal(finalized.status, 200);
  const learner = await request(gateway, 'GET', `/v1/examinations/${id}`, undefined, agentHeaders);
  const admin = await request(gateway, 'GET', `/v1/admin/examinations/${id}`, undefined, adminHeaders);
  for (const result of [finalized, learner, admin]) {
    assert.equal(result.body.attempt.status, 'complete');
    assert.equal(result.body.attempt.responsesReceived, 15);
    assert.equal(result.body.attempt.responseCollectionComplete, true);
    assert.ok(result.body.attempt.completedAt);
    assert.equal(JSON.stringify(result.body).includes('restricted response'), false);
  }
  assert.deepEqual([learner.body.attempt.sequence, learner.body.attempt.completedAt],
    [admin.body.attempt.sequence, admin.body.attempt.completedAt]);
  assert.equal(learner.body.attempt.form, undefined);
  assert.equal((await store.get(id)).formDigest, persisted.formDigest);
});
