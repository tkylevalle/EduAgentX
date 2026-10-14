'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { scoreBank } = require('../../curriculum-engine/fallback');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { fail } = require('../lifecycle');
const { DependencyError } = require('../sources');
const { encodeFallbackAnswer } = require('../fallback-form');

const INTERNAL_KEY = 'fallback-finalize-service-key';
const GRADING_KEY = 'fallback-finalize-grading-key';
const ACTOR = 'fallback-finalize-learner';
const START = '2026-10-14T06:00:00.000Z';
const AGENT_HEADERS = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': ACTOR, 'x-actor-role': 'agent' };
const EXAMINER_HEADERS = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': 'trusted-operator',
  'x-actor-role': 'examiner', 'x-internal-grading-key': GRADING_KEY };
const BANK = new Map(candidate.fallbackBank.items.map((item) => [item.id, item]));

function activePackage() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  return pkg;
}

async function boot(t) {
  const ctx = { pkg: activePackage(), scoreCalls: [] };
  const fingerprint = 'sha256:fallback-finalize-fingerprint';
  const sources = {
    activePackage: async () => ctx.pkg,
    registration: async (actor) => ({ agentLearnerKey: actor, configurationFingerprint: fingerprint }),
    completion: async (actor) => ({ eventType: 'training.session.completed', eventId: `completed-${actor}`,
      sessionId: `session-${actor}`, agentLearnerKey: actor, configurationFingerprint: fingerprint,
      package: { id: ctx.pkg.packageId, version: ctx.pkg.version, digest: ctx.pkg.digest },
      completion: { plannedItems: 10, completedItems: 10 } }),
  };
  // Fakes with the same contracts as fallback-sources.js.
  const selectFallback = async ({ pkg }) => {
    const bank = candidate.fallbackBank;
    const selection = JSON.parse(JSON.stringify({ packageId: pkg.packageId, bankId: bank.id, bankVersion: bank.version,
      scoringPolicy: bank.scoringPolicy, attemptId: randomUUID(), mode: 'fallback',
      items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
        ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) }));
    return { selection, packageVersion: pkg.version, packageDigest: pkg.digest };
  };
  // By default scores exactly as validation-activation does: scoreBank on the package's own bank.
  ctx.score = async ({ responses }) => scoreBank(candidate.fallbackBank, responses);
  const scoreFallback = async (args) => { ctx.scoreCalls.push(structuredClone(args)); return ctx.score(args); };
  ctx.store = createMemoryStore();
  const server = http.createServer(createApp({ store: ctx.store, sources, internalKey: INTERNAL_KEY, gradingKey: GRADING_KEY,
    clock: () => START, durationMinutes: 60, selectFallback, scoreFallback }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  ctx.call = (method, path, body, headers) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port: server.address().port, method, path,
      headers: { ...headers, ...(data !== undefined ? { 'content-type': 'application/json',
        'content-length': Buffer.byteLength(data) } : {}) } }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    request.on('error', reject); request.end(data);
  });
  ctx.finalize = (attemptId, key = 'finalize-1') =>
    ctx.call('POST', `/internal/attempts/${attemptId}/fallback-finalize`, { idempotencyKey: key }, EXAMINER_HEADERS);
  return ctx;
}

const correct = (item) => encodeFallbackAnswer(item.answerType, BANK.get(item.id).expectedAnswer);
const wrong = (item) => encodeFallbackAnswer(item.answerType,
  ['multiple_choice', 'ordered_actions'].includes(item.answerType) ? ['wrong'] : 'wrong');

