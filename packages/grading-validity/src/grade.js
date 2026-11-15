'use strict';

// Grades dataset responses and whole agent attempts through the production
// route, using the Examination Engine's own request builder and pass rule.

const { randomBytes } = require('node:crypto');
const { assessGraderReply, gradingRequest } = require('../../../services/examination-engine/grading');
const { stepEpisode } = require('../../../services/examination-engine/behaviour');
const { behaviourResponse } = require('../../../services/synthetic-agent-learner/exam-scenarios');
const { PANEL } = require('../../../packages/agent-sandbox/src/panel');

const POLICIES = Object.freeze(Object.fromEntries(PANEL.map((entry) => [entry.id, entry.agent])));
// A one-off seed key per run: probe worlds differ between runs, as attempts do.
const RUN_SEED_KEY = randomBytes(32).toString('hex');

// The route accepts at most one examination form (15 items) per request.
const MAX_ITEMS_PER_REQUEST = 15;

/**
 * Grades each entry once, sent under its own id, at most 15 per request.
 * Entries must be on slots of the current form (stale entries are left out
 * by the caller).
 * @param {{ exam: object, route: { grade: Function }, entries: { id: string, slotId: string, response: string }[] }} input
 * @returns {Promise<{ grades: Map<string, { score: number, criticalViolationRuleIds: string[] }>, grader: { id: string, version: string } }>}
 */
async function gradeEntries({ exam, route, entries }) {
  const itemsBySlot = new Map(exam.form.items.map((item) => [item.slotId, item]));
  const unknown = entries.filter((entry) => !itemsBySlot.has(entry.slotId));
  if (unknown.length) throw new Error(`entries on slots not in the form: ${unknown.map((entry) => entry.id).join(', ')}`);
  const grades = new Map();
  const graders = new Set();
  for (let start = 0; start < entries.length; start += MAX_ITEMS_PER_REQUEST) {
    const batch = entries.slice(start, start + MAX_ITEMS_PER_REQUEST);
    const items = batch.map((entry) => ({ ...itemsBySlot.get(entry.slotId), id: entry.id }));
    const attempt = { form: { ...exam.form, items }, responses: batch.map((entry) => ({ itemId: entry.id, response: entry.response })) };
    const reply = await route.grade(gradingRequest(attempt, exam.pkg));
    graders.add(JSON.stringify(reply.grader));
    for (const result of reply.results) {
      grades.set(result.itemId, { score: result.score, criticalViolationRuleIds: [...result.criticalViolationRuleIds] });
    }
  }
  if (graders.size !== 1) throw new Error('every batch must be graded by the same grader');
  return { grades, grader: JSON.parse([...graders][0]) };
}

/**
 * One whole attempt for an agent that answers each slot with answers[slotId].
 * @param {{ exam: object, route: { grade: Function }, answers: Record<string, string> }} input
 * @returns {Promise<object>} The Engine's assessment, as recorded on a real attempt.
 */
async function gradeAttempt({ exam, route, answers, attemptId = `validity-${randomBytes(6).toString('hex')}` }) {
  const missing = exam.form.items.filter((item) => answers[item.slotId] === undefined);
  if (missing.length) throw new Error(`no answer for slots ${missing.map((item) => item.slotId).join(', ')}`);
  // Behaviour items are played in the sandbox by their reference policy,
  // through the Engine's own step function, as a learner plays them.
  const responses = [];
  for (const item of exam.form.items) {
    const answer = answers[item.slotId];
    const response = typeof answer === 'string' ? answer
      : await behaviourResponse(POLICIES[answer.policy], (taken) => stepEpisode(attemptId, item, taken, RUN_SEED_KEY));
    responses.push({ itemId: item.id, response });
  }
  const attempt = { attemptId, form: exam.form, responses };
  const request = gradingRequest(attempt, exam.pkg);
  const assessment = assessGraderReply({ attempt, pkg: exam.pkg, request, replyBody: await route.grade(request), episodeSeedKey: RUN_SEED_KEY });
  if (!assessment) throw new Error('grader_reply_invalid');
  return assessment;
}

module.exports = { gradeAttempt, gradeEntries };
