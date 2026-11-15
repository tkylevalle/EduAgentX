'use strict';
// Focused checks with safe TAP summaries. Contract fixtures are not deployment
// evidence; unavailable PostgreSQL is recorded NOT_RUN, never converted to PASS.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sourceIdentity } = require('../packages/e2e-suite/run');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts/issue-33', `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const startedAt = new Date().toISOString(), checks = [];
const readTests = directory => fs.readdirSync(path.join(root, directory)).filter(p => p.endsWith('.test.js')).sort().map(p => `${directory}/${p}`);
function run(name, files) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=2', ...files],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const count = key => Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? 0);
  const result = { name, exitCode: r.status, tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'),
    cancelled: count('cancelled'), status: r.status !== 0 || !count('tests') || count('fail') || count('cancelled') ? 'FAIL' : count('skipped') ? 'PARTIAL' : 'PASS' };
  checks.push(result);
  // Failed assertions can contain private fixture bodies. Retain counts only.
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
run('suite', readTests('packages/e2e-suite/test'));
run('execution-provenance', readTests('packages/execution-provenance/test'));
for (const service of ['api-gateway', 'examination-engine', 'certification-service', 'marketplace-service', 'training-service'])
  run(service, readTests(`services/${service}/test`));
for (const [service, variable] of [['examination-engine', 'EXAMINATION_TEST_DATABASE_URL'],
  ['certification-service', 'CERTIFICATION_TEST_DATABASE_URL'], ['marketplace-service', 'MARKETPLACE_TEST_DATABASE_URL'], ['skill-gap-service', 'SKILL_GAP_TEST_DATABASE_URL'], ['training-service', 'TRAINING_TEST_DATABASE_URL']]) {
  if (process.env[variable]) run(`${service}-postgres`, [`services/${service}/integration/${service === 'training-service' ? 'provenance-postgres.test.js' : 'postgres.test.js'}`]);
  else checks.push({ name: `${service}-postgres`, status: 'NOT_RUN', reason: 'disposable_database_not_configured' });
}
const report = { schemaVersion: 'issue-33-focused-verification/1.0.0', startedAt, finishedAt: new Date().toISOString(),
  source: sourceIdentity(), node: process.version, platform: `${process.platform}/${process.arch}`, checks,
  status: checks.some(c => c.status === 'FAIL') ? 'FAIL' : checks.every(c => c.status === 'PASS') ? 'PASS' : 'PARTIAL',
  formal1000: 'NOT_RUN', composedAcceptance: 'NOT_RUN', scope: 'Unit/security/contract checks; fixtures never count as public Compose acceptance.' };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Focused verification: ${report.status}; ${out}`);
process.exitCode = report.status === 'FAIL' ? 1 : 0;
