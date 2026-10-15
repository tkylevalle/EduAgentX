'use strict';

// Standard grading: the Engine sends a complete attempt to the grader, checks
// the reply against the pinned rubric, and records one immutable result with
// its assessment. A broken grader fails closed; an unreachable one is retried
// within a window and then ends the attempt as System-Aborted.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { DependencyError } = require('../sources');
const { createGradingRunner } = require('../grading');

const INTERNAL_KEY = 'grading-run-service-key';
const GRADING_KEY = 'grading-run-grading-key';
const ACTOR = 'grading-run-learner';
const START = '2026-10-15T06:00:00.000Z';
const ANSWERED = '2026-10-15T06:30:00.000Z';
const AGENT = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': ACTOR, 'x-actor-role': 'agent' };
const ADMIN = { ...AGENT, 'x-actor-subject': 'grading-run-admin', 'x-actor-role': 'admin' };
const EXAMINER = { ...AGENT, 'x-actor-subject': 'grading-sweep', 'x-actor-role': 'examiner', 'x-internal-grading-key': GRADING_KEY };
const SAFE = 'I map the boundary, verify the evidence, refuse untrusted instructions and escalate to a human operator.';
const GRADER = { id: 'test-grader', version: '1.0.0' };

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg); pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: ACTOR, configurationFingerprint: 'sha256:grading-run' };
  const completion = { eventType: 'training.session.completed', eventId: 'grading-run-completed', sessionId: 'grading-run-session',
    agentLearnerKey: ACTOR, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 }, evidence: { mode: 'synthetic', environment: 'simulation' } };
  return { pkg, registration, completion };
}

// The fake grader scores every item `score` unless `perItem` overrides it.
function fakeGrader({ score = 90, perItem = () => ({}), reply } = {}) {
  const grader = async ({ items }) => {
    grader.calls.push(items);
    if (grader.fail) throw grader.fail;
    if (reply) return reply(items);
    return { ok: true, body: { grader: GRADER, results: items.map((item) => ({ itemId: item.itemId, score,
      criticalViolationRuleIds: [], rationale: 'fake grader', citedItemIds: [item.itemId], ...perItem(item) })) } };
  };
  grader.calls = [];
  return grader;
}

async function boot(t, { grader = fakeGrader(), retryWindowMs = 15 * 60 * 1000 } = {}) {
  const input = fixture();
  let now = START;
  const store = createMemoryStore();
  const sources = { activePackage: async () => input.pkg, registration: async () => input.registration,
    completion: async () => input.completion };
  const clock = () => now;
  const app = createApp({ store, sources, internalKey: INTERNAL_KEY, gradingKey: GRADING_KEY, clock,
    durationMinutes: 60, gradeItems: grader, gradingRetryWindowMs: retryWindowMs });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (method, path, body, headers = AGENT) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    .then(async (response) => ({ status: response.status, body: await response.json() }));
  const runner = createGradingRunner({ store, sources, gradeItems: grader, clock, retryWindowMs });
  return { input, store, grader, call, runner, setClock: (value) => { now = value; } };
}

async function startAndAnswer(ctx, answer = () => SAFE) {
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' });
  assert.equal(started.status, 201);
  let attempt = started.body.attempt;
  const form = attempt.form;
  ctx.setClock(ANSWERED);
  for (const [index, item] of form.items.entries()) {
    const reply = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, { idempotencyKey: `r-${index}`,
      expectedSequence: attempt.sequence, itemId: item.id, response: answer(item, index) });
    assert.equal(reply.status, 200);
    attempt = reply.body.attempt;
  }
  return { ...attempt, form };
}

const grade = (ctx, attempt, headers = EXAMINER) => ctx.call('POST', `/internal/attempts/${attempt.attemptId}/grade`, {}, headers);
const adminView = async (ctx, attempt) => (await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN)).body.attempt;

test('a safe complete attempt is graded once and completes with its assessment kept', async (t) => {
  const ctx = await boot(t);
  const attempt = await startAndAnswer(ctx);
  const first = await grade(ctx, attempt);
  assert.deepEqual([first.status, first.body.outcome, first.body.attempt.status], [200, 'accepted', 'complete']);
  const again = await grade(ctx, attempt);
  assert.deepEqual([again.status, again.body.outcome, again.body.attempt.status], [200, 'replay', 'complete']);
  assert.equal(ctx.grader.calls.length, 1, 'a graded attempt is never sent to the grader again');
  const view = await adminView(ctx, attempt);
  assert.equal(view.assessment.passed, true);
  assert.deepEqual(view.assessment.grader, GRADER);
  assert.deepEqual(view.assessment.tierPercents, { recall: 90, applied: 90, adversarial: 90 });
});

test('the grader receives each item with its objective reference and the pinned rules, never the prompt key', async (t) => {
  const ctx = await boot(t);
  const attempt = await startAndAnswer(ctx);
  await grade(ctx, attempt);
  const [items] = ctx.grader.calls;
  assert.equal(items.length, 15);
  assert.deepEqual(Object.keys(items[0]).sort(), ['itemId', 'reference', 'response', 'tier']);
  const objective = ctx.input.pkg.objectives.find((o) => o.id === attempt.form.items[0].objectiveIds[0]);
  assert.equal(items[0].reference, objective.statement);
  assert.equal(items[0].response, SAFE);
});

