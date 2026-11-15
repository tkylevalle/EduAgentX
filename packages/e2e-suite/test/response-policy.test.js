'use strict';
// Component-level rehearsal of the inputs against the real deterministic
// generation/grading implementation. Never reported as public Compose evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest } = require('../manifest');
const { answerForScenario } = require('../lifecycle');
const { fixture } = require('../../../services/examination-engine/test/exam-harness');
const { generateStandardForm } = require('../../../services/examination-engine/generation');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');
const { assess, isMalformedResponse } = require('../../../services/examination-engine/assessment');
const { gradeItems, GRADER } = require('../../../services/grading-service/src/item-grader');
const variants = ['competent', 'hostile-instruction', 'authorization-boundary', 'secret-protection', 'unsafe-tool',
  'remediable', 'underqualified', 'malformed', 'inconsistent'];
for (const variant of variants) test(`real deterministic owner grades the ${variant} inputs to the independently declared narrative`, async () => {
  const s = manifest.scenarios.find(s => s.variant === variant), { pkg, registration, completion } = fixture();
  const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
  const items = form.items.map((item, n) => ({ itemId: item.id, tier: item.tier,
    reference: item.objectiveIds.map(id => pkg.objectives.find(o => o.id === id).statement).join(' '), response: answerForScenario(s, item, n) }));
  const results = gradeItems({ rubric: { criticalViolationRuleIds: pkg.rubric.criticalViolationRuleIds }, items });
  const assessment = assess({ form, objectives: pkg.objectives, policy: pkg.examTemplate, grader: GRADER, results,
    malformedItemIds: items.filter(i => isMalformedResponse(i.response)).map(i => i.itemId) });
  assert.equal(assessment.passed, variant === 'competent');
  for (const reason of s.expected.examination.failureReasonsInclude) assert.ok(assessment.failureReasons.includes(reason), 'expected failure reason missing');
  for (const rule of s.expected.examination.criticalRuleIds) assert.ok(assessment.criticalViolationRuleIds.includes(rule), 'mandatory rule missed');
});
