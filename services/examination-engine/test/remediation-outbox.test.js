'use strict';

// Issue #21: a valid Agent-Failed attempt commits one remediation event with
// its terminal event. A re-examination needs a Training remediation session
// for that exact event and always starts as a new attempt; the original
// attempt never changes. The admin trace joins failure, gap, remediation and
// re-examination under the failure's correlation id.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN, AGENT, ACTOR, SAFE, fakeGrader, boot, startAndAnswer, grade, adminView } = require('./exam-harness');

// Flags the first adversarial item of the form with one critical rule.
function violating() {
  let flagged = null;
  return fakeGrader({ perItem: (item) => {
    if (item.tier === 'adversarial' && flagged === null) flagged = item.itemId;
    return item.itemId === flagged ? { criticalViolationRuleIds: ['critical-o4'] } : {};
  } });
}
const trace = (ctx, attemptId, headers = ADMIN) =>
  ctx.call('GET', `/internal/admin/attempts/${attemptId}/remediation`, undefined, headers);

async function failedAttempt(t, options = {}) {
  const ctx = await boot(t, { grader: violating(), ...options });
  const attempt = await startAndAnswer(ctx);
  const graded = await grade(ctx, attempt);
  assert.equal(graded.body.attempt.status, 'agent_failed');
  return { ctx, attempt };
}

function remediationCompletion(ctx, eventId) {
  return { ...ctx.input.completion, eventId: 'training.session.completed:remediation-1', sessionId: 'remediation-1',
    sessionKind: 'remediation', remediationRequestId: eventId };
}

test('a critical violation commits one remediation event with the exact gap', async (t) => {
  const { ctx, attempt } = await failedAttempt(t);
  await grade(ctx, attempt);
  const pending = await ctx.store.listPendingRemediations(10);
  assert.equal(pending.length, 1, 'a replayed grade never adds a second event');
  const [event] = pending;
  const view = await adminView(ctx, attempt);
  assert.equal(event.eventId, `examination.remediation.required:${attempt.attemptId}`);
  assert.deepEqual(event.gap, { objectiveIds: view.assessment.failedObjectiveIds, criticalViolationRuleIds: ['critical-o4'] });
  assert.ok(event.gap.objectiveIds.includes('o4'));
  assert.deepEqual(event.failure.failureReasons, ['critical_violation']);
  assert.equal(event.failure.terminalEventId, `grade:${attempt.attemptId}:terminal`);
  assert.deepEqual(event.evidence, { mode: 'synthetic', environment: 'simulation' });
  assert.deepEqual(await ctx.store.findRemediation(attempt.attemptId), { event, delivery: null });
});

test('a pass and a System-Aborted attempt commit no remediation event', async (t) => {
  const passing = await boot(t);
  const passed = await startAndAnswer(passing);
  assert.equal((await grade(passing, passed)).body.attempt.status, 'complete');
  const broken = await boot(t, { grader: fakeGrader({ reply: () => ({ ok: true, body: { grader: {}, results: [] } }) }) });
  const aborted = await startAndAnswer(broken);
  assert.equal((await grade(broken, aborted)).body.attempt.status, 'system_aborted');
  for (const [ctx, attempt] of [[passing, passed], [broken, aborted]]) {
    assert.deepEqual(await ctx.store.listPendingRemediations(10), []);
    assert.deepEqual(await ctx.store.findRemediation(attempt.attemptId), { event: null, delivery: null });
  }
});

test('a learner timeout commits an event naming the objectives of the unanswered items', async (t) => {
  const ctx = await boot(t);
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'timeout' });
  const { attemptId, form } = started.body.attempt;
  await ctx.call('POST', `/internal/attempts/${attemptId}/responses`, { idempotencyKey: 'r-0',
    expectedSequence: 1, itemId: form.items[0].id, response: SAFE });
  await ctx.store.sweepExpired('2026-10-15T08:00:00.000Z');
  const { event } = await ctx.store.findRemediation(attemptId);
  assert.deepEqual(event.failure.failureReasons, ['response_deadline_elapsed']);
  const unanswered = new Set(form.items.slice(1).flatMap((item) => item.objectiveIds));
  assert.deepEqual(new Set(event.gap.objectiveIds), unanswered);
  assert.equal(event.failure.terminalEventId, `timeout:${attemptId}`);
});

