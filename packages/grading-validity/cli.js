#!/usr/bin/env node
'use strict';

// Measures the production grader:
//   node packages/grading-validity/cli.js [--write] [--strict] [--record]
// --write   saves the report to artifacts/grading-validity/report.json
// --strict  exits 1 when the status is Red (used by CI)
// --record  calls the live rubric judge (JUDGE_API_KEY or OPENCODE_API_KEY,
//           JUDGE_MODEL, JUDGE_MODEL_URL) and rewrites
//           dataset/judge-verdicts.v1.json; without it the recorded verdicts
//           are replayed, with no key and no network

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
    `judge ${report.judge.mode} ${report.judge.model}${report.judge.usage ? ` | ${report.judge.usage.calls} calls, ` +
      `${report.judge.usage.promptTokens} prompt + ${report.judge.usage.completionTokens} completion tokens` : ''}`,
    `reasons: ${report.reasons.join(', ') || 'none'}`,
    ...(report.signOff ? [`sign-off: ${report.signOff.reviewers.join(' and ')} on ${report.signOff.signedOn}; accepted ` +
      `${report.signOff.acceptedReasons.join(', ')}; ${report.signOff.note}`] : []),
    `labellers: ${report.interRater.responses} responses with two or more labels, ` +
      `agreement ${report.interRater.acceptabilityAgreement}, disputed ${report.dataset.disputed}`,
    measureLine('human-labelled', human),
    measureLine('provisional (author labels, not evidence)', provisional),
    ...report.probes.map((probe) => `probe ${probe.id}: expected ${probe.expect}, got ${probe.passed ? 'pass' : 'fail'} ` +
      `[${probe.failureReasons.join(', ') || 'no failure'}] ${probe.holds ? 'holds' : 'BROKEN'}` +
      `${probe.conclusive ? '' : ' (inconclusive: the exam also fails competent agents)'}`),
  ].join('\n');
}

measure({ record: process.argv.includes('--record') }).then((report) => {
  process.stdout.write(`${summary(report)}\n`);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT)}\n`);
  }
  if (process.argv.includes('--strict') && report.status === STATUS.RED) process.exitCode = 1;
}).catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
