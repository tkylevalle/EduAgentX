'use strict';
// Clock-scripted harness tests only; NOT real outage or formal evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { faultWindow, controlArguments, RETRY_MS, faultScenarios } = require('../phase2');
const { preflight, goldenReadiness } = require('../readiness');
const { manifest } = require('../manifest');
test('real retry bounds use last acceptance, not the learner response deadline', () => {
  const b = faultWindow({ earliestAcceptedAt: 1000, latestAcceptedAt: 1200, deadlineAt: new Date(60000).toISOString() });
  assert.equal(RETRY_MS, 900000); assert.equal(b.earliestAbortAt, 901000); assert.equal(b.observeUntil, 961200);
  assert.equal(b.postDeadlineAt, 61500);
  assert.throws(() => faultWindow({ earliestAcceptedAt: 2, latestAcceptedAt: 1 }), /invalid/);
});
test('fault control refuses normal stacks, different projects, named volumes and arbitrary commands', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue33-control-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'private.json');
  const env = { E2E_FAULT_CONTROL: 'isolated-grader-only', E2E_PROJECT: 'eduagentx-issue33-test-1-faults', E2E_COMPOSE_FILE: file };
  const config = { name: env.E2E_PROJECT, services: { 'grading-service': {} }, volumes: { data: {} } };
  fs.writeFileSync(file, JSON.stringify(config));
  assert.deepEqual(controlArguments(env, 'stop').slice(-2), ['stop', 'grading-service']);
  for (const op of ['down', 'kill', 'rm']) assert.throws(() => controlArguments(env, op));
  assert.throws(() => controlArguments({ ...env, E2E_PROJECT: 'developer' }, 'stop'));
  assert.throws(() => controlArguments({ ...env, E2E_FAULT_CONTROL: 'disabled' }, 'start'));
  config.volumes.data.name = 'developer-data'; fs.writeFileSync(file, JSON.stringify(config));
  assert.throws(() => controlArguments(env, 'stop'), /private_project/);
});
test('preflight freezes the five categories and distinguishes capacity from execution', () => {
  const r = preflight(); assert.equal(r.manifest.valid, true); assert.equal(r.manifest.count, 1000);
  assert.deepEqual(Object.values(r.manifest.counts), [200, 200, 200, 200, 200]);
  assert.deepEqual(Object.values(r.manifest.variants), [50, 50, 50, 50]);
  assert.equal(r.identities.executed1000, 'NOT_RUN'); assert.equal(r.formal1000, 'NOT_RUN');
  assert.equal(r.expectedCurrentBlockage.fullOutcomesBlockedByMarketplace, 400);
  assert.equal(r.expectedCurrentBlockage.maximumConformantWithoutMarketplace, 600);
  assert.equal(r.execution.responseDeadlineMinutes, 60);
  assert.equal(r.runtimeEstimate.naive1000Minutes, null);
});
test('runtime extrapolation requires a measured complete 25 lifecycle report', () => {
  const phase1 = { executed: 25, lifecycleConformant: 25, startedAt: '2026-11-02T00:00:00Z', finishedAt: '2026-11-02T00:05:36Z' };
  assert.equal(preflight({ phase1 }).runtimeEstimate.naive1000Minutes, 224);
  assert.equal(preflight({ phase1: { ...phase1, executed: 24 } }).measuredPilot.verified25, false);
});
test('upstream BLOCKED never conceals missing per-case harness/oracle work', () => {
  const r = goldenReadiness(); assert.deepEqual(r.counts, { READY: 0, BLOCKED: 100, NOT_IMPLEMENTED: 0 });
  assert.equal(r.missingHarnessCases, 100);
  assert.equal(goldenReadiness({ lifecycleOrigin: true, signedLabels: true }).counts.NOT_IMPLEMENTED, 100);
});
function scriptedFaults({ earlyAbort = false, lateEarlyAbort = false, lateTimeout = false, unexpectedCredential = false } = {}) {
  let time = 0, stopped = false, restored = false;
  const contexts = new Map(), checks = [], mappings = [], operations = [];
  const orchestrator = { async prepare(s) {
    const a = { attemptId: s.id, startedAt: new Date(time).toISOString(), deadlineAt: new Date(time + 60000).toISOString(),
      responsesReceived: s.expected.examination.partialResponses, responseCollectionComplete: s.expected.examination.partialResponses === 15 };
    const ctx = { scenario: s, current: { attempt: a, lastSentAt: time, lastAcceptedAt: time }, correlationId: 'safe', result: {} };
    contexts.set(s.id, ctx); return ctx;
  } };
  const admin = { async call(_method, route) {
    const id = route.includes('?') ? new URLSearchParams(route.split('?')[1]).get('examinationId') : route.split('/').at(-1);
    const ctx = contexts.get(id), a = ctx.current.attempt;
    if (route.includes('reconciliation')) return { status: 200, body: { count: unexpectedCredential ? 1 : restored && id === 'competent-005' ? 1 : 0 } };
    const outage = id === 'competent-004', late = id === 'competent-005';
    const abortAt = ctx.current.lastAcceptedAt + RETRY_MS - (earlyAbort ? 870000 : lateEarlyAbort ? 1000 : 0);
    const aborted = outage && time >= abortAt;
    const timeout = !a.responseCollectionComplete && time >= Date.parse(a.deadlineAt);
    const complete = late && restored;
    return { status: 200, body: { attempt: { ...a, status: aborted ? 'system_aborted' : timeout || (lateTimeout && late && restored) ? 'agent_failed' : complete ? 'complete' : 'in_progress',
      terminalReason: aborted ? 'grading_unavailable' : timeout ? 'response_deadline_elapsed' : complete ? 'valid_passing_result' : null,
      completedAt: complete ? new Date(time).toISOString() : null, abortedAt: aborted ? new Date(abortAt).toISOString() : null,
      assessment: complete ? { passed: true } : null } } };
  } };
  const serviceControl = async (_env, op) => { operations.push(op); stopped = op === 'stop'; restored = !stopped; };
  return { checks, mappings, operations, isStopped: () => stopped, execute: () => faultScenarios({ orchestrator, admin,
    clientFor: () => ({}), env: { E2E_DEADLINE_MINUTES: '1' }, checks, mappings, now: () => time,
    wait: async ms => { time += ms; }, serviceControl }) };
}
test('fault choreography separately proves partial/unavailable learner deadlines, full retry and late grading', async () => {
  const f = scriptedFaults(); const r = await f.execute();
  assert.equal(r.retryWindowMs, 900000); assert.equal(r.duplicateCredentials, 0);
  assert.ok(f.checks.every(c => c.passed)); assert.deepEqual(f.operations, ['stop', 'start']);
  assert.ok(Date.parse(r.lateCompletedAt) > Date.parse(r.lateDeadlineAt));
  assert.equal(new Set(f.mappings.map(m => m.attemptId)).size, 4);
});
for (const [name, option] of [['premature abort', { earlyAbort: true }], ['early abort observed after retry bound', { lateEarlyAbort: true }], ['late grading becomes learner failure', { lateTimeout: true }], ['credential on outage', { unexpectedCredential: true }]])
  test(`fault assertions reject ${name} and restore the grader`, async () => {
    const f = scriptedFaults(option); await assert.rejects(f.execute()); assert.equal(f.isStopped(), false);
    assert.ok(f.checks.some(c => c.passed === false));
  });
test('stress concurrency is bounded before any public calls', () => {
  const { createOrchestrator } = require('../lifecycle');
  for (const n of [0, 9, 1.5]) assert.throws(() => createOrchestrator({ stressConcurrency: n }));
  assert.equal(manifest.scenarios.length, 1000);
});