// Starts a fallback attempt and has the learner answer `count` items through the real response route.
async function fallbackAttempt(ctx, answer = correct, count = 15) {
  const started = await ctx.call('POST', '/internal/attempts/fallback', { idempotencyKey: randomUUID(), agentLearnerKey: ACTOR,
    reason: 'standard_generation_unavailable', causeAttemptId: null }, EXAMINER_HEADERS);
  assert.equal(started.status, 201);
  let current = started.body.attempt;
  for (const [index, item] of started.body.attempt.form.items.slice(0, count).entries()) {
    const accepted = await ctx.call('POST', `/internal/attempts/${current.attemptId}/responses`, { idempotencyKey: `answer-${index}`,
      expectedSequence: current.sequence, itemId: item.id, response: answer(item) }, AGENT_HEADERS);
    assert.equal(accepted.status, 200);
    current = accepted.body.attempt;
  }
  return current;
}
const assertNoScoringDetail = (body) => {
  for (const marker of ['"results"', 'tierScores', '"overall"', 'criticalViolation', 'vaSelectionId'])
    assert.equal(JSON.stringify(body).includes(marker), false, marker);
};

test('a passing fallback finalizes to complete through the store\'s finalize command', async (t) => {
  const ctx = await boot(t);
  const ready = await fallbackAttempt(ctx);
  assert.deepEqual([ready.status, ready.responseCollectionComplete, ready.sequence], ['in_progress', true, 16]);
  const done = await ctx.finalize(ready.attemptId);
  assert.deepEqual([done.status, done.body.outcome, done.body.attempt.status, done.body.attempt.mode],
    [200, 'accepted', 'complete', 'fallback']);
  assertNoScoringDetail(done.body);
  // Exactly one score call, with the stored selection id and decoded (not string) answers.
  const [call] = ctx.scoreCalls;
  const saved = await ctx.store.get(ready.attemptId);
  assert.equal(ctx.scoreCalls.length, 1);
  assert.equal(call.vaSelectionId, saved.form.vaSelectionId);
  assert.deepEqual(call.pkg.digest, saved.package.digest);
  const ordered = call.responses.find(({ itemId }) => BANK.get(itemId).answerType === 'ordered_actions');
  assert.deepEqual(ordered.answer, BANK.get(ordered.itemId).expectedAnswer);
  const grade = saved.events.find((event) => event.eventType === 'grade_recorded');
  assert.deepEqual(grade.payload.result, { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true });
  assert.equal(grade.eventId, `fallback-grade:${ready.attemptId}`);
});

test('a valid failing score ends Agent-Failed', async (t) => {
  const ctx = await boot(t);
  const ready = await fallbackAttempt(ctx, wrong);
  const done = await ctx.finalize(ready.attemptId);
  assert.deepEqual([done.status, done.body.attempt.status, done.body.attempt.terminalReason],
    [200, 'agent_failed', 'valid_failing_result']);
  assertNoScoringDetail(done.body);
});

test('an invalid or malformed score aborts as grading_unavailable, never as a grade', async (t) => {
  for (const malformed of [{ valid: false, reason: 'incomplete_fallback_attempt' }, 'not json', { passed: true }]) {
    const ctx = await boot(t);
    ctx.score = async () => malformed;
    const ready = await fallbackAttempt(ctx);
    const done = await ctx.finalize(ready.attemptId);
    assert.deepEqual([done.status, done.body.attempt.status, done.body.attempt.terminalReason],
      [200, 'system_aborted', 'grading_unavailable'], JSON.stringify(malformed));
    const saved = await ctx.store.get(ready.attemptId);
    assert.equal(saved.events.some((event) => event.eventType === 'grade_recorded'), false);
  }
});

test('an already-scored refusal with no recoverable result aborts as grading_unavailable', async (t) => {
  const ctx = await boot(t);
  ctx.score = async () => { throw Object.assign(fail('fallback_attempt_already_scored'), { source: 'validation-activation', upstreamStatus: 409 }); };
  const ready = await fallbackAttempt(ctx);
  const done = await ctx.finalize(ready.attemptId);
  assert.deepEqual([done.status, done.body.attempt.status, done.body.attempt.terminalReason],
    [200, 'system_aborted', 'grading_unavailable']);
  const saved = await ctx.store.get(ready.attemptId);
  assert.equal(saved.events.at(-1).eventId, `fallback-abort:${ready.attemptId}`);
});

