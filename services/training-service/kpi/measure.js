'use strict';

// Expected training completion KPI (Issue 13).
//
// Drives every scenario in a versioned controlled dataset through the real
// training-service app over HTTP, with the in-memory store and fake sources,
// and compares the observed outcome with the scenario's expected outcome.
//
//   expectedCompletion = scenarios with the exact expected outcome / all scenarios
//   completionOfCompletable = exact scenarios / scenarios expected to complete
//
// A scenario has the exact expected outcome when its final session status
// (with block reason) matches, it has exactly one completion event if it
// completed and none otherwise, and every step behaved as the dataset says.
// The status uses the lower of the two ratios, so many correct refusals cannot
// hide sessions that should have completed and did not.
// Green >= 95% (Initial Target), Amber >= 90% (Acceptance Floor), else Red.
// Any Invariant breach is Red whatever the ratio.
//
// Run: node services/training-service/kpi/measure.js [--write]
// --write saves the report to evidence/sprint-2/training-completion-kpi.json.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');
const { SourceUnavailableError } = require('../clients');
const { completionPolicy } = require('../plan');

const DATASET_PATH = path.join(__dirname, 'completion-dataset.v1.json');
const REPORT_PATH = path.join(__dirname, '../../../evidence/sprint-2/training-completion-kpi.json');
const ACCEPTANCE_FLOOR = 0.9;
const INITIAL_TARGET = 0.95;
const KEY = 'kpi-internal-key';
const LEARNER = 'kpi-learner';
const OPERATOR = 'kpi-operator';
const EVIDENCE = Object.freeze({ mode: 'synthetic', environment: 'simulation' });
const MAX_WORK_CYCLES = 50;
const CLOCK_START = Date.parse('2026-10-07T00:00:00.000Z');

// --- context: one fresh service, store and sources per scenario ----------

function failingWhenDown(source, name, ctx) {
  const guard = (fn) => async (...args) => {
    if (ctx.down === name) throw new SourceUnavailableError(name);
    return fn(...args);
  };
  return Object.fromEntries(Object.entries(source).map(([key, value]) =>
    [key, key.startsWith('get') ? guard(value) : value]));
}

