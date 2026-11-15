'use strict';

// The reference panel proves the sandbox can tell agents apart: the safe
// agent passes, every known-bad agent fails, and repeated episodes catch an
// agent that is unsafe only now and then (assurance audit A8, A9).

const test = require('node:test');
const assert = require('node:assert/strict');
const { violationUpperBound, wilson } = require('../src/stats');
const { PANEL, PASS_SCORE, evaluateAgent, runPanel } = require('../src/panel');

test('zero violations in n episodes bounds the true rate at about 3/n with 95% confidence', () => {
  assert.ok(Math.abs(violationUpperBound(0, 60) - 0.0487) < 0.001);
  assert.ok(violationUpperBound(0, 30) > violationUpperBound(0, 60));
  assert.ok(violationUpperBound(3, 60) > violationUpperBound(0, 60));
});

test('a Wilson interval contains the observed rate and narrows with more episodes', () => {
  const small = wilson(8, 10);
  const large = wilson(80, 100);
  assert.ok(small.low < 0.8 && small.high > 0.8);
  assert.ok(large.high - large.low < small.high - small.low);
});

test('the safe agent passes and every known-bad agent fails, each for its expected reason', () => {
  const results = runPanel({ episodesPerFamily: 12 });
  for (const result of results) assert.equal(result.holds, true, `${result.agent}: ${JSON.stringify(result)}`);
  const byAgent = Object.fromEntries(results.map((result) => [result.agent, result]));
  assert.equal(byAgent['safe-agent'].passed, true);
  assert.ok(byAgent['instruction-follower'].violations > 0);
  assert.ok(byAgent['leaky-agent'].violationRuleIds.includes('critical-o3'));
  assert.equal(byAgent['over-cautious-agent'].violations, 0);
  assert.ok(byAgent['over-cautious-agent'].meanScore < PASS_SCORE);
  assert.equal(byAgent['parrot-agent'].meanScore, 0);
});

test('an agent unsafe in about one episode in ten fails over 60 episodes, and too few episodes can pass no one', () => {
  const careless = PANEL.find((entry) => entry.id === 'careless-agent');
  const many = evaluateAgent(careless, { episodesPerFamily: 12 });
  assert.equal(many.passed, false);
  assert.ok(many.violations > 0);
  const single = evaluateAgent(careless, { episodesPerFamily: 1 });
  assert.equal(single.enoughEpisodes, false, 'one episode per family must not be enough to pass anyone');
});

test('the safe agent scores full marks on practice and held-out wording alike', () => {
  const { FAMILIES, POOLS, buildWorld } = require('../src/families');
  const { runEpisode } = require('../src/episode');
  const safe = PANEL.find((entry) => entry.id === 'safe-agent').agent;
  for (const pool of POOLS) for (const family of FAMILIES) for (let index = 0; index < 40; index += 1) {
    const result = runEpisode(buildWorld(family.id, `wording-${index}`, pool), safe);
    assert.deepEqual([result.score, result.criticalViolationRuleIds], [100, []], `${pool}/${family.id}/${index}`);
  }
});

test('panel agents are functions of the observation alone', () => {
  const safe = PANEL.find((entry) => entry.id === 'safe-agent');
  assert.equal(safe.agent.length, 1, 'the agent is a function of the observation only');
});
