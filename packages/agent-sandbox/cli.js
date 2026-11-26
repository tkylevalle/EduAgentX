#!/usr/bin/env node
'use strict';

// Runs the reference agent panel through the sandbox:
//   node packages/agent-sandbox/cli.js [--write] [--strict]
// --write   saves the results to artifacts/agent-sandbox/panel-report.json
// --strict  exits 1 when the sandbox passes a bad agent or fails the safe one

const fs = require('node:fs');
const path = require('node:path');
const { runPanel } = require('./src/panel');
const { DOMAINS, POOLS } = require('./src/families');

// Twelve seeds per family gives each objective at least 12 episodes, enough
// for a perfect record to clear the 0.7 lower bound (it needs 9).
const EPISODES_PER_FAMILY = 12;
const REPORT = path.join(__dirname, '..', '..', 'artifacts', 'agent-sandbox', 'panel-report.json');

// Every domain's panel on both pools: the exam pool is the one certification
// uses; the practice pool shows the verdicts do not depend on the held-out wording.
const results = Object.keys(DOMAINS).flatMap((domain) => POOLS.flatMap((pool) =>
  runPanel({ episodesPerFamily: EPISODES_PER_FAMILY, pool, domain }).map((result) => ({ domain, pool, ...result }))));
for (const result of results) {
  const rates = result.objectives.map((objective) => `${objective.objectiveId} ${objective.successes}/${objective.n} (low ${objective.interval.low.toFixed(2)})`).join(', ');
  process.stdout.write(`${result.holds ? 'holds ' : 'BROKEN'} ${result.domain.padEnd(16)} ${result.pool.padEnd(8)} ${result.agent.padEnd(22)} expected ${result.expect.padEnd(4)} ` +
    `got ${result.passed ? 'pass' : 'fail'} | ${rates} | violations ${result.violations}/${result.n}` +
    ` [${result.violationRuleIds.join(', ')}], rate <= ${(result.violationRateUpperBound * 100).toFixed(1)}% (95%)\n`);
}
const broken = results.filter((result) => !result.holds);
process.stdout.write(`panel: ${broken.length ? `BROKEN (${broken.map((result) => `${result.domain}/${result.pool}/${result.agent}`).join(', ')})` : 'every agent got its expected outcome'}\n`);
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify({ schemaVersion: 'agent-sandbox-panel/1.0.0', measuredAt: new Date().toISOString(),
    episodesPerFamily: EPISODES_PER_FAMILY, results }, null, 2)}\n`);
  process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT)}\n`);
}
if (process.argv.includes('--strict') && broken.length) process.exitCode = 1;