test('a package changed or quarantined since admission aborts as governance_changed without scoring', async (t) => {
  for (const change of [{ version: 'replaced-version', digest: 'e'.repeat(64) }, { quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] }]) {
    const ctx = await boot(t);
    const ready = await fallbackAttempt(ctx);
    ctx.pkg = { ...ctx.pkg, ...change };
    const done = await ctx.finalize(ready.attemptId);
    assert.deepEqual([done.status, done.body.attempt.status, done.body.attempt.terminalReason],
      [200, 'system_aborted', 'governance_changed'], JSON.stringify(change));
    assert.equal(ctx.scoreCalls.length, 0);
  }
});

test('a terminal attempt replays without a second score call', async (t) => {
  const ctx = await boot(t);
  const ready = await fallbackAttempt(ctx);
  const first = await ctx.finalize(ready.attemptId);
  const again = await ctx.finalize(ready.attemptId);
  const otherKey = await ctx.finalize(ready.attemptId, 'finalize-2');
  for (const replay of [again, otherKey]) {
    assert.deepEqual([replay.status, replay.body.outcome], [200, 'replay']);
    assert.deepEqual(replay.body.attempt, first.body.attempt);
  }
  assert.equal(ctx.scoreCalls.length, 1);
});

test('standard-mode attempts and incomplete fallback attempts are refused without scoring', async (t) => {
  const ctx = await boot(t);
  const standard = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'standard-1' }, AGENT_HEADERS);
  const refused = await ctx.finalize(standard.body.attempt.attemptId);
  assert.deepEqual([refused.status, refused.body.error], [409, 'fallback_attempt_required']);
  const partial = await fallbackAttempt(ctx, correct, 14);
  const early = await ctx.finalize(partial.attemptId);
  assert.deepEqual([early.status, early.body.error], [409, 'responses_incomplete']);
  assert.equal((await ctx.store.get(partial.attemptId)).status, 'in_progress');
  const missing = await ctx.finalize(randomUUID());
  assert.equal(missing.status, 404);
  for (const body of [{}, { idempotencyKey: '' }, { idempotencyKey: 'k', extra: true }]) {
    const invalid = await ctx.call('POST', `/internal/attempts/${partial.attemptId}/fallback-finalize`, body, EXAMINER_HEADERS);
    assert.deepEqual([invalid.status, invalid.body.error], [400, 'invalid_request']);
  }
  const learner = await ctx.call('POST', `/internal/attempts/${partial.attemptId}/fallback-finalize`, { idempotencyKey: 'k' }, AGENT_HEADERS);
  assert.equal(learner.status, 403);
  assert.equal(ctx.scoreCalls.length, 0);
});

test('a scoring outage leaves the attempt in progress, and a retry then finalizes it', async (t) => {
  const ctx = await boot(t);
  const ready = await fallbackAttempt(ctx);
  const realScore = ctx.score;
  ctx.score = async () => { throw new DependencyError('validation-activation'); };
  const down = await ctx.finalize(ready.attemptId);
  assert.deepEqual([down.status, down.body.error, down.body.dependency], [503, 'dependency_unavailable', 'validation-activation']);
  assert.equal((await ctx.store.get(ready.attemptId)).status, 'in_progress');
  ctx.score = realScore;
  const retried = await ctx.finalize(ready.attemptId);
  assert.equal(retried.body.attempt.status, 'complete');
});

test('a stored response that is not canonical JSON aborts as grading_unavailable without scoring', async (t) => {
  const ctx = await boot(t);
  const ready = await fallbackAttempt(ctx, (item) => (BANK.get(item.id).answerType === 'single_choice' ? 'Map' : correct(item)));
  const done = await ctx.finalize(ready.attemptId);
  assert.deepEqual([done.body.attempt.status, done.body.attempt.terminalReason], ['system_aborted', 'grading_unavailable']);
  assert.equal(ctx.scoreCalls.length, 0);
});
