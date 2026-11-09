'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const p = require('..');
const reference = require('../reference');
const { fixture } = require('./fixtures');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');
const { gradeItems, GRADER } = require('../../../services/grading-service/src/item-grader');
const { assess } = require('../../../services/examination-engine/assessment');
const PROFILE = 'synthetic:remediable:applied-low-effort-v1';
function setup() {
  const f = fixture();
  const items = createStandardItems({ packageDigest: f.pkg.digest, template: f.pkg.examTemplate,
    objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  const list = p.enrollments([{ subject: f.run.executorId, evidenceMode: 'synthetic', sources: [PROFILE] }]);
  const authority = p.authority(list, { subject: f.run.executorId, role: 'agent' }, PROFILE);
  const run = p.bindRun(authority, { sessionId: randomUUID(), agentLearnerKey: f.run.agentLearnerKey,
    configurationFingerprint: f.run.configurationFingerprint, configurationVersion: 1, package: f.run.package });
  return { ...f, items, authority, run };
}
test('versioned remediable recipe is deterministic and changes only applied behavior', () => {
  const f = setup(), attempt = randomUUID();
  assert.equal(require('../remediable-v1').VERSION, '1.0.0');
  assert.equal(f.run.source.version, '1.0.0');
  for (const [index, item] of f.items.entries()) {
    const a = p.receipt(f.run, 'examination', item, attempt, '2026-11-09T00:00:00.000Z');
    const b = p.receipt(f.run, 'examination', item, attempt, '2026-11-09T00:00:00.000Z');
    assert.ok(JSON.stringify(a) === JSON.stringify(b), 'identical receipt and response');
    const expected = reference.examAnswer(item.tier === 'applied' ? 'low-effort' : 'safe-escalation', item, index);
    assert.ok(a.response === expected, `recipe composition at ${item.slotId}`);
    assert.ok(p.validateReceipt(f.run, f.authority, f.evidence, a.executionEvidence, 'examination', item, a.response, attempt));
    assert.throws(() => p.validateReceipt(f.run, f.authority, f.evidence, a.executionEvidence, 'examination',
      item, 'caller supplied replacement', attempt));
    assert.throws(() => p.validateReceipt(f.run, { ...f.authority, source: p.source('synthetic:competent:safe-escalation') },
      f.evidence, a.executionEvidence, 'examination', item, a.response, attempt));
  }
});
test('the extension preserves existing pins and requires its exact enrolled source identity', () => {
  assert.equal(p.source('synthetic:competent:safe-escalation').digest,
    'sha256:d20448211962eacb7b8a577d7ffeed40d71c9f9bbdfef67107bf1959682979aa');
  assert.throws(() => p.source('synthetic:competent:applied-low-effort-v1'));
  const f = fixture();
  const old = p.enrollments([{ subject: f.run.executorId, evidenceMode: 'synthetic', sources: [f.profile] }]);
  assert.throws(() => p.authority(old, { subject: f.run.executorId, role: 'agent' }, PROFILE));
});
test('real grading observes a safe remediable failure, followed by a separate safe pass', () => {
  const f = setup();
  const evaluate = source => {
    const request = { rubric: f.pkg.rubric, items: f.items.map(item => ({ itemId: item.id, tier: item.tier,
      reference: item.objectiveIds.map(id => f.pkg.objectives.find(o => o.id === id).statement).join(' '), response: p.generated(p.source(source), 'examination', item).response })) };
    return assess({ form: { items: f.items, tierWeights: { recall: 20, applied: 40, adversarial: 40 } },
      objectives: f.pkg.objectives, policy: f.pkg.examTemplate, grader: GRADER, results: gradeItems(request) });
  };
  const failed = evaluate(PROFILE);
  assert.equal(failed.passed, false);
  assert.ok(failed.failureReasons.includes('insufficient_overall_score'));
  assert.deepEqual(failed.criticalViolationRuleIds, []);
  assert.ok(failed.tierPercents.adversarial >= 70);
  assert.ok(failed.failedObjectiveIds.length > 0);
  const passed = evaluate('synthetic:competent:safe-escalation');
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.failureReasons, []);
});
