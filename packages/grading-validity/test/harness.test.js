'use strict';

// The harness must measure the grader real examinations use, on the items
// real attempts get. These tests check the harness, not the grader's quality:
// the grader's quality is what the report measures.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { referenceExam } = require('../src/exam');
const { startGradingRoute } = require('../src/route');
const { gradeAttempt, gradeEntries } = require('../src/grade');
const { loadHumanLabels } = require('../src/labels');
const { buildDataset } = require('../dataset/build');
const { CATEGORIES, UNSAFE_CATEGORIES } = require('../src/categories');
const { probeAnswers } = require('../src/probes');
const { DEFAULT_MODEL } = require('../../../services/grading-service/src/judge');
const { graderIdentity } = require('../../../services/grading-service/src/rubric-grader');
const committed = require('../dataset/responses.v1.json');

test('the committed dataset is exactly what the builder makes from the current exam', () => {
  assert.deepEqual(committed, buildDataset());
});

test('every critical text slot has an explicit, a paraphrased and a masked unsafe answer', () => {
  const { form } = referenceExam();
  for (const item of form.items.filter((value) => value.kind !== 'behaviour' && value.criticalViolationRuleIds.length)) {
    const categories = committed.entries.filter((entry) => entry.slotId === item.slotId).map((entry) => entry.category);
    for (const category of UNSAFE_CATEGORIES) assert.ok(categories.includes(category), `${item.slotId} lacks ${category}`);
  }
});

test('grading goes through the production route and names the rubric judge', async (t) => {
  const exam = referenceExam();
  const route = await startGradingRoute();
  t.after(() => route.close());
  // Replayed from the committed verdicts: every entry has one, so CI needs no key.
  const { grades, grader } = await gradeEntries({ exam, route, entries: committed.entries });
  assert.deepEqual(grader, graderIdentity(DEFAULT_MODEL));
  assert.equal(grades.size, committed.entries.length);
});

test('a whole attempt is assessed by the Engine pass rule, including critical violations', async (t) => {
  const exam = referenceExam();
  const route = await startGradingRoute();
  t.after(() => route.close());
  const answers = probeAnswers({ base: CATEGORIES.COMPETENT, behaviour: 'safe-agent',
    behaviourOverride: { slots: ['v4'], policy: 'instruction-follower' } }, committed.entries, exam.form.items);
  const assessment = await gradeAttempt({ exam, route, answers });
  assert.equal(assessment.passed, false);
  assert.ok(assessment.failureReasons.includes('critical_violation'));
  assert.equal(assessment.itemOutcomes.length, 15);
});

test('a malformed, repeated or author-written label is refused with every problem listed', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'labels-')), 'labels.json');
  const label = { responseId: 'r1:competent', labeller: 'ana', acceptable: true, score: 90, safetyViolation: false, labelledAt: '2026-11-15' };
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'grading-human-labels/1.0.0',
    labels: [label, label, { ...label, labeller: 'ben', score: 140 }, { ...label, labeller: committed.authors[0] }] }));
  assert.throws(() => loadHumanLabels(file, committed), (error) =>
    error.message.includes('repeats a label by ana') && error.message.includes('score must be 0 to 100') &&
    error.message.includes('wrote the dataset and cannot label it'));
});
