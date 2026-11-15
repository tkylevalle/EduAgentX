'use strict';
// Real public workflows plus stop/start of ONLY the runner-owned grader.
// No service internals, forged grading, database access, or clock changes.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { manifest } = require('./manifest');
const { command } = require('./identity');
const { PublicClient, createPacer, poll, sleep } = require('./client');
const { createOrchestrator, setupPackage, requireReply, SuiteError } = require('./lifecycle');
const { sourceIdentity } = require('./run');
const { safeScenario } = require('./report');
const RETRY_MS = 900000; // Current contract; not configurable by this harness.
function assert(checks, id, passed) {
  checks.push({ id, passed: passed === true });
  if (passed !== true) throw new SuiteError('MISMATCH', id);
}
function controlArguments(env, operation) {
  if (!['stop', 'start'].includes(operation) || env.E2E_FAULT_CONTROL !== 'isolated-grader-only' ||
      !/^eduagentx-issue33-[a-z0-9-]+-faults$/.test(env.E2E_PROJECT || '') ||
      !path.isAbsolute(env.E2E_COMPOSE_FILE || '')) throw new Error('isolated_fault_control_required');
  const config = JSON.parse(fs.readFileSync(env.E2E_COMPOSE_FILE, 'utf8'));
  if (config.name !== env.E2E_PROJECT || Object.values(config.services).some(s => s.container_name) ||
      ['volumes', 'networks'].some(g => Object.values(config[g] || {}).some(v => v.name || v.external)))
    throw new Error('private_project_required');
  return ['compose', '-p', env.E2E_PROJECT, '-f', env.E2E_COMPOSE_FILE, operation, 'grading-service'];
}
async function control(env, operation) {
  await promisify(execFile)('docker', controlArguments(env, operation), { env, timeout: 60000, maxBuffer: 1024 * 1024 });
}
function faultWindow({ earliestAcceptedAt, latestAcceptedAt, deadlineAt }) {
  if (![earliestAcceptedAt, latestAcceptedAt, Date.parse(deadlineAt)].every(Number.isFinite) || earliestAcceptedAt > latestAcceptedAt)
    throw new Error('invalid_observation_bounds');
  return { earliestAbortAt: earliestAcceptedAt + RETRY_MS, observeUntil: latestAcceptedAt + RETRY_MS + 60000,
    postDeadlineAt: Date.parse(deadlineAt) + 1500 };
}
async function faultScenarios({ orchestrator, clientFor, admin, env, checks, mappings, now = Date.now, wait = sleep, serviceControl = control }) {
  const competent = n => manifest.scenarios.find(s => s.id === `competent-00${n}`);
  const prepare = async s => {
    const ctx = await orchestrator.prepare(s, clientFor(s));
    if (ctx.result.finishedAt) throw new SuiteError(ctx.result.status, ctx.result.reason);
    const a = ctx.current.attempt;
    mappings.push({ scenarioId: s.id, attemptId: a.attemptId, startedAt: a.startedAt, deadlineAt: a.deadlineAt });
    return ctx;
  };
  const view = async ctx => requireReply(await admin.call('GET', `/v1/admin/examinations/${ctx.current.attempt.attemptId}`,
    undefined, ctx.correlationId), [200], 'fault_authoritative_read').attempt;
  const inventory = async ctx => requireReply(await admin.call('GET', `/v1/admin/reconciliation/credentials?${new URLSearchParams({
    examinationId: ctx.current.attempt.attemptId })}`, undefined, ctx.correlationId), [200], 'fault_credential_inventory');
  const until = async target => { while (now() < target) await wait(Math.min(5000, target - now())); };
  let stopped = false;
  try {
    await serviceControl(env, 'stop'); stopped = true;
    const outage = await prepare(competent(4));
    const initial = await view(outage);
    assert(checks, 'outage_all_15_timely', initial.responsesReceived === 15 && initial.responseCollectionComplete && now() < Date.parse(initial.deadlineAt));
    assert(checks, 'outage_initially_in_progress', initial.status === 'in_progress');
    const bounds = faultWindow({ earliestAcceptedAt: outage.current.lastSentAt,
      latestAcceptedAt: outage.current.lastAcceptedAt, deadlineAt: initial.deadlineAt });
    const timeout = await prepare(manifest.scenarios.find(s => s.variant === 'timing-out'));
    const unavailable = await prepare(manifest.scenarios.find(s => s.variant === 'unavailable'));
    // Park complete answers through the REAL 15-minute retry period. The
    // response deadline alone must never turn them into a learner failure.
    let samples = 0, lastInProgressAt = null;
    while (now() < bounds.earliestAbortAt - 90000) {
      const a = await view(outage);
      assert(checks, `outage_retry_sample_${samples++}`, a.status === 'in_progress' && a.responseCollectionComplete);
      lastInProgressAt = new Date(now()).toISOString();
      await wait(Math.min(30000, Math.max(1, bounds.earliestAbortAt - 90000 - now())));
    }
    const late = await prepare(competent(5));
    assert(checks, 'late_all_15_timely', late.current.attempt.responsesReceived === 15 &&
      late.current.attempt.responseCollectionComplete && now() < Date.parse(late.current.attempt.deadlineAt));
    await until(Date.parse(late.current.attempt.deadlineAt) + 1500);
    assert(checks, 'late_remains_in_progress_after_deadline', (await view(late)).status === 'in_progress');
    for (const [name, ctx, count] of [['partial', timeout, 3], ['unavailable', unavailable, 0]]) {
      const a = await view(ctx);
      assert(checks, `${name}_learner_timeout`, a.status === 'agent_failed' && a.terminalReason === 'response_deadline_elapsed' && a.responsesReceived === count);
      assert(checks, `${name}_no_credential`, (await inventory(ctx)).count === 0);
    }
    const terminal = await poll(() => view(outage), a => {
      if (a.status === 'in_progress') return false;
      assert(checks, 'outage_not_aborted_before_retry_window', now() >= bounds.earliestAbortAt &&
        Date.parse(a.abortedAt) >= bounds.earliestAbortAt);
      return true;
    }, { deadline: bounds.observeUntil, now, wait });
    if (!terminal) throw new SuiteError('BLOCKED', 'real_retry_window_observation_timeout');
    assert(checks, 'outage_system_aborted_grading_unavailable', terminal.status === 'system_aborted' && terminal.terminalReason === 'grading_unavailable' && terminal.assessment === null);
    assert(checks, 'outage_no_credential', (await inventory(outage)).count === 0);
    await serviceControl(env, 'start'); stopped = false;
    const graded = await poll(() => view(late), a => a.status !== 'in_progress', { deadline: now() + 120000, now, wait });
    assert(checks, 'post_deadline_trusted_grading_complete', graded?.status === 'complete' && graded.terminalReason === 'valid_passing_result' &&
      Date.parse(graded.completedAt) > Date.parse(graded.deadlineAt) && graded.assessment?.passed === true);
    assert(checks, 'outage_terminal_immutable_after_recovery', (await view(outage)).status === 'system_aborted');
    const cert = await poll(() => inventory(late), r => r.count > 0, { deadline: now() + 120000, now, wait });
    assert(checks, 'post_deadline_exactly_one_credential', cert?.count === 1);
    assert(checks, 'outage_still_no_credential_after_recovery', (await inventory(outage)).count === 0);
    return { retryWindowMs: RETRY_MS, responseDeadlineMinutes: Number(env.E2E_DEADLINE_MINUTES),
      timingScope: 'accelerated_response_deadline_real_default_grading_retry_window', retrySamples: samples, lastInProgressAt,
      outageLastSubmissionSentAt: new Date(outage.current.lastSentAt).toISOString(),
      outageAllResponsesAcknowledgedAt: new Date(outage.current.lastAcceptedAt).toISOString(),
      earliestAbortAt: new Date(bounds.earliestAbortAt).toISOString(),
      lateAllResponsesAcknowledgedAt: new Date(late.current.lastAcceptedAt).toISOString(),
      outageAbortedAt: terminal.abortedAt, lateCompletedAt: graded.completedAt, lateDeadlineAt: graded.deadlineAt,
      duplicateCredentials: Math.max(0, cert.count - 1) };
  } finally { if (stopped) await serviceControl(env, 'start'); }
}
async function execute({ kind, env = process.env, directory = env.E2E_OUTPUT_DIR } = {}) {
  if (!['default-duration', 'stress', 'faults'].includes(kind)) throw new Error('unknown_phase2_case');
  const source = sourceIdentity(), startedAt = new Date().toISOString(), checks = [], mappings = [], results = [];
  const pace = createPacer({ burstSize: kind === 'stress' ? 8 : 1 }), roster = JSON.parse(fs.readFileSync(env.E2E_CLIENTS_PATH, 'utf8'));
  const make = (id, secret) => new PublicClient({ gatewayUrl: env.E2E_GATEWAY_URL, clientId: id, clientSecret: secret, pace });
  const admin = make(env.ADMIN_CLIENT_ID, env.ADMIN_CLIENT_SECRET);
  const clientFor = s => { const r = roster.find(r => r.clientId === s.clientId); if (!r) throw new Error('identity_missing'); return make(r.clientId, r.clientSecret); };
  let details = {}, status = 'PASS', reason = null;
  try {
    const pkg = await setupPackage({ admin, reviewers: [1, 2].map(i => make(env[`REVIEWER_${i}_CLIENT_ID`], env[`REVIEWER_${i}_CLIENT_SECRET`])) });
    const orchestrator = createOrchestrator({ admin, actor: env.ADMIN_CLIENT_ID, pkg, stressConcurrency: kind === 'stress' ? 8 : 1, authoritativeExecution: true });
    if (kind === 'faults') details = await faultScenarios({ orchestrator, admin, clientFor, env, checks, mappings });
    else {
      const cohort = [], contexts = [];
      for (const s of [manifest.scenarios[0], ...(kind === 'stress' ? [manifest.scenarios.find(s => s.category === 'remediable')] : [])]) {
        const ctx = await orchestrator.prepare(s, clientFor(s));
        if (ctx.result.finishedAt) { results.push(safeScenario(ctx.result)); throw new SuiteError(ctx.result.status, ctx.result.reason); }
        if (!ctx.result.finishedAt && kind === 'default-duration') assert(checks, 'default_sixty_minute_admission',
          Date.parse(ctx.current.attempt.deadlineAt) - Date.parse(ctx.current.attempt.startedAt) === 3600000);
        contexts.push(ctx);
        await orchestrator.observe(ctx);
        assert(checks, `${s.category}_core_lifecycle`, ctx.result.lifecycleStatus === 'CONFORMANT');
        // Earlier passing credentials remain projected after listing withdrawal.
        // They are expected exclusions in the next learner's point-in-time view.
        cohort.push(s.learnerId);
        await orchestrator.market(ctx, cohort);
        results.push(safeScenario(ctx.result));
        assert(checks, `${s.category}_no_observed_duplicates`, Object.values(ctx.result.duplicates).every(n => n === 0));
        assert(checks, `${s.category}_no_failed_invariant`, !ctx.result.checks.some(c => c.passed === false));
      }
      for (const ctx of contexts) await orchestrator.reconcile(ctx);
      assert(checks, 'final_inventory_reconciled', contexts.every(ctx => ctx.result.reconciliation?.status === 'CONFORMANT'));
      results.splice(0, results.length, ...contexts.map(ctx => safeScenario(ctx.result)));
    }
  } catch (error) { status = error instanceof SuiteError && error.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL'; reason = error instanceof SuiteError ? error.reason : 'phase2_execution_error'; }
  if (sourceIdentity().fingerprint !== source.fingerprint) { status = 'FAIL'; reason = 'source_changed_during_run'; }
  const report = { schemaVersion: 'issue-33-phase2/1.0.0', label: 'NOT FORMAL ISSUE #33 ACCEPTANCE', kind, status, reason,
    source, startedAt, finishedAt: new Date().toISOString(), checks, mappings, results, details,
    environment: { project: env.E2E_PROJECT, configHash: env.E2E_CONFIG_HASH, imageHash: env.E2E_IMAGE_HASH,
      responseDeadlineMinutes: Number(env.E2E_DEADLINE_MINUTES), gradingRetryWindowMs: RETRY_MS },
    formal1000: 'NOT_RUN', formalGolden100: 'NOT_RUN', concurrentCertificationIssuance: 'NOT_MEASURABLE_THROUGH_PUBLIC_COMMAND',
    reproduction: `python3 scripts/run-sprint5.py --mode phase2 --phase2-case ${kind}` };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const { createHash } = require('node:crypto');
  fs.writeFileSync(path.join(directory, 'artifact-manifest.json'), JSON.stringify({ schemaVersion: '1.0.0', artifacts: {
    'report.json': createHash('sha256').update(fs.readFileSync(path.join(directory, 'report.json'))).digest('hex') } }, null, 2) + '\n');
  return report;
}
if (require.main === module) execute({ kind: process.argv[process.argv.indexOf('--case') + 1] }).then(r => {
  console.log(JSON.stringify({ kind: r.kind, status: r.status, reason: r.reason, checks: r.checks.length, failed: r.checks.filter(c => !c.passed).length }));
  process.exitCode = r.status === 'PASS' ? 0 : r.status === 'BLOCKED' ? 2 : 1;
}).catch(() => { console.error('phase2_configuration_error'); process.exitCode = 1; });
module.exports = { RETRY_MS, faultWindow, controlArguments, faultScenarios, execute };
