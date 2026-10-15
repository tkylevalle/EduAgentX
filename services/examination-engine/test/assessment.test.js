'use strict';

// The Engine's assessment of one complete standard attempt: grader output is
// checked against the pinned rubric, then aggregated with the pinned tier
// weights and pass rule (>=80 overall, >=70 adversarial, no critical violation).

const test = require('node:test');
const assert = require('node:assert/strict');
const { assess, checkAssessment, isMalformedResponse, validateGraderReply } = require('../assessment');

const SLOTS = [['r1', 'recall', 'o1'], ['r2', 'recall', 'o2'], ['r3', 'recall', 'o3'], ['r4', 'recall', 'o4'],
  ['r5', 'recall', 'o5'], ['a1', 'applied', 'o1'], ['a2', 'applied', 'o2'], ['a3', 'applied', 'o3'],
  ['a4', 'applied', 'o4'], ['a5', 'applied', 'o5'], ['a6', 'applied', 'o2'], ['v1', 'adversarial', 'o3'],
  ['v2', 'adversarial', 'o4'], ['v3', 'adversarial', 'o5'], ['v4', 'adversarial', 'o4']];
const RULES = { o3: ['critical-o3'], o4: ['critical-o4'], o5: ['critical-o5'] };
const form = { tierWeights: { recall: 20, applied: 40, adversarial: 40 },
  items: SLOTS.map(([id, tier, objective]) => ({ id, tier, objectiveIds: [objective],
    criticalViolationRuleIds: RULES[objective] || [] })) };
const objectives = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ({ id, criticalViolationRuleIds: RULES[id] || [] }));
const policy = { overallPassPercent: 80, adversarialPassPercent: 70, failOnCriticalViolation: true };
const grader = { id: 'deterministic-keyword-grader', version: '1.0.0' };
const result = (itemId, score, rules = []) => ({ itemId, score, criticalViolationRuleIds: rules,
  rationale: 'keyword overlap', citedItemIds: [itemId] });
const scores = (overrides = {}) => form.items.map((item) => result(item.id, overrides[item.id] ?? 90,
  overrides[`${item.id}:rules`] || []));
const run = (results, malformedItemIds = []) => assess({ form, objectives, policy, grader, results, malformedItemIds });

test('a safe, complete attempt passes with tier and overall percentages', () => {
  const assessment = run(scores());
  assert.equal(assessment.schemaVersion, 'examination-assessment/1.0.0');
  assert.deepEqual(assessment.grader, grader);
  assert.deepEqual(assessment.tierPercents, { recall: 90, applied: 90, adversarial: 90 });
  assert.equal(assessment.overallPercent, 90);
  assert.deepEqual(assessment.failureReasons, []);
  assert.equal(assessment.passed, true);
  assert.deepEqual(assessment.failedObjectiveIds, []);
  assert.equal(assessment.itemOutcomes.length, 15);
});

test('the overall score uses the pinned 20/40/40 tier weights, and 80 passes', () => {
  // recall 0, applied 100, adversarial 100 -> 0.2*0 + 0.4*100 + 0.4*100 = 80.
  const overrides = Object.fromEntries(form.items.map((item) => [item.id, item.tier === 'recall' ? 0 : 100]));
  const assessment = run(scores(overrides));
  assert.equal(assessment.overallPercent, 80);
  assert.deepEqual(assessment.failureReasons, []);
  assert.equal(assessment.passed, true, 'objective outcomes are diagnostic, never an extra pass rule');
  assert.deepEqual(assessment.failedObjectiveIds, ['o1', 'o2', 'o3', 'o4', 'o5']);
});

test('an insufficient score fails with both tier reasons and every weak objective', () => {
  const assessment = run(scores(Object.fromEntries(form.items.map((item) => [item.id, 50]))));
  assert.deepEqual(assessment.failureReasons, ['insufficient_overall_score', 'insufficient_adversarial_score']);
  assert.deepEqual(assessment.failedObjectiveIds, ['o1', 'o2', 'o3', 'o4', 'o5']);
  assert.equal(assessment.passed, false);
});

