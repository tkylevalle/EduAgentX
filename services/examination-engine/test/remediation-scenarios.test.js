'use strict';

// Issue #21: the seeded adversarial scenarios run through the real Engine
// lifecycle and the real deterministic item grader. Each unsafe behaviour is
// observed as Agent-Failed with its named critical rule and a remediation
// event; the safe escalation passes with none; a malformed, low-effort or
// timed-out learner also ends as Agent-Failed with a remediation event.

const test = require('node:test');
const assert = require('node:assert/strict');
const { GRADER, gradeItems, validateItemGradingRequest } = require('../../grading-service/src/item-grader');
const { EXAM_SCENARIOS, EXAM_FAILURE_PROFILES, examAnswer } = require('../../synthetic-agent-learner/exam-scenarios');
const { boot, grade, adminView } = require('./exam-harness');

// The grading-service route's behaviour, in process: validate, then grade.
async function realGrader({ rubric, items }) {
  if (validateItemGradingRequest({ rubric, items }).length) return { ok: false, status: 422 };
  return { ok: true, body: { grader: GRADER, results: gradeItems({ rubric, items }) } };
}

async function sit(t, scenarioId) {
  const ctx = await boot(t, { grader: realGrader });
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: `exam-${scenarioId}` });
  assert.equal(started.status, 201);
  let attempt = started.body.attempt;
  const { form } = attempt;
  ctx.setClock('2026-10-15T06:30:00.000Z');
  for (const [index, item] of form.items.entries()) {
    const response = examAnswer(scenarioId, item, index);
    if (response === null) continue;
    const reply = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`,
      { idempotencyKey: `r-${index}`, expectedSequence: attempt.sequence, itemId: item.id, response });
    assert.equal(reply.status, 200, `${scenarioId} item ${item.slotId}`);
    attempt = reply.body.attempt;
  }
  if (attempt.responseCollectionComplete) await grade(ctx, attempt);
  else await ctx.store.sweepExpired('2026-10-15T08:00:00.000Z');
  return { ctx, attempt, form, view: await adminView(ctx, attempt), remediation: await ctx.store.findRemediation(attempt.attemptId) };
}

for (const [scenarioId, scenario] of Object.entries(EXAM_SCENARIOS)) {
  test(`scenario ${scenarioId} is observed as ${scenario.expected.status}`, async (t) => {
    const { view, form, remediation } = await sit(t, scenarioId);
    assert.equal(view.status, scenario.expected.status);
    assert.deepEqual(view.assessment.criticalViolationRuleIds, scenario.expected.criticalViolationRuleIds);
    const target = form.items.find((item) => item.slotId === scenario.slotId);
    const outcome = view.assessment.itemOutcomes.find((item) => item.itemId === target.id);
    assert.deepEqual(outcome.criticalViolationRuleIds, scenario.expected.criticalViolationRuleIds,
      'the violation is attributed to the scenario slot');
    if (scenario.expected.status === 'complete') {
      assert.equal(remediation.event, null);
      return;
    }
    assert.ok(view.assessment.failureReasons.includes('critical_violation'));
    assert.deepEqual(remediation.event.gap.criticalViolationRuleIds, scenario.expected.criticalViolationRuleIds);
    for (const objectiveId of target.objectiveIds) assert.ok(remediation.event.gap.objectiveIds.includes(objectiveId));
  });
}

test('a malformed learner is Agent-Failed for malformed_response and gets a remediation event', async (t) => {
  const { view, remediation } = await sit(t, 'malformed-output');
  assert.equal(view.status, 'agent_failed');
  assert.ok(view.assessment.failureReasons.includes(EXAM_FAILURE_PROFILES['malformed-output'].expected));
  assert.deepEqual(remediation.event.failure.failureReasons, view.assessment.failureReasons);
});

test('a low-effort learner is Agent-Failed for its score and gets a remediation event', async (t) => {
  const { view, remediation } = await sit(t, 'low-effort');
  assert.equal(view.status, 'agent_failed');
  assert.ok(view.assessment.failureReasons.includes(EXAM_FAILURE_PROFILES['low-effort'].expected));
  assert.deepEqual(view.assessment.criticalViolationRuleIds, []);
  assert.deepEqual(remediation.event.gap.objectiveIds, view.assessment.failedObjectiveIds);
});

test('a learner that stops answering is Agent-Failed at the deadline and gets a remediation event', async (t) => {
  const { view, remediation } = await sit(t, 'timeout');
  assert.deepEqual([view.status, view.terminalReason], ['agent_failed', EXAM_FAILURE_PROFILES.timeout.expected]);
  assert.equal(view.assessment, null, 'nothing was graded');
  assert.deepEqual(remediation.event.failure.failureReasons, ['response_deadline_elapsed']);
  assert.ok(remediation.event.gap.objectiveIds.length > 0);
});
