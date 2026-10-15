'use strict';

// Issue #21 end to end, in process: the real Training app (memory store) and
// the real Engine. A learner completes Training, fails the examination on the
// unsafe-tool scenario, the relay delivers the remediation event, Training
// assigns a targeted remediation session under the failure's correlation id,
// the learner completes it, and only then does a re-examination start, as a
// new attempt, with the original result unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp: createTraining } = require('../../training-service/index');
const { createMemoryStore: createTrainingStore } = require('../../training-service/store');
const { createFakePackageSource, createFakeRegistrySource } = require('../../training-service/sources');
const { GRADER, gradeItems } = require('../../grading-service/src/item-grader');
const { examAnswer } = require('../../synthetic-agent-learner/exam-scenarios');
const { createSources } = require('../sources');
const { createRemediationRelay } = require('../remediation-relay');
const { ACTOR, ADMIN, boot, fixture, grade, adminView } = require('./exam-harness');

const TRAINING_KEY = 'remediation-e2e-training-key';
const SYNTHETIC = { mode: 'synthetic', environment: 'simulation' };

async function startTraining(t) {
  const { pkg, registration } = fixture();
  const app = createTraining({ internalKey: TRAINING_KEY, store: createTrainingStore(),
    packageSource: createFakePackageSource([{ id: pkg.packageId, version: pkg.version, state: 'Active', digest: pkg.digest,
      payload: structuredClone(candidate) }]),
    registrySource: createFakeRegistrySource([{ ...registration, configurationVersion: 1 }]) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body) => fetch(`${url}${path}`, { method,
    headers: { 'x-internal-service-key': TRAINING_KEY, 'x-actor-subject': ACTOR,
      ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    .then(async (response) => ({ status: response.status, body: await response.json() }));
  return { url, call };
}

// Walks the learner's open Training session (standard or assigned remediation) to completion.
async function completeTraining(training, label) {
  const started = await training.call('POST', '/internal/sessions/start', { idempotencyKey: `${label}-start`, evidence: SYNTHETIC });
  assert.ok([200, 201].includes(started.status), `${label} start ${started.status} ${started.body.error}`);
  const { sessionId } = started.body;
  for (let step = 0; step < 50; step += 1) {
    const shown = await training.call('POST', `/internal/sessions/${sessionId}/continue`,
      { idempotencyKey: `${label}-c-${step}`, evidence: SYNTHETIC });
    if (shown.body.status === 'completed') return sessionId;
    const done = await training.call('POST', `/internal/sessions/${sessionId}/submit`, { idempotencyKey: `${label}-s-${step}`,
      evidence: SYNTHETIC, deliveryItemId: shown.body.item.deliveryItemId,
      response: 'I keep the tool call inside its authorized scope and escalate when unsure.' });
    assert.equal(done.status, 200, `${label} submit ${done.body.error}`);
    if (done.body.status === 'completed') return sessionId;
  }
  throw new Error(`${label} did not complete`);
}

async function sitExam(ctx, key, scenarioId) {
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: key });
  if (started.status !== 201) return started;
  let attempt = started.body.attempt;
  const { form } = attempt;
  for (const [index, item] of form.items.entries()) {
    attempt = (await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, { idempotencyKey: `${key}-${index}`,
      expectedSequence: attempt.sequence, itemId: item.id, response: examAnswer(scenarioId, item, index) })).body.attempt;
  }
  return { status: 201, attempt: (await grade(ctx, attempt)).body.attempt, form };
}

test('failure, remediation and re-examination form one correlated narrative across Engine and Training', async (t) => {
  const training = await startTraining(t);
  const standardSession = await completeTraining(training, 'standard');
  const completion = createSources({ trainingUrl: training.url, trainingKey: TRAINING_KEY, curriculumKey: 'unused' }).completion;
  const realGrader = async ({ rubric, items }) => ({ ok: true, body: { grader: GRADER, results: gradeItems({ rubric, items }) } });
  const ctx = await boot(t, { grader: realGrader, sources: { completion } });

  const failed = await sitExam(ctx, 'first', 'unsafe-tool');
  assert.equal(failed.attempt.status, 'agent_failed');
  const original = await adminView(ctx, failed.attempt);
  assert.equal(original.trainingEventId, `training.session.completed:${standardSession}`);
  const { event } = await ctx.store.findRemediation(failed.attempt.attemptId);

  const early = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'too-early' });
  assert.deepEqual([early.status, early.body.error], [409, 'remediation_required']);

  const relay = createRemediationRelay({ store: ctx.store, url: training.url, key: TRAINING_KEY, clock: ctx.clock });
  assert.deepEqual(await relay.sweep(), { delivered: 1, refused: 0, retrying: 0 });
  assert.deepEqual(await relay.sweep(), { delivered: 0, refused: 0, retrying: 0 }, 'a delivered event is never resent');
  const { delivery } = await ctx.store.findRemediation(failed.attempt.attemptId);
  const { session } = (await training.call('GET', `/internal/sessions/${delivery.trainingSessionId}`)).body;
  assert.equal(session.kind, 'remediation');
  assert.equal(session.remediation.requestId, event.eventId);
  assert.deepEqual(session.remediation.objectiveIds, event.gap.objectiveIds);
  assert.equal(session.correlationId, event.correlationId, 'Training keeps the failure correlation id');

  assert.equal(await completeTraining(training, 'remediation'), delivery.trainingSessionId);
  const retake = await sitExam(ctx, 'retake', 'safe-escalation');
  assert.equal(retake.status, 201);
  assert.equal(retake.attempt.status, 'complete');
  assert.notEqual(retake.attempt.attemptId, failed.attempt.attemptId);
  assert.deepEqual(await adminView(ctx, failed.attempt), original, 'remediation never changes the original result');

  const trace = (await ctx.call('GET', `/internal/admin/attempts/${failed.attempt.attemptId}/remediation`, undefined, ADMIN)).body.trace;
  assert.equal(trace.correlationId, event.correlationId);
  assert.equal(trace.remediation.delivery.trainingSessionId, delivery.trainingSessionId);
  assert.deepEqual(trace.reexaminations.map((value) => [value.attemptId, value.status, value.trainingSessionId, value.passed]),
    [[retake.attempt.attemptId, 'complete', delivery.trainingSessionId, true]]);
});
