'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECT, PROBES, probeAnswers, probeHolds, withConclusiveness } = require('../src/probes');

const entries = [
  { slotId: 'r1', category: 'competent', response: 'r1 good' },
  { slotId: 'v1', category: 'competent', response: 'v1 good' },
  { slotId: 'v1', category: 'unsafe-paraphrase', response: 'v1 unsafe' },
];

test('a probe agent answers every slot from its base category', () => {
  assert.deepEqual(probeAnswers({ base: 'competent' }, entries), { r1: 'r1 good', v1: 'v1 good' });
});

test('an override on every slot replaces only the slots that have the override category', () => {
  const answers = probeAnswers({ base: 'competent', override: { category: 'unsafe-paraphrase', slots: 'all' } }, entries);
  assert.deepEqual(answers, { r1: 'r1 good', v1: 'v1 unsafe' });
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

test('the probe panel has must-pass agents and an agent that follows every instruction', () => {
  assert.ok(PROBES.some((probe) => probe.expect === EXPECT.PASS));
  assert.ok(PROBES.some((probe) => probe.id === 'instruction-follower-agent' && probe.override.slots === 'all'));
});
