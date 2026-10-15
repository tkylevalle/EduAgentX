'use strict';

// Issue #21: seeded adversarial examination scenarios. Each one changes the
// learner's answer on exactly one pinned slot, so a failure is traceable to
// the scenario's context; every other answer is the safe baseline.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXAM_SCENARIOS, EXAM_FAILURE_PROFILES, listExamScenarios, examAnswer, SAFE_CLOSING } = require('../exam-scenarios');

const SLOTS = ['r1', 'r2', 'r3', 'r4', 'r5', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'v1', 'v2', 'v3', 'v4'];
const form = SLOTS.map((slotId) => ({ id: `item-${slotId}`, slotId, prompt: `Prompt for ${slotId}.` }));

test('the five Issue #21 scenarios and three failure profiles are seeded', () => {
  assert.deepEqual(Object.keys(EXAM_SCENARIOS).sort(),
    ['authorization-boundary', 'hostile-instruction', 'safe-escalation', 'secret-protection', 'unsafe-tool']);
  assert.deepEqual(Object.keys(EXAM_FAILURE_PROFILES).sort(), ['low-effort', 'malformed-output', 'timeout']);
  assert.deepEqual(listExamScenarios(), [...Object.keys(EXAM_SCENARIOS), ...Object.keys(EXAM_FAILURE_PROFILES)].sort());
  assert.ok(Object.isFrozen(EXAM_SCENARIOS['unsafe-tool']));
});

test('a scenario changes only its target slot and the rest is the safe baseline', () => {
  for (const [id, scenario] of Object.entries(EXAM_SCENARIOS)) {
    const answers = form.map((item, index) => examAnswer(id, item, index));
    form.forEach((item, index) => {
      if (item.slotId === scenario.slotId) assert.equal(answers[index], scenario.answer, id);
      else assert.equal(answers[index], `${item.prompt} ${SAFE_CLOSING}`, `${id} ${item.slotId}`);
    });
    assert.ok(['agent_failed', 'complete'].includes(scenario.expected.status));
    assert.deepEqual(form.map((item, index) => examAnswer(id, item, index)), answers, 'deterministic');
  }
});

test('failure profiles answer malformed, low-effort, or stop answering', () => {
  assert.ok(form.every((item, index) => JSON.parse(examAnswer('malformed-output', item, index))));
  assert.ok(form.every((item, index) => examAnswer('low-effort', item, index) === EXAM_FAILURE_PROFILES['low-effort'].answer));
  const timed = form.map((item, index) => examAnswer('timeout', item, index));
  assert.equal(timed.filter((value) => value === null).length, SLOTS.length - EXAM_FAILURE_PROFILES.timeout.answeredItems);
  assert.equal(timed.slice(0, EXAM_FAILURE_PROFILES.timeout.answeredItems).every((value) => typeof value === 'string'), true);
});

test('an unknown scenario is refused', () => {
  assert.throws(() => examAnswer('no-such-scenario', form[0], 0), /unknown exam scenario/);
});
