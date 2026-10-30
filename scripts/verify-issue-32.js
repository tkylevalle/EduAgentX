'use strict';
// Focused, reproducible verification. Does not claim the cumulative Sprint 5 gate.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/issue-32');
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n')
  .filter(p => /^(services|packages|scripts|db)\//.test(p) || ['docker-compose.yml','.env.example'].includes(p)).sort();
const source = createHash('sha256');
for (const file of files) { source.update(file); source.update('\0'); source.update(fs.readFileSync(path.join(root,file))); }
const checks = [];
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  const logPath = `${name}.tap`;
  fs.writeFileSync(path.join(output,logPath),log);
  const count = (key) => Number(log.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1] ?? 0);
  const status = result.status !== 0 || count('tests') === 0 || count('fail') > 0 ? 'FAIL' : count('skipped') > 0 ? 'PARTIAL' : 'PASS';
  checks.push({ name,status,exitCode:result.status,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),log:logPath });
  console.log(`${name}: ${status} (${count('pass')} passed, ${count('fail')} failed, ${count('skipped')} skipped)`);
}
for (const component of ['skill-gap-service','api-gateway','training-service','examination-engine','marketplace-service','grading-service']) {
  const directory = `services/${component}/test`;
  run(component,['--test','--test-reporter=tap','--test-concurrency=2',...fs.readdirSync(path.join(root,directory))
    .filter(p=>p.endsWith('.test.js')).sort().map(p=>`${directory}/${p}`)]);
}
if (process.env.SKILL_GAP_TEST_DATABASE_URL) run('postgres',['--test','--test-reporter=tap','services/skill-gap-service/integration/postgres.test.js']);
else checks.push({ name: 'postgres', status: 'NOT_RUN', reason: 'SKILL_GAP_TEST_DATABASE_URL not configured; requires fresh disposable database' });
const report = { schemaVersion:'issue-32-verification/1.0.0',startedAt,finishedAt:new Date().toISOString(),
  sourceRevision:git('rev-parse','HEAD'),sourceFingerprint:`sha256:${source.digest('hex')}`,node:process.version,
  platform:`${process.platform}/${process.arch}`,checks,
  status:checks.some(c=>c.status==='FAIL')?'FAIL':checks.some(c=>c.status!=='PASS')?'PARTIAL':'PASS',
  scope:'Affected-service tests and optional isolated PostgreSQL check; injected authorities in public contract tests.',
  cumulativeSprintGate:'NOT_RUN',realCertificationToMarketplaceDemonstration:'NOT_VERIFIED' };
fs.writeFileSync(path.join(output,'report.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(`Evidence: ${path.join(output,'report.json')}`);
process.exitCode=report.status==='FAIL'?1:0;
