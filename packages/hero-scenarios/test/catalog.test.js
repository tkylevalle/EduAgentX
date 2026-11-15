'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENARIOS, REQUIRED_DEMONSTRATIONS, FAULT_FIELDS, SAFE_STATES, validateCatalog, validateScenario } = require('../src');

const clone = (value) => JSON.parse(JSON.stringify(value));
const byId = (id) => SCENARIOS.find((scenario) => scenario.id === id);

test('the catalog is valid', () => {
  const result = validateCatalog(SCENARIOS);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('the catalog holds exactly the nine demonstrations from the issue', () => {
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.id), REQUIRED_DEMONSTRATIONS);
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('six scenarios inject a fault and three do not', () => {
  assert.equal(SCENARIOS.filter((scenario) => scenario.kind === 'fault').length, 6);
  assert.equal(SCENARIOS.filter((scenario) => scenario.injectedFault === null).length, 3);
});

for (const scenario of SCENARIOS.filter((item) => item.injectedFault)) {
  test(`${scenario.id} declares all six fault fields`, () => {
    for (const field of FAULT_FIELDS) {
      assert.ok(scenario.injectedFault[field], `${field} is missing`);
    }
    assert.ok(SAFE_STATES.includes(scenario.injectedFault.safeState.state));
  });
}

for (const scenario of SCENARIOS) {
  test(`${scenario.id} is isolated: test keys, simulated tools, test learner`, () => {
    assert.equal(scenario.keys.kind, 'test');
    for (const tool of scenario.tools) assert.match(tool, /^simulated-/);
    if (scenario.usesLearner === false) assert.equal(scenario.learner, null);
    else {
      assert.equal(scenario.learner.isolated, true);
      assert.match(scenario.learner.identity, /-dev$/);
    }
  });
}

test('every optional live run is bounded and has a replay alternative labelled replay', () => {
  for (const scenario of SCENARIOS.filter((item) => item.live)) {
    for (const key of ['maxCalls', 'maxTokens', 'maxRuntimeSeconds', 'maxSpendUsd']) {
      assert.ok(scenario.live.bounds[key] > 0, `${scenario.id} ${key}`);
    }
    assert.equal(scenario.live.replayAlternative.evidenceMode, 'replay');
  }
});

test('the catalog is frozen', () => {
  assert.ok(Object.isFrozen(SCENARIOS));
  assert.ok(Object.isFrozen(SCENARIOS[1].injectedFault));
});

test('validator rejects a fault with a missing forbidden outcome', () => {
  const broken = clone(byId('credential-tampering'));
  delete broken.injectedFault.forbiddenOutcome;
  assert.match(validateScenario(broken).join(' '), /forbiddenOutcome/);
});

test('validator rejects an unknown Safe State', () => {
  const broken = clone(byId('certification-recovery'));
  broken.injectedFault.safeState.state = 'Probably fine';
  assert.match(validateScenario(broken).join(' '), /Safe State must be one of/);
});

test('validator rejects a live run with no spend bound', () => {
  const broken = clone(byId('live-budget-exhaustion-replay'));
  delete broken.live.bounds.maxSpendUsd;
  assert.match(validateScenario(broken).join(' '), /maxSpendUsd/);
});

test('validator rejects a replay alternative labelled live', () => {
  const broken = clone(byId('adversarial-remediation'));
  broken.live.replayAlternative.evidenceMode = 'live';
  assert.match(validateScenario(broken).join(' '), /labelled replay/);
});

test('validator rejects real keys and real tools', () => {
  const broken = clone(byId('adversarial-remediation'));
  broken.keys.kind = 'production';
  broken.tools = ['shell'];
  const text = validateScenario(broken).join(' ');
  assert.match(text, /test keys/);
  assert.match(text, /not simulated/);
});

test('validator rejects a catalog with a missing demonstration', () => {
  const result = validateCatalog(clone(SCENARIOS).slice(1));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /missing demonstration clean-lifecycle-matching/);
});

test('validator rejects a fault declared on a clean scenario', () => {
  const broken = clone(byId('near-matches'));
  broken.injectedFault = clone(byId('credential-tampering').injectedFault);
  assert.match(validateScenario(broken).join(' '), /only fault scenarios/);
});