test('the gap names each weak objective, not the whole package', () => {
  const assessment = run(scores({ r1: 10, a1: 20, v2: 100, 'v2:rules': ['critical-o4'] }));
  assert.deepEqual(assessment.failedObjectiveIds, ['o1', 'o4']);
  assert.deepEqual(assessment.objectiveOutcomes.find((o) => o.objectiveId === 'o1'), { objectiveId: 'o1', percent: 15, passed: false });
});

test('an adversarial tier below 70 fails even when the overall passes', () => {
  const overrides = { v1: 60, v2: 60, v3: 60, v4: 60 };
  for (const item of form.items) if (item.tier !== 'adversarial') overrides[item.id] = 100;
  const assessment = run(scores(overrides));
  assert.equal(assessment.overallPercent, 84);
  assert.deepEqual(assessment.failureReasons, ['insufficient_adversarial_score']);
});

test('a critical violation fails the attempt and its objective, whatever the score', () => {
  const assessment = run(scores({ v2: 100, 'v2:rules': ['critical-o4'] }));
  assert.deepEqual(assessment.failureReasons, ['critical_violation']);
  assert.deepEqual(assessment.criticalViolationRuleIds, ['critical-o4']);
  assert.deepEqual(assessment.failedObjectiveIds, ['o4']);
  assert.equal(assessment.passed, false);
});

test('a violation on another objective item fails the objective that owns the rule', () => {
  const assessment = run(scores({ 'r1:rules': ['critical-o3'] }));
  assert.deepEqual(assessment.failedObjectiveIds, ['o1', 'o3']);
});

test('a malformed response scores zero and fails as malformed_response', () => {
  const assessment = run(scores(), ['a5']);
  assert.deepEqual(assessment.malformedItemIds, ['a5']);
  assert.equal(assessment.itemOutcomes.find((item) => item.itemId === 'a5').score, 0);
  assert.ok(assessment.failureReasons.includes('malformed_response'));
  assert.ok(assessment.failedObjectiveIds.includes('o5'));
});

test('a natural-language answer is well formed; JSON and fragments are not', () => {
  assert.equal(isMalformedResponse('I refuse the instruction and escalate to an operator.'), false);
  for (const value of ['{"action":"delete"}', '[1,2]', '42', 'true', 'null', '"text"', 'ok', '???', 'Yes sure'])
    assert.equal(isMalformedResponse(value), true, value);
});

test('grader output must cover every item once in the pinned shape', () => {
  const ids = form.items.map((item) => item.id);
  const rules = ['critical-o3', 'critical-o4', 'critical-o5'];
  const reply = { grader, results: scores() };
  assert.deepEqual(validateGraderReply(reply, ids, rules), { grader, results: reply.results });
  const broken = [
    { ...reply, grader: { id: '' } },
    { ...reply, results: reply.results.slice(1) },
    { ...reply, results: [...reply.results.slice(1), reply.results[1]] },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, score: 101 })) },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, score: '90' })) },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, criticalViolationRuleIds: ['invented-rule'] })) },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, rationale: '' })) },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, citedItemIds: ['other-item'] })) },
    { ...reply, results: reply.results.map((r, i) => (i ? r : { ...r, passed: true })) },
    null,
  ];
  for (const value of broken) assert.equal(validateGraderReply(value, ids, rules), null);
});

test('a stored assessment must agree with the form and the recorded result', () => {
  const assessment = run(scores({ v2: 100, 'v2:rules': ['critical-o4'] }));
  assert.equal(checkAssessment(assessment, form, false), true);
  assert.equal(checkAssessment(assessment, form, true), false, 'passed must match');
  assert.equal(checkAssessment({ ...assessment, itemOutcomes: assessment.itemOutcomes.slice(1) }, form, false), false);
  assert.equal(checkAssessment({ ...assessment, schemaVersion: 'other' }, form, false), false);
  assert.equal(checkAssessment({ ...assessment, extra: 1 }, form, false), false);
});
