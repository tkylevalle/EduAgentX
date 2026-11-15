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
const { GRADER } = require('../../../services/grading-service/src/item-grader');
const committed = require('../dataset/responses.v1.json');

const CRITICAL_CATEGORIES = ['unsafe-explicit', 'unsafe-paraphrase', 'masked-unsafe'];

test('the committed dataset is exactly what the builder makes from the current exam', () => {
  assert.deepEqual(committed, buildDataset());
});

test('every critical slot has an explicit, a paraphrased and a masked unsafe answer', () => {
  const { form } = referenceExam();
  for (const item of form.items.filter((value) => value.criticalViolationRuleIds.length)) {
    const categories = committed.entries.filter((entry) => entry.slotId === item.slotId).map((entry) => entry.category);
    for (const category of CRITICAL_CATEGORIES) assert.ok(categories.includes(category), `${item.slotId} lacks ${category}`);
  }
});

test('grading goes through the production route and names its grader', async (t) => {
  const exam = referenceExam();
  const route = await startGradingRoute();
  t.after(() => route.close());
  const { grades, grader } = await gradeEntries({ exam, route, entries: committed.entries.slice(0, 20) });
  assert.deepEqual(grader, GRADER);
  assert.equal(grades.size, 20);
});

test('a whole attempt is assessed by the Engine pass rule, including critical violations', async (t) => {
  const exam = referenceExam();
  const route = await startGradingRoute();
  t.after(() => route.close());
  const answers = Object.fromEntries(exam.form.items.map((item) => [item.slotId,
    committed.entries.find((entry) => entry.slotId === item.slotId && entry.category === 'competent').response]));
  answers.v4 = committed.entries.find((entry) => entry.id === 'v4:unsafe-explicit').response;
  const assessment = await gradeAttempt({ exam, route, answers });
  assert.equal(assessment.passed, false);
  assert.ok(assessment.failureReasons.includes('critical_violation'));
  assert.equal(assessment.itemOutcomes.length, 15);
});

test('a label file with a malformed or repeated label is refused with every problem listed', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'labels-')), 'labels.json');
  const label = { responseId: 'r1:competent', labeller: 'ana', acceptable: true, score: 90, safetyViolation: false, labelledAt: '2026-11-15' };
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'grading-human-labels/1.0.0',
    labels: [label, label, { ...label, labeller: 'ben', score: 140 }] }));
  assert.throws(() => loadHumanLabels(file, committed.entries), (error) =>
    error.message.includes('repeats a label by ana') && error.message.includes('score must be 0 to 100'));
});
