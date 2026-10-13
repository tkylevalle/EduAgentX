'use strict';

// Grading KPI measurement (Issue #19). Runs the real gradeAnswer() from
// ../src/grader over the committed labelled dataset and compares its
// output against each item's human label, producing the versioned
// evidence report for the five Grading measures in docs/blueprint/spec.md:
//
//   Grading labelled dataset           >= 100 responses, target 150
//   Grading pass/fail agreement        >= 85%,            target 90%
//   Mean grading score error           <= 8 points,       target 5
//   Repeat grading variance            <= 8 points,       target 5
//   Mandatory-safety false passes      0, Invariant
//
// passFailAgreement = items where gradeAnswer().passed matches the item's
//   human.expectedPass, divided by all items.
// meanScoreError = mean absolute difference, in points (0-100), between
//   round(gradeAnswer().score * 100) and the item's human.expectedScore.
// repeatVariance = mean absolute point difference between two independent
//   gradeAnswer() calls on the same item. gradeAnswer is a pure function of
//   its input, so this is expected to measure 0 — a real (non-zero) value
//   would mean grading is not deterministic, which is itself worth knowing.
// mandatorySafetyFalsePasses = items the dataset marks isMandatorySafety
//   with human.expectedPass === false, where gradeAnswer().passed is true
//   anyway. Per spec this is a non-waivable Invariant: any false pass here
//   makes the overall status Red regardless of every other measure.
//
// Run: node services/grading-service/kpi/measure.js [--write]
// --write saves the report to evidence/sprint-3/grading-kpi.json.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gradeAnswer } = require('../src/grader');

const DATASET_PATH = path.join(__dirname, 'grading-dataset.v1.json');
const REPORT_PATH = path.join(__dirname, '../../../evidence/sprint-3/grading-kpi.json');

const THRESHOLDS = {
  datasetSize: { floor: 100, target: 150, better: 'higher' },
  passFailAgreement: { floor: 0.85, target: 0.90, better: 'higher' },
  meanScoreError: { floor: 8, target: 5, better: 'lower' },
  repeatVariance: { floor: 8, target: 5, better: 'lower' },
};
const MANDATORY_SAFETY_FALSE_PASS_LIMIT = 0;

// --- grading one item ------------------------------------------------------

function answerFrom(item) {
  return {
    questionId: item.questionId,
    tier: item.tier,
    response: item.response,
    expectedAnswer: item.expectedAnswer,
    applicableCriticalRules: item.applicableCriticalRules || [],
  };
}

// Grades the item twice (independently) so repeat variance measures an
// actual property of the grader rather than being assumed.
function gradeItem(item) {
  const first = gradeAnswer(answerFrom(item));
  const second = gradeAnswer(answerFrom(item));
  const scorePoints = Math.round(first.score * 100);
  const repeatScorePoints = Math.round(second.score * 100);
  const scoreError = Math.abs(scorePoints - item.human.expectedScore);
  const passAgrees = first.passed === item.human.expectedPass;
  const falsePass = item.human.isMandatorySafety && item.human.expectedPass === false && first.passed === true;
  return {
    id: item.id,
    category: item.category,
    tier: item.tier,
    isMandatorySafety: Boolean(item.human.isMandatorySafety),
    human: item.human,
    graded: { score: scorePoints, passed: first.passed, criticalViolations: first.criticalViolations },
    scoreError,
    passAgrees,
    repeatDiff: Math.abs(scorePoints - repeatScorePoints),
    falsePass,
  };
}

// --- aggregation -------------------------------------------------------------

const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const ratio = (part, whole) => (whole ? part / whole : null);
const round4 = (value) => (value === null ? null : Math.round(value * 10000) / 10000);

function measureStatus(value, { floor, target, better }) {
  if (value === null) return 'Red';
  if (better === 'higher') {
    if (value < floor) return 'Red';
    return value >= target ? 'Green' : 'Amber';
  }
  if (value > floor) return 'Red';
  return value <= target ? 'Green' : 'Amber';
}

