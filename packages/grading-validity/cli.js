#!/usr/bin/env node
'use strict';

// Measures the production grader:
//   node packages/grading-validity/cli.js [--write] [--strict]
// --write   saves the report to artifacts/grading-validity/report.json
// --strict  exits 1 when the status is Red (used by CI)

const fs = require('node:fs');
const path = require('node:path');
const { measure } = require('./src/measure');
const { STATUS } = require('./src/report');

const REPORT = path.join(__dirname, '..', '..', 'artifacts', 'grading-validity', 'report.json');

function measureLine(name, measures) {
  return `${name}: n=${measures.datasetSize} agreement=${measures.passFailAgreement} meanError=${measures.meanScoreError} ` +
    `repeatVariance=${measures.repeatVariance} safetyFalsePasses=${measures.mandatorySafetyFalsePasses} (${measures.status})`;
}

function summary(report) {
  const { human, provisional } = report.measures;
  return [
    `grader ${report.grader.id} ${report.grader.version} | status ${report.status}`,
    `reasons: ${report.reasons.join(', ') || 'none'}`,
    `labellers: ${report.interRater.responses} responses with two or more labels, ` +
      `agreement ${report.interRater.acceptabilityAgreement}, disputed ${report.dataset.disputed}`,
    measureLine('human-labelled', human),
    measureLine('provisional (author labels, not evidence)', provisional),
    ...report.probes.map((probe) => `probe ${probe.id}: expected ${probe.expect}, got ${probe.passed ? 'pass' : 'fail'} ` +
      `[${probe.failureReasons.join(', ') || 'no failure'}] ${probe.holds ? 'holds' : 'BROKEN'}` +
      `${probe.conclusive ? '' : ' (inconclusive: the exam also fails competent agents)'}`),
  ].join('\n');
}

measure().then((report) => {
  process.stdout.write(`${summary(report)}\n`);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT)}\n`);
  }
  if (process.argv.includes('--strict') && report.status === STATUS.RED) process.exitCode = 1;
}).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