test('a delivery is recorded once and leaves the outbox', async (t) => {
  const { ctx, attempt } = await failedAttempt(t);
  const [event] = await ctx.store.listPendingRemediations(10);
  const first = await ctx.store.recordRemediationDelivery({ eventId: event.eventId, outcome: 'delivered',
    trainingSessionId: 'remediation-1', detail: { status: 201 }, recordedAt: '2026-10-15T07:00:00.000Z' });
  const second = await ctx.store.recordRemediationDelivery({ eventId: event.eventId, outcome: 'refused',
    trainingSessionId: null, detail: { status: 422 }, recordedAt: '2026-10-15T07:01:00.000Z' });
  assert.deepEqual(second, first, 'the first recorded outcome is final');
  assert.equal(first.outcome, 'delivered');
  assert.deepEqual(await ctx.store.listPendingRemediations(10), []);
  assert.deepEqual((await ctx.store.findRemediation(attempt.attemptId)).delivery, first);
  await assert.rejects(ctx.store.recordRemediationDelivery({ eventId: 'unknown', outcome: 'delivered',
    trainingSessionId: 's', detail: {}, recordedAt: '2026-10-15T07:00:00.000Z' }), { code: 'remediation_not_found' });
});

test('re-examination needs the remediation session for the exact event and starts a new attempt', async (t) => {
  const { ctx, attempt } = await failedAttempt(t);
  const before = await adminView(ctx, attempt);
  const { event } = await ctx.store.findRemediation(attempt.attemptId);
  const again = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'retake-1' });
  assert.deepEqual([again.status, again.body.error], [409, 'remediation_required']);
  ctx.input.completion = remediationCompletion(ctx, 'examination.remediation.required:some-other-attempt');
  assert.equal((await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'retake-2' })).body.error, 'remediation_required');
  ctx.input.completion = remediationCompletion(ctx, event.eventId);
  const retake = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'retake-3' });
  assert.equal(retake.status, 201);
  assert.notEqual(retake.body.attempt.attemptId, attempt.attemptId);
  assert.deepEqual(await ctx.store.findReexaminations(event.eventId), [retake.body.attempt.attemptId]);
  assert.deepEqual(await adminView(ctx, attempt), before, 'the original result never changes');
  const replay = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' });
  assert.deepEqual([replay.status, replay.body.attempt.attemptId], [200, attempt.attemptId], 'a replay is never gated');
});

test('the admin trace joins failure, gap, remediation and re-examination', async (t) => {
  const { ctx, attempt } = await failedAttempt(t);
  const { event } = await ctx.store.findRemediation(attempt.attemptId);
  await ctx.store.recordRemediationDelivery({ eventId: event.eventId, outcome: 'delivered',
    trainingSessionId: 'remediation-1', detail: { status: 201 }, recordedAt: '2026-10-15T07:00:00.000Z' });
  ctx.input.completion = remediationCompletion(ctx, event.eventId);
  const retake = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'retake' });
  const reply = await trace(ctx, attempt.attemptId);
  assert.equal(reply.status, 200);
  const body = reply.body.trace;
  assert.equal(body.failure.attemptId, attempt.attemptId);
  assert.equal(body.failure.status, 'agent_failed');
  assert.equal(body.correlationId, event.correlationId);
  assert.deepEqual(body.gap, event.gap);
  assert.deepEqual(body.remediation.event, event);
  assert.deepEqual([body.remediation.delivery.outcome, body.remediation.delivery.trainingSessionId], ['delivered', 'remediation-1']);
  assert.deepEqual(body.reexaminations.map((value) => [value.attemptId, value.status, value.trainingSessionId]),
    [[retake.body.attempt.attemptId, 'in_progress', 'remediation-1']]);
  assert.equal(JSON.stringify(body).includes(SAFE), false, 'the trace never carries a learner response');
  assert.equal((await trace(ctx, attempt.attemptId, { ...AGENT, 'x-actor-subject': ACTOR })).status, 403);
  assert.equal((await trace(ctx, '00000000-0000-4000-8000-000000000000')).status, 404);
});

test('the trace of an attempt with no remediation says so', async (t) => {
  const ctx = await boot(t);
  const attempt = await startAndAnswer(ctx);
  await grade(ctx, attempt);
  const body = (await trace(ctx, attempt.attemptId)).body.trace;
  assert.deepEqual([body.failure.status, body.gap, body.remediation, body.reexaminations], ['complete', null, null, []]);
});

test('a new attempt waits while an earlier one has no outcome, so the gate cannot be raced', async (t) => {
  const ctx = await boot(t, { grader: violating() });
  const answered = await startAndAnswer(ctx);
  const raced = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'before-grading' });
  assert.deepEqual([raced.status, raced.body.error], [409, 'previous_attempt_awaiting_outcome']);
  await grade(ctx, answered);
  const gated = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'after-grading' });
  assert.equal(gated.body.error, 'remediation_required', 'after grading the remediation gate applies');
});

test('an expired attempt that the sweep has not ended yet also holds a new attempt', async (t) => {
  const ctx = await boot(t);
  const first = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'first' });
  assert.equal(first.status, 201);
  const open = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'second' });
  assert.equal(open.status, 201, 'an unexpired attempt that is still being answered does not hold a new one');
  ctx.setClock('2026-10-15T08:00:00.000Z');
  const expired = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'third' });
  assert.deepEqual([expired.status, expired.body.error], [409, 'previous_attempt_awaiting_outcome']);
});
