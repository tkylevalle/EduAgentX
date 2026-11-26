'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FALLBACK_BANK, MIN_OPTIONS, POLICY, deliveryChoices, scoreBank, validateFallbackBank } = require('../fallback');
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

// Assurance audit A10: the bank must test knowledge, not answer format.
const SEEDS = Array.from({ length: 200 }, (_, index) => `attempt-${index}`);

// A guessing agent that knows how many answers each item wants and takes the
// first ones it is shown. On the old bank (answers listed first) it scored
// every item. Measured on this bank: 0 passes in 20,000 delivery seeds.
function firstShownAgent(orderFor) {
  return FALLBACK_BANK.items.map((item) => {
    const shown = orderFor(item);
    const count = Array.isArray(item.expectedAnswer) ? item.expectedAnswer.length : 1;
    return { itemId: item.id, answer: item.answerType === 'single_choice' ? shown[0] : shown.slice(0, count) };
  });
}

test('every item offers at least four options, including every expected answer', () => {
  for (const item of FALLBACK_BANK.items) {
    assert.ok(Array.isArray(item.choices) && item.choices.length >= MIN_OPTIONS, `${item.id} offers too few options`);
    const expected = Array.isArray(item.expectedAnswer) ? item.expectedAnswer : [item.expectedAnswer];
    for (const answer of expected) assert.ok(item.choices.includes(answer), `${item.id} hides "${answer}"`);
  }
});

test('delivery order is fixed for one attempt and differs between attempts', () => {
  const item = FALLBACK_BANK.items[0];
  assert.deepEqual(deliveryChoices(item.choices, 'attempt-1'), deliveryChoices(item.choices, 'attempt-1'));
  const orders = new Set(SEEDS.map((seed) => JSON.stringify(deliveryChoices(item.choices, seed))));
  assert.ok(orders.size > 1);
  assert.deepEqual([...deliveryChoices(item.choices, 'attempt-1')].sort(), [...item.choices].sort());
});

test('the guessing agent can detect the old defect: it passes when answers are listed first', () => {
  const answersFirst = (item) => {
    const keyed = Array.isArray(item.expectedAnswer) ? item.expectedAnswer : [item.expectedAnswer];
    return [...keyed, ...item.choices.filter((choice) => !keyed.includes(choice))];
  };
  assert.equal(scoreBank(FALLBACK_BANK, firstShownAgent(answersFirst)).passed, true);
});

test('the guessing agent fails on the stored order and on every attempt\'s delivered order', () => {
  assert.equal(scoreBank(FALLBACK_BANK, firstShownAgent((item) => item.choices)).passed, false);
  for (const seed of SEEDS) {
    const result = scoreBank(FALLBACK_BANK, firstShownAgent((item) => deliveryChoices(item.choices, `${seed}:${item.id}`)));
    assert.equal(result.passed, false, `guessing agent passed on ${seed}`);
  }
});

test('answers are scored by value, so an agent that knows them passes whatever order it was shown', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const responses = FALLBACK_BANK.items.map((item) => ({ itemId: item.id,
      answer: item.answerType === 'multiple_choice' ? deliveryChoices(item.expectedAnswer, seed) : item.expectedAnswer }));
    assert.equal(scoreBank(FALLBACK_BANK, responses).passed, true);
  }
});
