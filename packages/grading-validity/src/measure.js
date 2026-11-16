'use strict';

// Measures the production grader: grades every current dataset entry twice
// through POST /v1/item-grades, runs the validity probes, and builds the
// report. Used by cli.js and by the Sprint 3 gate.
//
// The rubric judge is replayed from dataset/judge-verdicts.v1.json by
// default (no key, no network). With record: true it is called live, and the
// verdicts it gives are written back to that file.

const fs = require('node:fs');
const path = require('node:path');
const { referenceExam } = require('./exam');
const { startGradingRoute } = require('./route');
const { gradeAttempt, gradeEntries } = require('./grade');
const { PROBES, probeAnswers, probeHolds, withConclusiveness } = require('./probes');
const { loadHumanLabels } = require('./labels');
const { computeReport, isCurrent } = require('./report');
const { VERDICTS_FILE, liveJudge, loadVerdicts, replayJudge, saveVerdicts } = require('./verdicts');

const DATASET = path.join(__dirname, '..', 'dataset', 'responses.v1.json');
const LABELS = path.join(__dirname, '..', 'dataset', 'human-labels.json');
// While recording, a batch that failed on a judge call is sent twice more
// before the run stops; the old file is then left as it was.
const RECORD_RETRIES = 2;

async function runProbes(exam, route, entries) {
  const results = [];
  for (const probe of PROBES) {
    const assessment = await gradeAttempt({ exam, route, answers: probeAnswers(probe, entries, exam.form.items) });
    results.push({ id: probe.id, expect: probe.expect, why: probe.why, holds: probeHolds(probe, assessment),
      passed: assessment.passed, overallPercent: assessment.overallPercent, failureReasons: assessment.failureReasons });
  }
  return withConclusiveness(results);
}

// Two routes: the first pass (and the probes) and the repeat pass. Each has
// its own cache, so a recorded repeat is a second live verdict.
async function openRoutes({ record, env, file, fetchImpl }) {
  if (!record) {
    const recorded = loadVerdicts(file);
    const judge = replayJudge(env);
    return { mode: 'replay', judge, usage: null, route: await startGradingRoute({ judge, verdicts: recorded.verdicts }),
      repeatRoute: await startGradingRoute({ judge, verdicts: recorded.repeat }) };
  }
  const { judge, usage } = liveJudge(env, { fetchImpl });
  return { mode: 'record', judge, usage, route: await startGradingRoute({ judge, verdicts: {}, retries: RECORD_RETRIES }),
    repeatRoute: await startGradingRoute({ judge, verdicts: {}, retries: RECORD_RETRIES }) };
}

/**
 * @param {{ record?: boolean, env?: NodeJS.ProcessEnv, file?: string, fetchImpl?: Function }} options
 *   record: call the live judge and rewrite the verdicts file; file: the verdicts file
 * @returns {Promise<object>} the validity report, with the grader, the judge mode and the time measured
 */
async function measure({ record = false, env = process.env, file = VERDICTS_FILE, fetchImpl = fetch } = {}) {
  const exam = referenceExam();
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const humanLabels = loadHumanLabels(LABELS, dataset);
  const current = dataset.entries.filter((entry) => isCurrent(entry, exam.promptHashes));
  const routes = await openRoutes({ record, env, file, fetchImpl });
  try {
    const { grades, grader } = await gradeEntries({ exam, route: routes.route, entries: current });
    const { grades: repeatGrades } = await gradeEntries({ exam, route: routes.repeatRoute, entries: current });
    const probeResults = await runProbes(exam, routes.route, current);
    const report = computeReport({ entries: dataset.entries, currentPromptHashes: exam.promptHashes, grades, repeatGrades,
      humanLabels, probeResults, acceptPercents: exam.acceptPercents });
    if (record) saveVerdicts({ file, model: routes.judge.model, verdicts: routes.route.verdicts(),
      repeat: routes.repeatRoute.verdicts(), usage: { ...routes.usage }, recordedAt: new Date().toISOString() });
    return { ...report, grader, judge: { mode: routes.mode, model: routes.judge.model, usage: routes.usage },
      measuredAt: new Date().toISOString() };
  } finally {
    await Promise.all([routes.route.close(), routes.repeatRoute.close()]);
  }
}

module.exports = { measure };
