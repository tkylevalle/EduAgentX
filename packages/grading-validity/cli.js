#!/usr/bin/env node
'use strict';

// Measures the production grader:
//   node packages/grading-validity/cli.js [--write] [--strict]
// --write   saves the report to artifacts/grading-validity/report.json
// --strict  exits 1 when the status is Red (used by CI)

const fs = require('node:fs');
const path = require('node:path');
const { referenceExam } = require('./src/exam');
const { startGradingRoute } = require('./src/route');
const { gradeAttempt, gradeEntries } = require('./src/grade');
const { PROBES, probeAnswers, probeHolds } = require('./src/probes');
const { loadHumanLabels } = require('./src/labels');
const { computeReport } = require('./src/report');

const DATASET = path.join(__dirname, 'dataset', 'responses.v1.json');
const LABELS = path.join(__dirname, 'dataset', 'human-labels.json');
const REPORT = path.join(__dirname, '..', '..', 'artifacts', 'grading-validity', 'report.json');

async function runProbes(exam, route, entries) {
  const results = [];
  for (const probe of PROBES) {
    const assessment = await gradeAttempt({ exam, route, answers: probeAnswers(probe, entries) });
    results.push({ id: probe.id, expect: probe.expect, why: probe.why, holds: probeHolds(probe, assessment),
      passed: assessment.passed, overallPercent: assessment.overallPercent, failureReasons: assessment.failureReasons });
  }
  return results;
}

async function measure() {
  const exam = referenceExam();
  const { entries } = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const humanLabels = loadHumanLabels(LABELS, entries);
  const route = await startGradingRoute();
  try {
    const { grades, grader } = await gradeEntries({ exam, route, entries });
    const { grades: repeatGrades } = await gradeEntries({ exam, route, entries });
    const probeResults = await runProbes(exam, route, entries);
    const report = computeReport({ entries, grades, repeatGrades, humanLabels, probeResults,
      currentPromptHashes: new Map(exam.form.items.map((item) => [item.slotId, item.promptSha256])),
      acceptPercent: exam.pkg.examTemplate.overallPassPercent });
    return { ...report, grader, measuredAt: new Date().toISOString() };
  } finally {
    await route.close();
  }
}

function summary(report) {
  const { human, provisional } = report.measures;
  const line = (name, m) => `${name}: n=${m.datasetSize} agreement=${m.passFailAgreement} meanError=${m.meanScoreError} ` +
    `repeatVariance=${m.repeatVariance} safetyFalsePasses=${m.mandatorySafetyFalsePasses} (${m.status})`;
  return [
    `grader ${report.grader.id} ${report.grader.version} | status ${report.status}`,
    `reasons: ${report.reasons.join(', ') || 'none'}`,
    line('human-labelled', human),
    line('provisional (author labels, not evidence)', provisional),
    ...report.probes.map((probe) => `probe ${probe.id}: expected ${probe.expect}, got ${probe.passed ? 'pass' : 'fail'} ` +
      `[${probe.failureReasons.join(', ') || 'no failure'}] ${probe.holds ? 'OK' : 'BROKEN'}`),
  ].join('\n');
}

if (require.main === module) {
  measure().then((report) => {
    process.stdout.write(`${summary(report)}\n`);
    if (process.argv.includes('--write')) {
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT)}\n`);
    }
    if (process.argv.includes('--strict') && report.status === 'Red') process.exitCode = 1;
  }).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { measure, summary };
