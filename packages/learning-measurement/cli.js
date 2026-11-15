#!/usr/bin/env node
'use strict';

// Measures learning gain on the held-out behaviour items:
//   node packages/learning-measurement/cli.js [--runs N] [--live] [--write]
// Without --live the arms are the scripted safe agent, which ignores notes:
// the run checks the instrument and must report no gain. With --live the
// arms use the live model (OPENCODE_API_KEY, LIVE_MODEL); one run is about
// 36 episodes of several model calls per arm, plus one call per lesson.
// --write saves the report to artifacts/learning-measurement/report.json.

const fs = require('node:fs');
const path = require('node:path');
const { measureLearning } = require('./src/measure');
const { liveArms } = require('./src/live-arms');
const { referenceExam } = require('../grading-validity/src/exam');
const { PANEL } = require('../agent-sandbox/src/panel');

const REPORT = path.join(__dirname, '..', '..', 'artifacts', 'learning-measurement', 'report.json');
// One run gives each arm 36 episodes; three give 108, which narrows the
// interval on a gain to about plus or minus 0.12.
const DEFAULT_RUNS = 1;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const runs = Number(option('--runs', DEFAULT_RUNS));
  const live = process.argv.includes('--live');
  const { pkg, form } = referenceExam();
  let arms;
  let notes = null;
  let agent;
  if (live) {
    const { createLiveModel } = require('../../services/synthetic-agent-learner/live-model');
    const liveModel = createLiveModel({ apiKey: process.env.OPENCODE_API_KEY, ...(process.env.LIVE_MODEL ? { model: process.env.LIVE_MODEL } : {}) });
    if (!liveModel.available) throw new Error('OPENCODE_API_KEY is not set; the live measurement needs the model');
    ({ arms, notes } = await liveArms({ liveModel, pkg, form }));
    agent = { kind: 'live', provider: liveModel.provider, model: liveModel.model };
  } else {
    const safe = PANEL.find((entry) => entry.id === 'safe-agent').agent;
    arms = { 'no-notes': () => safe, 'with-notes': () => safe, 'control-notes': () => safe };
    agent = { kind: 'scripted', id: 'safe-agent', note: 'ignores notes: this run checks the instrument and must show no gain' };
  }
  const report = await measureLearning({ form, arms, runs });
  for (const [name, arm] of Object.entries(report.arms)) {
    process.stdout.write(`${name.padEnd(14)} ${arm.successes}/${arm.episodes} episodes succeeded, rate ${arm.rate} ` +
      `(95% ${arm.low}-${arm.high}), violations ${arm.violations}\n`);
  }
  for (const [name, gain] of Object.entries(report.gains)) {
    process.stdout.write(`gain ${name} over ${report.baseline}: ${gain.difference} (95% ${gain.low} to ${gain.high}) ` +
      `${gain.measured ? 'MEASURED' : 'no measured gain'}\n`);
  }
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify({ schemaVersion: 'learning-measurement/1.0.0', measuredAt: new Date().toISOString(),
      agent, runs, notes, ...report }, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`learning measurement failed: ${error.code || error.message}\n`);
  process.exitCode = 1;
});
