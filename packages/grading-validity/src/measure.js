'use strict';

// Measures the production grader: grades every current dataset entry twice
// through POST /v1/item-grades, runs the validity probes, and builds the
// report. Used by cli.js and by the Sprint 3 gate.

const fs = require('node:fs');
const path = require('node:path');
const { referenceExam } = require('./exam');
const { startGradingRoute } = require('./route');
const { gradeAttempt, gradeEntries } = require('./grade');
const { PROBES, probeAnswers, probeHolds, withConclusiveness } = require('./probes');
const { loadHumanLabels } = require('./labels');
const { computeReport, isCurrent } = require('./report');

const DATASET = path.join(__dirname, '..', 'dataset', 'responses.v1.json');
const LABELS = path.join(__dirname, '..', 'dataset', 'human-labels.json');

async function runProbes(exam, route, entries) {
  const results = [];
  for (const probe of PROBES) {
    const assessment = await gradeAttempt({ exam, route, answers: probeAnswers(probe, entries, exam.form.items) });
    results.push({ id: probe.id, expect: probe.expect, why: probe.why, holds: probeHolds(probe, assessment),
      passed: assessment.passed, overallPercent: assessment.overallPercent, failureReasons: assessment.failureReasons });
  }
  return withConclusiveness(results);
}

/**
 * A deterministic grader repeats exactly; the second run checks that. A
 * non-deterministic judge needs more runs (target design 4.4).
 * @returns {Promise<object>} the validity report, with the grader and the time measured
 */
async function measure() {
  const exam = referenceExam();
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const humanLabels = loadHumanLabels(LABELS, dataset);
  const current = dataset.entries.filter((entry) => isCurrent(entry, exam.promptHashes));
  const route = await startGradingRoute();
  try {
    const { grades, grader } = await gradeEntries({ exam, route, entries: current });
    const { grades: repeatGrades } = await gradeEntries({ exam, route, entries: current });
    const probeResults = await runProbes(exam, route, current);
    const report = computeReport({ entries: dataset.entries, currentPromptHashes: exam.promptHashes, grades, repeatGrades,
      humanLabels, probeResults, acceptPercents: exam.acceptPercents });
    return { ...report, grader, measuredAt: new Date().toISOString() };
  } finally {
    await route.close();
  }
}

module.exports = { measure };
