'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const p = require('..');
const reference = require('../reference');
const { fixture } = require('./fixtures');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');
const { assessGraderReply, gradingRequest } = require('../../../services/examination-engine/grading');
const { actionsResponse, policyEpisodes } = require('../../../services/examination-engine/behaviour');
const { policiesOf } = require('../../../packages/agent-sandbox/src/panel');
const { AI_SAFETY } = require('../../../packages/agent-sandbox/src/families');
const { replayGrader } = require('../scripted-verdicts');
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
  // Re-pinned on 17 November 2026: the reference source's digest now covers
  // reference.js and the written answers it gives (competent-answers.v1.json),
  // which replaced the echoed item prompt as its answer to text items.
  assert.equal(p.source('synthetic:competent:safe-escalation').digest,
    'sha256:da668383190f4b878da524c3ccf8c414b43c9499c7d858b897dbeab6b5894212');
  assert.throws(() => p.source('synthetic:competent:applied-low-effort-v1'));
  const f = fixture();
  const old = p.enrollments([{ subject: f.run.executorId, evidenceMode: 'synthetic', sources: [f.profile] }]);
  assert.throws(() => p.authority(old, { subject: f.run.executorId, role: 'agent' }, PROFILE));
});
// Real grading is the grader that decides credentials: the production rubric
// grader (recorded judge verdicts, scripted-verdicts.v1.json) for text items,
// and the Engine's sandbox for behaviour items, which neither source changes:
// both play them as the safe reference agent (the sandbox grades actions, so
// the source's text for a behaviour item is not what production grades).
const SEED_KEY = 'remediable-test-episode-seed-key-0123456789';
const SAFE_AGENT = policiesOf(AI_SAFETY)['safe-agent'];
test('real grading observes a safe remediable failure, followed by a separate safe pass', async () => {
  const f = setup(), grader = replayGrader();
  const evaluate = async (source) => {
    const attemptId = randomUUID();
    const responses = f.items.map(item => ({ itemId: item.id, response: item.kind === 'behaviour'
      ? actionsResponse(policyEpisodes(attemptId, item, SEED_KEY, SAFE_AGENT)) : p.generated(p.source(source), 'examination', item).response }));
    const attempt = { attemptId, form: { items: f.items, tierWeights: { ...f.pkg.examTemplate.tierWeights },
      rubric: { id: f.pkg.rubric.id, version: f.pkg.rubric.version } }, responses };
    const request = gradingRequest(attempt, f.pkg);
    const replyBody = { grader: grader.identity, results: await grader.gradeItems(request) };
    return assessGraderReply({ attempt, pkg: f.pkg, request, replyBody, episodeSeedKey: SEED_KEY });
  };
  const failed = await evaluate(PROFILE);
  assert.equal(failed.passed, false);
  assert.ok(failed.failureReasons.includes('insufficient_overall_score'));
  assert.deepEqual(failed.criticalViolationRuleIds, []);
  assert.ok(failed.tierPercents.adversarial >= 70);
  assert.ok(failed.failedObjectiveIds.length > 0);
  const passed = await evaluate('synthetic:competent:safe-escalation');
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.failureReasons, []);
});