function byCategory(results) {
  const categories = [...new Set(results.map((r) => r.category))].sort();
  return Object.fromEntries(categories.map((category) => {
    const rows = results.filter((r) => r.category === category);
    return [category, {
      n: rows.length,
      passFailAgreement: round4(ratio(rows.filter((r) => r.passAgrees).length, rows.length)),
      meanScoreError: round4(mean(rows.map((r) => r.scoreError))),
    }];
  }));
}

function buildReport(dataset, digest, results) {
  const n = results.length;
  const agreeing = results.filter((r) => r.passAgrees).length;
  const falsePasses = results.filter((r) => r.falsePass);

  const measures = {
    datasetSize: { value: n, ...THRESHOLDS.datasetSize },
    passFailAgreement: { value: round4(ratio(agreeing, n)), ...THRESHOLDS.passFailAgreement },
    meanScoreError: { value: round4(mean(results.map((r) => r.scoreError))), ...THRESHOLDS.meanScoreError },
    repeatVariance: { value: round4(mean(results.map((r) => r.repeatDiff))), ...THRESHOLDS.repeatVariance },
  };
  for (const measure of Object.values(measures)) measure.status = measureStatus(measure.value, measure);

  const mandatorySafetyHeld = falsePasses.length === MANDATORY_SAFETY_FALSE_PASS_LIMIT;
  const mandatorySafety = {
    value: falsePasses.length,
    limit: MANDATORY_SAFETY_FALSE_PASS_LIMIT,
    status: mandatorySafetyHeld ? 'Green' : 'Red',
    invariantHeld: mandatorySafetyHeld,
  };

  const statuses = [...Object.values(measures).map((m) => m.status), mandatorySafety.status];
  const status = statuses.includes('Red') ? 'Red' : statuses.includes('Amber') ? 'Amber' : 'Green';

  return {
    kpi: 'grading-labelled-responses',
    formula: 'passFailAgreement = agreeing items / all items; meanScoreError = mean |graded points - ' +
      'human points|; repeatVariance = mean |first graded points - second graded points| over two ' +
      'independent gradeAnswer() calls per item; mandatorySafetyFalsePasses = mandatory-safety items ' +
      'the human failed that gradeAnswer() passed anyway.',
    dataset: { name: dataset.dataset, version: dataset.version, digest, items: n },
    environment: 'grading-service gradeAnswer() from src/grader.js, called directly per labelled item',
    measures,
    mandatorySafetyFalsePasses: mandatorySafety,
    status,
    byCategory: byCategory(results),
    falsePasses: falsePasses.map((r) => ({ id: r.id, category: r.category, graded: r.graded })),
    misses: results.filter((r) => !r.passAgrees).map((r) =>
      ({ id: r.id, category: r.category, expectedPass: r.human.expectedPass, graded: r.graded })),
  };
}

async function measureGrading(datasetPath = DATASET_PATH) {
  const raw = fs.readFileSync(datasetPath);
  const dataset = JSON.parse(raw);
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const results = dataset.items.map(gradeItem);
  return buildReport(dataset, digest, results);
}

if (require.main === module) {
  measureGrading().then((report) => {
    if (process.argv.includes('--write')) {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    }
    const m = report.measures;
    process.stderr.write(`dataset ${m.datasetSize.value} items (${m.datasetSize.status}), ` +
      `agreement ${m.passFailAgreement.value} (${m.passFailAgreement.status}), ` +
      `mean score error ${m.meanScoreError.value} (${m.meanScoreError.status}), ` +
      `repeat variance ${m.repeatVariance.value} (${m.repeatVariance.status}), ` +
      `mandatory-safety false passes ${report.mandatorySafetyFalsePasses.value} ` +
      `(${report.mandatorySafetyFalsePasses.status}) -- overall ${report.status}\n`);
    process.exitCode = report.status === 'Red' ? 1 : 0;
  }, (error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = { THRESHOLDS, MANDATORY_SAFETY_FALSE_PASS_LIMIT, REPORT_PATH, measureStatus, measureGrading };
