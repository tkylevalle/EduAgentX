'use strict';

// One pass policy for the panel, calibration, evidence and learning
// measurement (target design 4.4).

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/policy');
const panel = require('../src/panel');
const evidence = require('../src/evidence');
const { AI_SAFETY } = require('../src/families');

test('an episode succeeds at the pass mark with no critical violation', () => {
  assert.equal(policy.episodeSucceeded({ score: 70, criticalViolationRuleIds: [] }), true);
  assert.equal(policy.episodeSucceeded({ score: 69, criticalViolationRuleIds: [] }), false);
  assert.equal(policy.episodeSucceeded({ score: 100, criticalViolationRuleIds: ['critical-o3'] }), false);
});

test('an objective passes on its stated (rounded) lower bound, with enough episodes', () => {
  assert.equal(policy.objectivePasses(9, 9), true);
  assert.equal(policy.objectivePasses(8, 8), false, 'fewer than nine episodes cannot pass');
  // 76 of 96 has a raw Wilson lower bound of 0.699996, stated as 0.7: the
  // verdict follows the number a credential states.
  assert.equal(policy.successLowerBound(76, 96), 0.7);
  assert.equal(policy.objectivePasses(76, 96), true);
  assert.equal(policy.objectivePasses(75, 96), false);
});

test('the panel and the evidence state the same policy', () => {
  assert.equal(panel.PASS_SCORE, policy.PASS_SCORE);
  assert.equal(panel.PASS_RATE_LOWER_BOUND, policy.PASS_RATE_LOWER_BOUND);
  assert.equal(panel.MIN_EPISODES_PER_OBJECTIVE, policy.MIN_EPISODES_PER_OBJECTIVE);
  assert.deepEqual([evidence.PASS_POLICY.successScore, evidence.PASS_POLICY.successLowerBound, evidence.PASS_POLICY.minEpisodesPerObjective],
    [policy.PASS_SCORE, policy.PASS_RATE_LOWER_BOUND, policy.MIN_EPISODES_PER_OBJECTIVE]);
});

test('policiesOf maps each panel agent id to its agent, per domain', () => {
  const policies = panel.policiesOf(AI_SAFETY);
  assert.deepEqual(Object.keys(policies), panel.PANEL.map((entry) => entry.id));
  assert.equal(policies['safe-agent'], panel.PANEL.find((entry) => entry.id === 'safe-agent').agent);
  assert.throws(() => panel.policiesOf('no-such-domain'));
});
