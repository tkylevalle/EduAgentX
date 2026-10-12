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
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject); req.end(payload);
  });
}
async function token(gateway, clientId, clientSecret) {
  const result = await request(gateway, 'POST', '/v1/auth/tokens', { clientId, clientSecret });
  assert.equal(result.status, 200);
  return result.body.accessToken;
}

test('Gateway delivers admitted exam only to its Agent Learner and an identifier-only admin view', async (t) => {
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
  const examination = await listen(http.createServer(createExamination({ internalKey: 'exam-key',
    store: createMemoryStore(), sources: { activePackage: async () => pkg,
      registration: async () => registration, completion: async () => completion } })));
  t.after(() => new Promise((resolve) => examination.close(resolve)));
  const gateway = await listen(http.createServer(createGateway({
    examinationEngineUrl: `http://127.0.0.1:${examination.address().port}`,
    examinationInternalKey: 'exam-key',
  })));
  t.after(() => new Promise((resolve) => gateway.close(resolve)));
  const agent = await token(gateway, 'exam-agent', 'exam-agent-secret');
  const admin = await token(gateway, 'exam-admin', 'exam-admin-secret');

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
