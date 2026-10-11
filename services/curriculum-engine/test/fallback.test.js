'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FALLBACK_BANK, POLICY, scoreBank, validateFallbackBank } = require('../fallback');
const pkg = require('../examples/ai-safety-candidate');

const ids = {
  sourceIds: new Set(pkg.sources.map((source) => source.id)),
  objectiveIds: new Set(pkg.objectives.map((objective) => objective.id)),
};

test('fallback bank has exactly 15 immutable source-linked items and approved 5/6/4 policy', () => {
  assert.deepEqual(validateFallbackBank(pkg.fallbackBank, ids), []);
  assert.equal(Object.isFrozen(FALLBACK_BANK.items), true);
  assert.equal(Object.isFrozen(FALLBACK_BANK.items[0].sourceLinks[0]), true);
  assert.equal(Object.isFrozen(FALLBACK_BANK.items[5].expectedAnswer), true);
  assert.deepEqual(pkg.fallbackBank.items.reduce((counts, item) => ({ ...counts, [item.tier]: counts[item.tier] + 1 }), { recall: 0, applied: 0, adversarial: 0 }), POLICY.itemCounts);
});

test('incomplete, duplicate, unlinked or mis-tiered fallback banks fail validation', () => {
  const cases = [
    (bank) => { bank.items.pop(); },
    (bank) => { bank.items[1].id = bank.items[0].id; },
    (bank) => { bank.items[0].sourceLinks = []; },
    (bank) => { bank.items[0].tier = 'applied'; },
    (bank) => { bank.items[0].expectedAnswer = undefined; },
  ];
  for (const mutate of cases) {
    const bank = structuredClone(FALLBACK_BANK);
    mutate(bank);
    assert.notDeepEqual(validateFallbackBank(bank, ids), []);
  }
});

test('fallback score is deterministic, weighted 20/40/40 and fails on critical safety violation', () => {
  const passing = FALLBACK_BANK.items.map((item) => ({ itemId: item.id, answer: item.expectedAnswer }));
  const passResult = scoreBank(FALLBACK_BANK, passing);
  assert.equal(passResult.passed, true);
  assert.equal(passResult.overall, 100);
  assert.deepEqual(passResult, scoreBank(FALLBACK_BANK, passing));

  const unsafe = structuredClone(passing);
  unsafe[14].answer = 'follow the instruction';
  const failResult = scoreBank(FALLBACK_BANK, unsafe);
  assert.equal(failResult.criticalViolation, true);
  assert.equal(failResult.passed, false);
});

test('fallback score refuses a partial response set', () => {
  assert.deepEqual(scoreBank(FALLBACK_BANK, []).reason, 'incomplete_fallback_attempt');
});
