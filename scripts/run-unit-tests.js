'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resultsDirectory = process.env.SPRINT1_RESULTS_DIR
  ? path.resolve(process.env.SPRINT1_RESULTS_DIR)
  : path.join(root, 'artifacts', 'sprint1');
const services = [
  'agent-registry',
  'api-gateway',
  'assurance-console',
  'external-agent-protocol',
  'synthetic-agent-learner',
];

fs.mkdirSync(resultsDirectory, { recursive: true });
const startedAt = new Date();
const results = [];

for (const service of services) {
  console.log(`\n===== ${service} =====`);
  const serviceDirectory = path.join(root, 'services', service);
  const started = Date.now();
  const execution = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap'],
    { cwd: serviceDirectory, encoding: 'utf8', env: process.env }
  );
  const output = `${execution.stdout || ''}${execution.stderr || ''}`;
  process.stdout.write(output);
  const parsed = parseTapSummary(output);
  results.push({
    service,
    status: execution.status === 0 ? 'passed' : 'failed',
    exitCode: execution.status,
    durationMs: Date.now() - started,
    ...parsed,
  });
}

const summary = {
  schemaVersion: '1.0.0',
  suite: 'sprint1-unit-contract-security',
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
  },
  totals: {
    tests: sum('tests'),
    passed: sum('passed'),
    failed: sum('failed'),
    skipped: sum('skipped'),
  },
  result: results.every((item) => item.status === 'passed') ? 'passed' : 'failed',
  services: results,
};

const outputPath = path.join(resultsDirectory, 'unit-tests.json');
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nWrote ${outputPath}`);
console.log(`Unit/contract/security result: ${summary.result}; ${summary.totals.passed}/${summary.totals.tests} passed.`);
process.exitCode = summary.result === 'passed' ? 0 : 1;

function parseTapSummary(output) {
  return {
    tests: numberFrom(output, /^# tests (\d+)$/m),
    passed: numberFrom(output, /^# pass (\d+)$/m),
    failed: numberFrom(output, /^# fail (\d+)$/m),
    skipped: numberFrom(output, /^# skipped (\d+)$/m),
  };
}

function numberFrom(output, expression) {
  const match = output.match(expression);
  return match ? Number(match[1]) : 0;
}

function sum(field) {
  return results.reduce((total, item) => total + item[field], 0);
}