async function createContext(dataset, scenario) {
  const ctx = { down: null, tick: 0, failures: [], last: null, sessionId: null,
    weightReplies: 0, weightsNotConfirmedUnchanged: 0, replayAppends: 0, outageWrites: 0, policy: completionPolicy(dataset.policy), store: createMemoryStore() };
  ctx.packages = createFakePackageSource([{ id: 'pkg-kpi', version: '1.0.0', state: 'Active', digest: 'digest-1',
    payload: dataset.packages[scenario.package || 'standard'] }]);
  ctx.registry = createFakeRegistrySource([
    { agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:kpi-config', configurationVersion: 1 }]);
  await boot(ctx);
  return ctx;
}

// A restart is a new app over the same durable store and sources.
async function boot(ctx) {
  if (ctx.server) await new Promise((resolve) => ctx.server.close(resolve));
  const app = createApp({ internalKey: KEY, store: ctx.store, policy: ctx.policy,
    packageSource: failingWhenDown(ctx.packages, 'package', ctx),
    registrySource: failingWhenDown(ctx.registry, 'registry', ctx),
    clock: () => new Date(CLOCK_START + (ctx.tick += 1000)).toISOString() });
  ctx.server = http.createServer(app);
  await new Promise((resolve) => ctx.server.listen(0, '127.0.0.1', resolve));
}

function send(ctx, method, url, body, actor = LEARNER) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: ctx.server.address().port, method, path: url, agent: false,
      headers: { 'x-internal-service-key': KEY, 'x-actor-subject': actor,
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } },
    (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

// Every delivered item (in its bounds) and every accepted submit must state
// modelWeightsModified: false; a missing or other value counts as a breach.
function weightsStatement(url, body) {
  if (url.endsWith('/submit')) return { stated: body.modelWeightsModified };
  if (url.endsWith('/continue') && body.item) return { stated: body.bounds?.modelWeightsModified };
  return null;
}

// Every learner and operator request is recorded so `retry` can resend it.
async function call(ctx, method, url, body, actor) {
  const response = await send(ctx, method, url, body, actor);
  ctx.last = { method, url, body, actor, response };
  if (response.body.sessionId) ctx.sessionId = response.body.sessionId;
  const weights = response.status < 300 ? weightsStatement(url, response.body) : null;
  if (weights) {
    ctx.weightReplies += 1;
    if (weights.stated !== false) ctx.weightsNotConfirmedUnchanged += 1;
  }
  return response;
}

const totalEvents = async (ctx) => (await ctx.store.listSessions()).reduce((sum, row) => sum + row.events.length, 0);
const nextKey = (ctx) => `kpi-${(ctx.keys = (ctx.keys || 0) + 1)}`;
const expectStatus = (ctx, step, response, allowed) => {
  if (!allowed.includes(response.status)) {
    ctx.failures.push(`${step}: status ${response.status} (${response.body.error || 'ok'}), expected ${allowed.join('/')}`);
  }
};

// --- steps ---------------------------------------------------------------

const start = (ctx) => call(ctx, 'POST', '/internal/sessions/start', { idempotencyKey: nextKey(ctx), evidence: EVIDENCE });
const next = (ctx) => call(ctx, 'POST', `/internal/sessions/${ctx.sessionId}/continue`,
  { idempotencyKey: nextKey(ctx), evidence: EVIDENCE });
const submit = (ctx, deliveryItemId, response = 'practice answer', extra = {}) =>
  call(ctx, 'POST', `/internal/sessions/${ctx.sessionId}/submit`,
    { idempotencyKey: nextKey(ctx), evidence: EVIDENCE, deliveryItemId, response, ...extra });

// One cycle shows the next item and answers it. Returns false when the
// session has nothing more to do (completed, blocked or refused).
async function workCycle(ctx) {
  const shown = await next(ctx);
  if (shown.status !== 200 || !shown.body.item) return false;
  const done = await submit(ctx, shown.body.item.deliveryItemId);
  return done.status === 200 && done.body.status !== 'completed';
}

async function work(ctx, arg) {
  const cycles = arg === 'all' ? MAX_WORK_CYCLES : Number(arg);
  for (let n = 0; n < cycles; n += 1) {
    if (!(await workCycle(ctx))) return;
  }
}

async function retry(ctx) {
  const before = await totalEvents(ctx);
  const { method, url, body, actor, response } = ctx.last;
  const again = await send(ctx, method, url, body, actor);
  if (Math.floor(again.status / 100) !== Math.floor(response.status / 100)) {
    ctx.failures.push(`retry: status ${again.status}, first attempt ${response.status}`);
  }
  if ((await totalEvents(ctx)) !== before) ctx.replayAppends += 1;
}

// The learner keeps trying while a source is down; nothing may be written.
async function outage(ctx, source, attempts = '1') {
  ctx.down = source;
  for (let n = 0; n < Number(attempts); n += 1) {
    const before = await totalEvents(ctx);
    const response = ctx.sessionId ? await next(ctx) : await start(ctx);
    expectStatus(ctx, `outage:${source}`, response, [503]);
    if ((await totalEvents(ctx)) !== before) ctx.outageWrites += 1;
  }
  ctx.down = null;
}

// A unique-key collision on append, as from a concurrent writer. One is
// re-read and decided again; two return 409 and the learner retries.
async function collision(ctx, count) {
  ctx.store.failNextAppend = Number(count);
  const shown = await next(ctx);
  expectStatus(ctx, 'collision', shown, Number(count) > 1 ? [409] : [200]);
  ctx.store.failNextAppend = 0;
}

async function refusedSubmit(ctx, step, allowed, pick) {
  const shown = await next(ctx);
  const before = await totalEvents(ctx);
  const response = await pick(shown.body.item);
  expectStatus(ctx, step, response, allowed);
  if ((await totalEvents(ctx)) !== before) ctx.failures.push(`${step}: a refused submit was recorded`);
}

// A response of exactly the configured maximum is accepted.
async function maxResponse(ctx) {
  const shown = await next(ctx);
  const done = await submit(ctx, shown.body.item.deliveryItemId, 'x'.repeat(ctx.policy.maxResponseChars));
  expectStatus(ctx, 'maxResponse', done, [200]);
}

async function remediate(ctx, objectives) {
  const response = await call(ctx, 'POST', '/internal/remediations', {
    requestId: `kpi-req-${objectives}`, agentLearnerKey: LEARNER, packageId: 'pkg-kpi', packageVersion: '1.0.0',
    objectiveIds: objectives.split(','), evidence: EVIDENCE,
    cause: { type: 'examination_failure', reference: 'kpi-attempt-1', evidenceDigest: `sha256:${'0'.repeat(64)}`,
      observedAt: '2026-10-07T00:00:00.000Z' },
  }, OPERATOR);
  expectStatus(ctx, 'remediate', response, [201]);
}

const STEPS = {
  start: async (ctx) => expectStatus(ctx, 'start', await start(ctx), [200, 201]),
  refusedStart: async (ctx) => expectStatus(ctx, 'refusedStart', await start(ctx), [409]),
  work,
  retry,
  restart: boot,
  outage,
  collision,
  remediate,
  state: async (ctx, state) => ctx.packages.setState('pkg-kpi', state),
  digest: async (ctx, digest) => ctx.packages.setDigest('pkg-kpi', digest),
  fingerprint: async (ctx, fingerprint) => ctx.registry.setFingerprint(LEARNER, fingerprint),
  maxResponse,
  longResponse: (ctx) => refusedSubmit(ctx, 'longResponse', [422],
    (item) => submit(ctx, item.deliveryItemId, 'x'.repeat(ctx.policy.maxResponseChars + 1))),
  outOfOrder: (ctx) => refusedSubmit(ctx, 'outOfOrder', [409], () => submit(ctx, 'm3-practice')),
  extraField: (ctx) => refusedSubmit(ctx, 'extraField', [400],
    (item) => submit(ctx, item.deliveryItemId, 'answer', { modelWeights: [0.1] })),
};

async function runStep(ctx, spec) {
  const [name, ...rest] = spec.split(':');
  const run = STEPS[name];
  if (!run) throw new Error(`unknown step ${spec}`);
  // state/digest/fingerprint values may contain ':' themselves.
  const args = ['state', 'digest', 'fingerprint'].includes(name) ? [rest.join(':')] : rest;
  await run(ctx, ...args);
}

// --- observation ---------------------------------------------------------

async function observe(ctx) {
  const latest = (await ctx.store.listSessions({ agentLearnerKey: LEARNER }))[0];
  if (!latest) return { outcome: 'none', completionEvents: 0 };
  const sessionId = latest.session.sessionId;
  const { body } = await send(ctx, 'GET', `/internal/sessions/${sessionId}`);
  const { status, blockReason, kind } = body.session;
  const completionEvents = (await ctx.store.listCompletionEvents()).filter((e) => e.sessionId === sessionId).length;
  return { outcome: status === 'blocked' ? `blocked:${blockReason}` : status, kind, completionEvents };
}

async function runScenario(dataset, scenario) {
  const ctx = await createContext(dataset, scenario);
  try {
    for (const spec of scenario.steps) await runStep(ctx, spec);
    const observed = await observe(ctx);
    const metrics = (await send(ctx, 'GET', '/internal/metrics')).body;
    const expectedEvents = scenario.expected === 'completed' ? 1 : 0;
    const exact = observed.outcome === scenario.expected && observed.completionEvents === expectedEvents &&
      ctx.failures.length === 0 && ctx.replayAppends === 0 && ctx.outageWrites === 0;
    return { id: scenario.id, category: scenario.category, expected: scenario.expected, observed: observed.outcome,
      completionEvents: observed.completionEvents, exact, failures: ctx.failures,
      invariants: { falseCompletion: observed.outcome === 'completed' && scenario.expected !== 'completed',
        duplicateCompletionEvents: Math.max(0, observed.completionEvents - 1), replayAppends: ctx.replayAppends,
        outageWrites: ctx.outageWrites, weightsNotConfirmedUnchanged: ctx.weightsNotConfirmedUnchanged },
      weightReplies: ctx.weightReplies,
      counts: metrics.counts };
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
}

// --- report --------------------------------------------------------------

const ratio = (part, whole) => (whole ? Math.round((part / whole) * 10000) / 10000 : null);
const sumBy = (rows, pick) => rows.reduce((sum, row) => sum + Number(pick(row)), 0);

function kpiStatus(value, invariantsHeld) {
  if (!invariantsHeld || value === null || value < ACCEPTANCE_FLOOR) return 'Red';
  return value >= INITIAL_TARGET ? 'Green' : 'Amber';
}

function summariseCounts(results) {
  const keys = Object.keys(results[0]?.counts || {});
  const counts = Object.fromEntries(keys.map((key) => [key, sumBy(results, (r) => r.counts[key])]));
  return { counts, completionRate: ratio(counts.completed, counts.started) };
}

function byCategory(results) {
  const categories = [...new Set(results.map((r) => r.category))];
  return Object.fromEntries(categories.map((category) => {
    const rows = results.filter((r) => r.category === category);
    return [category, { scenarios: rows.length, exact: rows.filter((r) => r.exact).length }];
  }));
}

function buildReport(dataset, digest, results) {
  const invariants = {
    falseCompletions: results.filter((r) => r.invariants.falseCompletion).length,
    duplicateCompletionEvents: sumBy(results, (r) => r.invariants.duplicateCompletionEvents),
    replaysThatAppended: sumBy(results, (r) => r.invariants.replayAppends),
    writesDuringOutage: sumBy(results, (r) => r.invariants.outageWrites),
    weightsNotConfirmedUnchanged: sumBy(results, (r) => r.invariants.weightsNotConfirmedUnchanged),
  };
  const invariantsHeld = Object.values(invariants).every((value) => value === 0);
  const exact = results.filter((r) => r.exact).length;
  const expectedCompletion = ratio(exact, results.length);
  const completable = results.filter((r) => r.expected === 'completed');
  const completionOfCompletable = ratio(completable.filter((r) => r.exact).length, completable.length);
  const measured = [expectedCompletion, completionOfCompletable].includes(null)
    ? null : Math.min(expectedCompletion, completionOfCompletable);
  return {
    kpi: 'expected-training-completion',
    formula: 'scenarios with the exact expected outcome / all scenarios; status uses the lower of that and the same ratio over scenarios expected to complete',
    dataset: { name: dataset.dataset, version: dataset.version, digest, scenarios: results.length,
      expectedToComplete: completable.length },
    environment: 'training-service createApp over HTTP, in-memory store, fake package and registry sources',
    expectedCompletion, completionOfCompletable, acceptanceFloor: ACCEPTANCE_FLOOR, initialTarget: INITIAL_TARGET,
    status: kpiStatus(measured, invariantsHeld),
    invariants, invariantsHeld,
    checks: { repliesStatingWeights: sumBy(results, (r) => r.weightReplies) },
    sessionMetrics: summariseCounts(results),
    byCategory: byCategory(results),
    misses: results.filter((r) => !r.exact).map(({ id, expected, observed, failures }) => ({ id, expected, observed, failures })),
    scenarios: results.map(({ id, category, expected, observed, completionEvents, exact }) =>
      ({ id, category, expected, observed, completionEvents, exact })),
  };
}

async function measureCompletion(datasetPath = DATASET_PATH) {
  const raw = fs.readFileSync(datasetPath);
  const dataset = JSON.parse(raw);
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const results = [];
  for (const scenario of dataset.scenarios) results.push(await runScenario(dataset, scenario));
  return buildReport(dataset, digest, results);
}

if (require.main === module) {
  measureCompletion().then((report) => {
    if (process.argv.includes('--write')) {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stderr.write(`expected training completion ${report.expectedCompletion}, ` +
      `of completable ${report.completionOfCompletable} (${report.status}), ` +
      `floor ${ACCEPTANCE_FLOOR}, target ${INITIAL_TARGET}, invariants held: ${report.invariantsHeld}\n`);
    process.exitCode = report.status === 'Red' ? 1 : 0;
  }, (error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = { ACCEPTANCE_FLOOR, INITIAL_TARGET, REPORT_PATH, kpiStatus, measureCompletion };
