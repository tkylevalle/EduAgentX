'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { manifest, select } = require('./manifest');
const { PublicClient, createPacer } = require('./client');
const { SuiteError, createOrchestrator, setupPackage, runScenarios } = require('./lifecycle');
const { buildReport, writeEvidence } = require('./report');
const { principalsFor } = require('./executor');
const oracle = require('./oracle');
const { createJournal } = require('./checkpoint');
const root = path.resolve(__dirname, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function sourceIdentity() {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(p =>
    /^(services|packages|scripts|db|monitoring|\.github|docs\/(sprint-5|contracts|blueprint))\//.test(p) ||
    ['docker-compose.yml', '.env.example', '.dockerignore', '.gitattributes', 'Makefile'].includes(p)).sort();
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(root, file))); }
  return { gitSha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, fingerprint: `sha256:${hash.digest('hex')}` };
}
function provision(file, { includeCohort = false } = {}) {
  // This is configuration for the REAL existing token issuer, not tokens or
  // synthetic credential evidence. Secrets have no deterministic public seed.
  fs.writeFileSync(file, JSON.stringify([...manifest.scenarios, ...(includeCohort ? require('./cohort').scenarios : [])].map(s => ({ clientId: s.clientId, clientSecret: randomBytes(32).toString('hex') }))),
    { mode: 0o600, flag: 'wx' });
}
async function execute({ mode = 'developer', directory, blocked, env = process.env, onResult = () => {} } = {}) {
  const selected = select(mode), source = sourceIdentity(), startedAt = new Date().toISOString();
  const journal = createJournal(directory, { source });
  const base = { mode, selected, source, startedAt, environment: { project: env.E2E_PROJECT || 'not_started', node: process.version,
    platform: `${process.platform}/${process.arch}`, configHash: env.E2E_CONFIG_HASH, imageHash: env.E2E_IMAGE_HASH,
    responseDeadlineMinutes: Number(env.E2E_DEADLINE_MINUTES || 60), seam: 'public_compose' } };
  let results = [], latencies = [], blockers = [], notRun = [], runErrors = [];
  if (blocked) { blockers.push(blocked); notRun.push('compose_canary', 'category_canaries', 'developer_pilot', 'postgres_integrations', 'formal_1000'); }
  else {
    try {
      if (!env.E2E_GATEWAY_URL || !env.E2E_CLIENTS_PATH) throw new Error('suite_configuration_missing');
      const roster = JSON.parse(fs.readFileSync(env.E2E_CLIENTS_PATH, 'utf8'));
      const pace = createPacer();
      const client = (clientId, clientSecret) => new PublicClient({ gatewayUrl: env.E2E_GATEWAY_URL, clientId, clientSecret,
        pace, onLatency: item => latencies.push(item) });
      const admin = client(env.ADMIN_CLIENT_ID, env.ADMIN_CLIENT_SECRET);
      const reviewers = [1, 2].map(i => client(env[`REVIEWER_${i}_CLIENT_ID`], env[`REVIEWER_${i}_CLIENT_SECRET`]));
      const pkg = await setupPackage({ admin, reviewers });
      const orchestrator = createOrchestrator({ admin, actor: env.ADMIN_CLIENT_ID, pkg, authoritativeExecution: true });
      const clientFor = s => {
        const entry = roster.find(r => r.clientId === s.clientId);
        if (!entry) throw new Error('explicit_identity_missing');
        return client(entry.clientId, entry.clientSecret);
      };
      results = await runScenarios(selected, { orchestrator, clientFor, concurrency: 4, onLifecycle: r => journal.write('lifecycle', r) });
      for (const r of results) {
        r.oracle = oracle.compare(selected.find(s => s.id === r.scenarioId), r.observed, r.marketplace);
        if (r.status === 'CONFORMANT' && r.oracle.status !== 'CONFORMANT') {
          r.status = r.oracle.status; r.reason = 'independent_oracle';
        }
        journal.write('final', r); onResult(r);
      }
      blockers = [...new Set(results.filter(r => r.status === 'BLOCKED').map(r => r.reason))];
      notRun = ['full_marketplace_golden', 'marketplace_1000_candidate_load', 'real_system_abort_fault', 'grading_after_deadline_fault',
        ...(mode !== 'formal' ? ['formal_1000'] : [])];
    } catch (error) {
      const status = error instanceof SuiteError ? error.status : 'HARNESS_ERROR';
      const reason = error instanceof SuiteError ? error.reason : 'suite_setup_error';
      runErrors.push({ status, reason });
      if (status === 'BLOCKED') blockers.push(reason);
      notRun.push('lifecycle_execution', 'formal_1000');
    }
  }
  if (sourceIdentity().fingerprint !== source.fingerprint) runErrors.push({ status: 'HARNESS_ERROR', reason: 'source_changed_during_run' });
  journal.close();
  const report = buildReport({ ...base, results, latencies, blockers, notRun, runErrors,
    reproduction: `python3 scripts/run-sprint5.py --mode ${mode === 'rehearsal' ? 'rehearsal --rehearsal-approved' : mode === 'formal' ? 'formal --formal-approved --golden-v2-approved' :
      `developer --developer-deadline-minutes ${Number(env.E2E_DEADLINE_MINUTES || 60)}${['canary', 'categories'].includes(mode) ? ` --stop-after ${mode}` : ''}`}` });
  writeEvidence(directory, report);
  return report;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  if (args.includes('--provision')) provision(value('--provision'), { includeCohort: args.includes('--with-cohort') });
  else if (args.includes('--enrollments')) fs.writeFileSync(value('--enrollments'), JSON.stringify(principalsFor([
    ...manifest.scenarios, ...(args.includes('--with-cohort') ? require('./cohort').scenarios : [])])), { mode: 0o600, flag: 'wx' });
  else if (args.includes('--manifest')) process.stdout.write(JSON.stringify(manifest));
  else execute({ mode: args.includes('--mode') ? value('--mode') : 'developer',
    directory: process.env.E2E_OUTPUT_DIR || path.join(root, 'artifacts/issue-33', `manual-${Date.now()}-${process.pid}`),
    blocked: args.includes('--blocked') ? value('--blocked') : null,
    onResult: r => console.log(`${r.scenarioId}: lifecycle=${r.lifecycleStatus} scenario=${r.status}`) }).then(report => {
      console.log(JSON.stringify({ technicalChecks: report.technicalChecks, formalAcceptance: report.formalAcceptance,
        executed: report.executed, counts: report.counts, lifecycleConformant: report.lifecycleConformant }));
      process.exitCode = report.technicalChecks === 'FAIL' ? 1 : report.technicalChecks === 'BLOCKED' ? 2 : 0;
    }).catch(() => { console.error('issue33_runner_error'); process.exitCode = 1; });
}
module.exports = { provision, sourceIdentity, execute };
