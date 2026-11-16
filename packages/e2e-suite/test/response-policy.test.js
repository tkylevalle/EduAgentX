'use strict';
// Component-level rehearsal of the inputs against the real generation and the
// grading that decides credentials: the production rubric grader on recorded
// judge verdicts (packages/execution-provenance/scripted-verdicts.v1.json) for
// text items, the Engine's sandbox for behaviour items, and the Engine's own
// assessment. Never reported as public Compose evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { manifest } = require('../manifest');
const { answerForScenario } = require('../lifecycle');
const { fixture } = require('../../../services/examination-engine/test/exam-harness');
const { generateStandardForm } = require('../../../services/examination-engine/generation');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');
const { assessGraderReply, gradingRequest } = require('../../../services/examination-engine/grading');
const { actionsResponse, policyEpisodes } = require('../../../services/examination-engine/behaviour');
const { examPolicy } = require('../../../services/synthetic-agent-learner/exam-scenarios');
const { replayGrader } = require('../../../packages/execution-provenance/scripted-verdicts');
const SEED_KEY = 'response-policy-test-episode-seed-key-0123';
const variants = ['competent', 'hostile-instruction', 'authorization-boundary', 'secret-protection', 'unsafe-tool',
  'remediable', 'underqualified', 'malformed', 'inconsistent'];
// Malformed answers embed each form's item ids, so no judge verdict is recorded
// for them: a text grader that accepts every answer stands in, which shows the
// Engine's own malformed-response check fails them whatever the scores.
const acceptAll = { identity: { id: 'accept-all', version: '1' }, gradeItems: async ({ items }) => items.map(item => ({ itemId: item.itemId,
  score: 100, criticalViolationRuleIds: [], rationale: 'accept all', citedItemIds: [item.itemId] })) };
const rubric = replayGrader();
for (const variant of variants) test(`real owner grades the ${variant} inputs to the independently declared narrative`, async () => {
  const s = manifest.scenarios.find(s => s.variant === variant), { pkg, registration, completion } = fixture();
  const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
  const attemptId = randomUUID(), scenario = s.category === 'adversarial' ? s.variant : 'safe-escalation';
  // Behaviour items are played in their sandbox worlds: the adversarial
  // scenario's slot by the instruction follower, every other slot safely.
  const responses = form.items.map((item, n) => ({ itemId: item.id, response: item.kind === 'behaviour'
    ? actionsResponse(policyEpisodes(attemptId, item, SEED_KEY, examPolicy(scenario, item))) : answerForScenario(s, item, n) }));
  const attempt = { attemptId, form, responses }, request = gradingRequest(attempt, pkg);
  const grader = s.category === 'robustness' ? acceptAll : rubric;
  const replyBody = { grader: grader.identity, results: await grader.gradeItems(request) };
  const assessment = assessGraderReply({ attempt, pkg, request, replyBody, episodeSeedKey: SEED_KEY });
  assert.equal(assessment.passed, variant === 'competent');
  for (const reason of s.expected.examination.failureReasonsInclude) assert.ok(assessment.failureReasons.includes(reason), 'expected failure reason missing');
  for (const rule of s.expected.examination.criticalRuleIds) assert.ok(assessment.criticalViolationRuleIds.includes(rule), 'mandatory rule missed');
});
