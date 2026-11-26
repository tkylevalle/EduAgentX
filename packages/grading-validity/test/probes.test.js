'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECT, PROBES, probeAnswers, probeHolds, withConclusiveness } = require('../src/probes');

const entries = [
  { slotId: 'r1', category: 'competent', response: 'r1 good' },
  { slotId: 'a3', category: 'competent', response: 'a3 good' },
  { slotId: 'a3', category: 'unsafe-paraphrase', response: 'a3 unsafe' },
];
const items = [{ slotId: 'r1' }, { slotId: 'a3' }, { slotId: 'v1', kind: 'behaviour' }, { slotId: 'v2', kind: 'behaviour' }];

test('a probe answers text items from its category and behaviour items with its policy', () => {
  assert.deepEqual(probeAnswers({ base: 'competent', behaviour: 'safe-agent' }, entries, items),
    { r1: 'r1 good', a3: 'a3 good', v1: { policy: 'safe-agent' }, v2: { policy: 'safe-agent' } });
});

test('overrides replace only the listed text or behaviour slots', () => {
  const answers = probeAnswers({ base: 'competent', behaviour: 'safe-agent',
    textOverride: { slots: ['a3'], category: 'unsafe-paraphrase' },
    behaviourOverride: { slots: ['v2'], policy: 'instruction-follower' } }, entries, items);
  assert.deepEqual(answers, { r1: 'r1 good', a3: 'a3 unsafe', v1: { policy: 'safe-agent' }, v2: { policy: 'instruction-follower' } });
});

test('a critical-violation probe holds only when the attempt fails for a critical violation', () => {
  const probe = { expect: EXPECT.CRITICAL };
  assert.equal(probeHolds(probe, { passed: false, failureReasons: ['critical_violation'] }), true);
  assert.equal(probeHolds(probe, { passed: false, failureReasons: ['insufficient_overall_score'] }), false);
  assert.equal(probeHolds({ expect: EXPECT.PASS }, { passed: true, failureReasons: [] }), true);
  assert.equal(probeHolds({ expect: EXPECT.FAIL }, { passed: true, failureReasons: [] }), false);
});

test('a holding must-fail probe is inconclusive while a must-pass probe is broken; a broken one is not', () => {
  const results = withConclusiveness([
    { id: 'competent-agent', expect: EXPECT.PASS, holds: false },
    { id: 'partial-agent', expect: EXPECT.FAIL, holds: true },
    { id: 'parrot-agent', expect: EXPECT.FAIL, holds: false },
  ]);
  assert.deepEqual(results.map((result) => result.conclusive), [true, false, true]);
});

test('the panel has must-pass agents, an instruction follower in every behaviour slot, and a written-leak probe', () => {
  assert.ok(PROBES.some((probe) => probe.expect === EXPECT.PASS));
  assert.ok(PROBES.some((probe) => probe.id === 'instruction-follower-agent' && probe.behaviour === 'instruction-follower'));
  assert.ok(PROBES.some((probe) => probe.textOverride?.category === 'unsafe-paraphrase'));
});
