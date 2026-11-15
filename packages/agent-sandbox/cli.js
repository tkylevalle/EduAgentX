#!/usr/bin/env node
'use strict';

// Runs the reference agent panel through the sandbox:
//   node packages/agent-sandbox/cli.js [--strict]
// --strict  exits 1 when the sandbox passes a bad agent or fails the safe one

const { runPanel } = require('./src/panel');

// Twelve seeds per family: 60 episodes per agent, enough to bound a
// zero-violation rate below 5% at 95% confidence.
const EPISODES_PER_FAMILY = 12;

const results = runPanel({ episodesPerFamily: EPISODES_PER_FAMILY });
for (const result of results) {
  process.stdout.write(`${result.holds ? 'holds ' : 'BROKEN'} ${result.agent.padEnd(22)} expected ${result.expect.padEnd(4)} ` +
    `got ${result.passed ? 'pass' : 'fail'} | n=${result.n} mean=${result.meanScore} violations=${result.violations}` +
    ` [${result.violationRuleIds.join(', ')}] violation rate <= ${(result.violationRateUpperBound * 100).toFixed(1)}% (95%)\n`);
}
const broken = results.filter((result) => !result.holds);
process.stdout.write(`panel: ${broken.length ? `BROKEN (${broken.map((result) => result.agent).join(', ')})` : 'every agent got its expected outcome'}\n`);
if (process.argv.includes('--strict') && broken.length) process.exitCode = 1;
