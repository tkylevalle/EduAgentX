'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEGACY_POLICY, completionPolicy, completionStatus, deliveryPlan, objectiveProgress, planSummary, policyFromEnv,
  practiceShortfall, sessionPlan, targetPlan,
} = require('../plan');

const payload = () => ({
  objectives: [
    { id: 'o1', deliveryItemIds: ['m1-lesson', 'm1-practice'] },
    { id: 'o2', deliveryItemIds: ['m2-lesson', 'm2-practice-1'] },
    { id: 'o3', deliveryItemIds: ['m2-practice-2'] },
  ],
  modules: [
    { id: 'm2', sequence: 2, deliveryItems: [
      { id: 'm2-lesson', kind: 'lesson', text: 'L2' },
      { id: 'm2-practice-1', kind: 'practice', text: 'P2a' },
      { id: 'm2-practice-2', kind: 'practice', text: 'P2b' }] },
    { id: 'm1', sequence: 1, deliveryItems: [
      { id: 'm1-lesson', text: 'L1' },
      { id: 'm1-practice', kind: 'practice', text: 'P1' }] },
  ],
});

test('deliveryPlan carries each item kind, defaults to lesson, and refuses an unknown kind', () => {
  const plan = deliveryPlan(payload());
  assert.deepEqual(plan.map((item) => [item.deliveryItemId, item.kind, item.position]), [
    ['m1-lesson', 'lesson', 1], ['m1-practice', 'practice', 2],
    ['m2-lesson', 'lesson', 3], ['m2-practice-1', 'practice', 4], ['m2-practice-2', 'practice', 5]]);
  const odd = payload();
  odd.modules[0].deliveryItems[0].kind = 'quiz';
  assert.equal(deliveryPlan(odd), null);
});

test('completionPolicy validates its bounds and policyFromEnv fails fast on a bad value', () => {
  assert.deepEqual(completionPolicy(), {
    version: 'training-completion/1', minPracticeItemsPerModule: 1, maxResponseChars: 4000 });
  assert.deepEqual(policyFromEnv({ TRAINING_MIN_PRACTICE_PER_MODULE: '2', TRAINING_MAX_RESPONSE_CHARS: '500' }),
    { version: 'training-completion/1', minPracticeItemsPerModule: 2, maxResponseChars: 500 });
  assert.deepEqual(policyFromEnv({}), completionPolicy());
  for (const env of [{ TRAINING_MIN_PRACTICE_PER_MODULE: '-1' }, { TRAINING_MIN_PRACTICE_PER_MODULE: 'one' },
    { TRAINING_MIN_PRACTICE_PER_MODULE: '21' }, { TRAINING_MAX_RESPONSE_CHARS: '0' },
    { TRAINING_MAX_RESPONSE_CHARS: '16001' }, { TRAINING_MAX_RESPONSE_CHARS: '1.5' }]) {
    assert.throws(() => policyFromEnv(env), Error, JSON.stringify(env));
  }
  assert.equal(LEGACY_POLICY.minPracticeItemsPerModule, 0);
});

test('practiceShortfall names modules with too few practice items for the policy', () => {
  const plan = deliveryPlan(payload());
  assert.deepEqual(practiceShortfall(plan, completionPolicy({ minPracticeItemsPerModule: 1 })), []);
  assert.deepEqual(practiceShortfall(plan, completionPolicy({ minPracticeItemsPerModule: 2 })), ['m1']);
  assert.deepEqual(practiceShortfall(plan, completionPolicy({ minPracticeItemsPerModule: 0 })), []);
});

test('completionStatus needs every planned item and the practice minimum in every module', () => {
  const plan = deliveryPlan(payload());
  const policy = completionPolicy({ minPracticeItemsPerModule: 1 });
  const all = plan.map((item) => item.deliveryItemId);
  assert.equal(completionStatus(plan, all.slice(0, 4), policy).complete, false);
  const done = completionStatus(plan, all, policy);
  assert.deepEqual([done.complete, done.completedItems, done.plannedItems, done.practiceCompleted], [true, 5, 5, 3]);
  // A plan whose practice items were never delivered cannot complete, even with every item listed done.
  const lessonsOnly = plan.filter((item) => item.kind === 'lesson');
  assert.equal(completionStatus(lessonsOnly, all, policy).complete, false);
  assert.equal(completionStatus([], [], policy).complete, false, 'an empty plan never completes');
});

test('targetPlan and sessionPlan keep only items for the targeted objectives, renumbered', () => {
  const plan = deliveryPlan(payload());
  const targeted = targetPlan(plan, ['o2']);
  assert.deepEqual(targeted.map((item) => [item.deliveryItemId, item.position, item.total]),
    [['m2-lesson', 1, 2], ['m2-practice-1', 2, 2]]);
  const session = { kind: 'remediation', remediation: { objectiveIds: ['o1', 'o3'] } };
  assert.deepEqual(sessionPlan(payload(), session).map((item) => item.deliveryItemId),
    ['m1-lesson', 'm1-practice', 'm2-practice-2']);
  assert.equal(sessionPlan(payload(), { kind: 'standard' }).length, 5);
});

test('objectiveProgress reports planned and completed items and practice per objective', () => {
  const stored = planSummary(deliveryPlan(payload()));
  assert.ok(stored.every((item) => !('text' in item)), 'the stored plan never holds lesson text');
  const progress = objectiveProgress(stored, ['m1-lesson', 'm1-practice', 'm2-lesson']);
  assert.deepEqual(progress, [
    { objectiveId: 'o1', plannedItems: 2, completedItems: 2, plannedPractice: 1, completedPractice: 1, complete: true },
    { objectiveId: 'o2', plannedItems: 2, completedItems: 1, plannedPractice: 1, completedPractice: 0, complete: false },
    { objectiveId: 'o3', plannedItems: 1, completedItems: 0, plannedPractice: 1, completedPractice: 0, complete: false },
  ]);
  assert.equal(objectiveProgress(null, []), null, 'sessions from before Issue 13 have no stored plan');
});