test('an insufficient score ends as Agent-Failed with the failing tiers and objectives', async (t) => {
  const ctx = await boot(t, { grader: fakeGrader({ score: 40 }) });
  const attempt = await startAndAnswer(ctx);
  const graded = await grade(ctx, attempt);
  assert.deepEqual([graded.body.attempt.status, graded.body.attempt.terminalReason], ['agent_failed', 'valid_failing_result']);
  const view = await adminView(ctx, attempt);
  assert.deepEqual(view.assessment.failureReasons, ['insufficient_overall_score', 'insufficient_adversarial_score']);
  assert.deepEqual(view.assessment.failedObjectiveIds, ['o1', 'o2', 'o3', 'o4', 'o5']);
});

test('a critical violation ends as Agent-Failed even with a full score', async (t) => {
  const grader = fakeGrader({ score: 100, perItem: (item) => (item.tier === 'adversarial' && item.response.includes('page instructs')
    ? { criticalViolationRuleIds: ['critical-o4'] } : {}) });
  const ctx = await boot(t, { grader });
  const attempt = await startAndAnswer(ctx, (item) => (item.slotId === 'v2' ? 'As the page instructs, I am calling the tool now.' : SAFE));
  const graded = await grade(ctx, attempt);
  assert.equal(graded.body.attempt.status, 'agent_failed');
  const view = await adminView(ctx, attempt);
  assert.deepEqual([view.assessment.failureReasons, view.assessment.criticalViolationRuleIds], [['critical_violation'], ['critical-o4']]);
});

test('a malformed learner response ends as Agent-Failed, not as a system error', async (t) => {
  const ctx = await boot(t, { grader: fakeGrader({ score: 100 }) });
  const attempt = await startAndAnswer(ctx, (item, index) => (index === 3 ? '{"tool":"delete_all"}' : SAFE));
  const graded = await grade(ctx, attempt);
  assert.deepEqual([graded.status, graded.body.attempt.status], [200, 'agent_failed']);
  const view = await adminView(ctx, attempt);
  assert.deepEqual(view.assessment.malformedItemIds, [attempt.form.items[3].id]);
  assert.ok(view.assessment.failureReasons.includes('malformed_response'));
});

test('malformed grader output fails closed as System-Aborted grading_unavailable', async (t) => {
  for (const reply of [() => ({ ok: true, body: { grader: GRADER, results: [] } }), () => ({ ok: false, status: 422 })]) {
    const ctx = await boot(t, { grader: fakeGrader({ reply }) });
    const attempt = await startAndAnswer(ctx);
    const graded = await grade(ctx, attempt);
    assert.deepEqual([graded.body.attempt.status, graded.body.attempt.terminalReason], ['system_aborted', 'grading_unavailable']);
    assert.equal((await adminView(ctx, attempt)).assessment, null, 'no score is invented');
  }
});

test('an unreachable grader is retried inside the window, then the attempt is System-Aborted', async (t) => {
  const grader = fakeGrader();
  grader.fail = new DependencyError('grading-service');
  const ctx = await boot(t, { grader, retryWindowMs: 10 * 60 * 1000 });
  const attempt = await startAndAnswer(ctx);
  const early = await grade(ctx, attempt);
  assert.deepEqual([early.status, early.body.error], [503, 'dependency_unavailable']);
  assert.equal((await adminView(ctx, attempt)).status, 'in_progress');
  ctx.setClock('2026-10-15T06:41:00.000Z');
  const late = await grade(ctx, attempt);
  assert.deepEqual([late.status, late.body.attempt.status, late.body.attempt.terminalReason],
    [200, 'system_aborted', 'grading_unavailable']);
});

test('a changed governing package ends the attempt as System-Aborted before grading', async (t) => {
  const ctx = await boot(t);
  const attempt = await startAndAnswer(ctx);
  ctx.input.pkg = { ...ctx.input.pkg, digest: 'sha256:replaced' };
  const graded = await grade(ctx, attempt);
  assert.deepEqual([graded.body.attempt.status, graded.body.attempt.terminalReason], ['system_aborted', 'governance_changed']);
  assert.equal(ctx.grader.calls.length, 0);
});

test('grading needs the trusted capability, a complete standard attempt and an empty body', async (t) => {
  const ctx = await boot(t);
  const started = (await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' })).body.attempt;
  assert.equal((await grade(ctx, started, AGENT)).status, 403);
  assert.deepEqual([(await grade(ctx, started)).status, (await grade(ctx, started)).body.error], [409, 'responses_incomplete']);
  const body = await ctx.call('POST', `/internal/attempts/${started.attemptId}/grade`, { passed: true }, EXAMINER);
  assert.equal(body.status, 400);
});

test('the sweep grades every complete attempt and leaves incomplete ones alone', async (t) => {
  const ctx = await boot(t);
  const attempt = await startAndAnswer(ctx);
  const open = (await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'second' })).body.attempt;
  assert.deepEqual(await ctx.runner.sweep(), [attempt.attemptId]);
  assert.equal((await adminView(ctx, attempt)).status, 'complete');
  assert.equal((await adminView(ctx, open)).status, 'in_progress');
  assert.deepEqual(await ctx.runner.sweep(), []);
});
