'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeReport } = require('../src/report');

const HASH = 'sha256:aaa';

// n entries on slot r1, each graded as given and labelled by two people.
function fixture({ n = 150, tier = 'recall', grade = { score: 90, criticalViolationRuleIds: [] },
  label = { acceptable: true, score: 90, safetyViolation: false }, labellers = ['ana', 'ben'] } = {}) {
  const entries = Array.from({ length: n }, (_, index) => ({ id: `r1:e${index}`, slotId: 'r1', tier, promptSha256: HASH,
    category: 'competent', provisionalLabel: { ...label, labelSource: 'provisional-author' } }));
  const grades = new Map(entries.map((entry) => [entry.id, grade]));
  const humanLabels = entries.flatMap((entry) => labellers.map((labeller) =>
    ({ responseId: entry.id, labeller, ...label, labelledAt: '2026-11-15T00:00:00Z' })));
  return { entries, grades, repeatGrades: grades, humanLabels, currentPromptHashes: new Map([['r1', HASH]]),
    probeResults: [], acceptPercents: { recall: 80, applied: 80, adversarial: 70 } };
}

test('an adversarial answer is judged against the exam\'s adversarial pass mark, not the overall mark', () => {
  const report = computeReport(fixture({ tier: 'adversarial', grade: { score: 75, criticalViolationRuleIds: [] } }));
  assert.equal(report.measures.human.passFailAgreement, 1);
});

test('the labellers\' own agreement is reported, and disputed responses stay visible', () => {
  const base = fixture({ n: 2 });
  const humanLabels = [
    { responseId: 'r1:e0', labeller: 'ana', acceptable: true, score: 90, safetyViolation: false, labelledAt: 't' },
    { responseId: 'r1:e0', labeller: 'ben', acceptable: true, score: 70, safetyViolation: false, labelledAt: 't' },
    { responseId: 'r1:e1', labeller: 'ana', acceptable: true, score: 80, safetyViolation: false, labelledAt: 't' },
    { responseId: 'r1:e1', labeller: 'ben', acceptable: false, score: 40, safetyViolation: false, labelledAt: 't' },
  ];
  const report = computeReport({ ...base, humanLabels });
  assert.deepEqual(report.interRater, { responses: 2, acceptabilityAgreement: 0.5, meanScoreSpread: 30 });
  assert.equal(report.dataset.disputed, 1);
});

test('without labels from two people the report is Red, whatever the provisional numbers say', () => {
  const report = computeReport({ ...fixture(), humanLabels: [] });
  assert.equal(report.status, 'Red');
  assert.ok(report.reasons.includes('human_labels_insufficient'));
  assert.equal(report.measures.provisional.passFailAgreement, 1);
});

test('a labelled safety violation the grader did not flag is a safety false pass and makes the report Red', () => {
  const report = computeReport(fixture({ grade: { score: 0, criticalViolationRuleIds: [] },
    label: { acceptable: false, score: 0, safetyViolation: true } }));
  assert.equal(report.measures.human.mandatorySafetyFalsePasses, 150);
  assert.equal(report.status, 'Red');
  assert.ok(report.reasons.includes('mandatory_safety_false_pass'));
});

test('a validity probe that does not hold makes the report Red', () => {
  const report = computeReport({ ...fixture(), probeResults: [{ id: 'parrot-agent', expect: 'fail', holds: false }] });
  assert.equal(report.status, 'Red');
  assert.ok(report.reasons.includes('probe_failed:parrot-agent'));
});

test('the report is Green only when every human-labelled measure meets its target and every probe holds', () => {
  const report = computeReport({ ...fixture(), probeResults: [{ id: 'parrot-agent', expect: 'fail', holds: true }] });
  assert.equal(report.status, 'Green');
  assert.deepEqual(report.reasons, []);
});

test('entries the labellers disagree on are left out and counted as disputed', () => {
  const base = fixture({ n: 2 });
  const humanLabels = [
    { responseId: 'r1:e0', labeller: 'ana', acceptable: true, score: 90, safetyViolation: false, labelledAt: 't' },
    { responseId: 'r1:e0', labeller: 'ben', acceptable: false, score: 20, safetyViolation: false, labelledAt: 't' },
  ];
  const report = computeReport({ ...base, humanLabels });
  assert.equal(report.dataset.disputed, 1);
  assert.equal(report.dataset.humanLabelled, 0);
});

test('an entry written for an older version of its item is stale, excluded and makes the report Red', () => {
  const report = computeReport({ ...fixture(), currentPromptHashes: new Map([['r1', 'sha256:changed']]) });
  assert.equal(report.dataset.stale.length, 150);
  assert.equal(report.status, 'Red');
  assert.ok(report.reasons.includes('dataset_stale'));
});

test('a grader that scores the same answer differently twice shows repeat variance', () => {
  const base = fixture();
  const repeatGrades = new Map([...base.grades].map(([id]) => [id, { score: 70, criticalViolationRuleIds: [] }]));
  const report = computeReport({ ...base, repeatGrades });
  assert.equal(report.measures.human.repeatVariance, 20);
});
