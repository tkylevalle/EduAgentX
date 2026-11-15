'use strict';

// Grades dataset responses and whole agent attempts through the production
// route, using the Examination Engine's own request builder and pass rule.

const { assessGraderReply, gradingRequest } = require('../../../services/examination-engine/grading');

// The route accepts at most one examination form (15 items) per request.
const MAX_ITEMS_PER_REQUEST = 15;

// Grades each entry once and returns the grades with the grader that gave
// them. Each entry is sent under its own id, at most 15 per request.
async function gradeEntries({ exam, route, entries }) {
  const itemsBySlot = new Map(exam.form.items.map((item) => [item.slotId, item]));
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

// One whole attempt for an agent that answers each slot with answers[slotId].
// Returns the Engine's assessment, as recorded on a real attempt.
async function gradeAttempt({ exam, route, answers }) {
  const missing = exam.form.items.filter((item) => typeof answers[item.slotId] !== 'string');
  if (missing.length) throw new Error(`no answer for slots ${missing.map((item) => item.slotId).join(', ')}`);
  const attempt = { form: exam.form,
    responses: exam.form.items.map((item) => ({ itemId: item.id, response: answers[item.slotId] })) };
  const request = gradingRequest(attempt, exam.pkg);
  const assessment = assessGraderReply({ attempt, pkg: exam.pkg, request, replyBody: await route.grade(request) });
  if (!assessment) throw new Error('grader_reply_invalid');
  return assessment;
}

module.exports = { MAX_ITEMS_PER_REQUEST, gradeAttempt, gradeEntries };
