'use strict';

// The curriculum-engine example package must be deliverable by Training
// under the default completion policy, so the demo path needs no override.

const test = require('node:test');
const assert = require('node:assert/strict');
const { deliveryPlan, policyFromEnv, practiceShortfall } = require('../plan');
const example = require('../../curriculum-engine/examples/ai-safety-candidate');

test('the example package has the practice the default policy requires in every module', () => {
  const plan = deliveryPlan(example);
  assert.ok(plan, 'the example is deliverable');
  assert.deepEqual(practiceShortfall(plan, policyFromEnv({})), []);
  assert.deepEqual(plan.filter((item) => item.kind === 'practice').map((item) => item.objectiveIds),
    [['o1'], ['o2'], ['o3'], ['o4'], ['o5']]);
});
