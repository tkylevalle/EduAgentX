'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { DependencyError } = require('../sources');

const INTERNAL_KEY = 'attempt-api-service-key';
const GRADING_KEY = 'attempt-api-grading-key';
const ACTOR = 'attempt-api-learner';
const START = '2026-10-12T06:00:00.000Z';
const BEFORE_DEADLINE = '2026-10-12T06:59:59.999Z';
const DEADLINE = '2026-10-12T07:00:00.000Z';
const AFTER_DEADLINE = '2026-10-12T08:00:00.000Z';
const AGENT_HEADERS = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': ACTOR, 'x-actor-role': 'agent' };
const ADMIN_HEADERS = { ...AGENT_HEADERS, 'x-actor-subject': 'attempt-api-admin', 'x-actor-role': 'admin' };
const EXAMINER_HEADERS = { ...AGENT_HEADERS, 'x-actor-subject': 'trusted-grader', 'x-actor-role': 'examiner',
  'x-internal-grading-key': GRADING_KEY };

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: ACTOR, configurationFingerprint: 'sha256:api-locked-fingerprint' };
  const completion = { eventType: 'training.session.completed', eventId: 'api-training-completed', sessionId: 'api-training',
    agentLearnerKey: ACTOR, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  return { pkg, registration, completion };
}

async function boot(t, options = {}) {
  const input = fixture();
  let now = START;
  const store = createMemoryStore();
  const sources = {
    activePackage: async () => input.pkg,
    registration: async () => input.registration,
    completion: async () => input.completion,
  };
  if (options.sources) Object.assign(sources, options.sources(input));
  const server = http.createServer(createApp({ store, sources, internalKey: INTERNAL_KEY,
    gradingKey: Object.hasOwn(options, 'gradingKey') ? options.gradingKey : GRADING_KEY,
    clock: () => now, durationMinutes: 60, selectFallback: options.selectFallback }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (method, path, body, headers = AGENT_HEADERS, rawBody) => new Promise((resolve, reject) => {
    const data = rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody;
    const request = http.request({ host: '127.0.0.1', port: server.address().port, method, path,
      headers: { ...headers, ...(data !== undefined ? { 'content-type': 'application/json',
        'content-length': Buffer.byteLength(data) } : {}) } }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    request.on('error', reject); request.end(data);
  });
  return { input, store, sources, call, setClock: (value) => { now = value; } };
}

async function start(ctx, key = 'start') {
  const result = await ctx.call('POST', '/internal/attempts', { idempotencyKey: key });
  assert.equal(result.status, 201);
  return result.body.attempt;
}

function responseBody(attempt, overrides = {}) {
  return { idempotencyKey: 'response-1', expectedSequence: attempt.sequence,
    itemId: attempt.form.items[0].id, response: 'PRIVATE_API_LEARNER_RESPONSE_449a90fe', ...overrides };
}

async function answerAll(ctx, attempt) {
  ctx.setClock(BEFORE_DEADLINE);
  let current = attempt;
  for (const [index, item] of attempt.form.items.entries()) {
    const result = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, responseBody({ ...current, form: attempt.form }, {
      itemId: item.id, idempotencyKey: `response-${index + 1}`, response: `PRIVATE_API_ANSWER_${index + 1}`,
    }));
    assert.equal(result.status, 200);
    current = result.body.attempt;
  }
  return current;
}

function gradeBody(attempt, overrides = {}) {
  return { idempotencyKey: 'grade', expectedSequence: attempt.sequence, eventId: randomUUID(),
    formDigest: attempt.formDigest, rubricDigest: attempt.rubricDigest || attempt.form.rubric.digest,
    responseSetDigest: attempt.responseSetDigest,
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true }, ...overrides };
}

function assertRedacted(body, marker) {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(marker), false);
  for (const key of ['responses', 'responseSetDigest', 'events', 'result']) assert.equal(body.attempt?.[key], undefined);
}

test('grading input, finalization and abort require the separate trusted capability and examiner role', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  for (const [method, suffix] of [['GET', 'grading-input'], ['POST', 'finalize'], ['POST', 'abort']]) {
    for (const headers of [AGENT_HEADERS, ADMIN_HEADERS,
      { ...EXAMINER_HEADERS, 'x-internal-grading-key': 'wrong-key' },
      { ...EXAMINER_HEADERS, 'x-internal-service-key': 'wrong-key' },
      { ...EXAMINER_HEADERS, 'x-actor-role': 'agent' }]) {
      const result = await ctx.call(method, `/internal/attempts/${attempt.attemptId}/${suffix}`, {}, headers);
      assert.equal(result.status, 403);
    }
  }
  assert.equal((await ctx.store.get(attempt.attemptId)).sequence, 1);
  const unconfigured = await boot(t, { gradingKey: null });
  const second = await start(unconfigured);
  const unavailable = await unconfigured.call('GET', `/internal/attempts/${second.attemptId}/grading-input`, undefined, EXAMINER_HEADERS);
  assert.deepEqual([unavailable.status, unavailable.body.error], [503, 'grading_not_configured']);
});

test('another learner cannot read or answer an attempt; malformed and premature results do not change state', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  const other = { ...AGENT_HEADERS, 'x-actor-subject': 'other-learner' };
  assert.equal((await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`, undefined, other)).status, 403);
  assert.equal((await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, responseBody(attempt), other)).status, 403);
  const stored = await ctx.store.get(attempt.attemptId);
  const premature = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/finalize`, gradeBody(stored), EXAMINER_HEADERS);
  assert.deepEqual([premature.status, premature.body.error], [409, 'responses_incomplete']);
  const malformed = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/finalize`, gradeBody(stored, {
    result: { schemaVersion: 'examination-result/1.0.0', valid: false, passed: true },
  }), EXAMINER_HEADERS);
  assert.equal(malformed.status, 400);
  const input = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/grading-input`, undefined, EXAMINER_HEADERS);
  assert.equal(input.status, 409);
  const unchanged = await ctx.store.get(attempt.attemptId);
  assert.deepEqual([unchanged.status, unchanged.sequence, unchanged.responsesReceived], ['in_progress', 1, 0]);
});

test('all timely responses remain in progress after deadline until trusted grading completes; both views agree', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  const ready = await answerAll(ctx, attempt);
  assert.deepEqual([ready.status, ready.sequence, ready.responsesReceived, ready.responseCollectionComplete], ['in_progress', 16, 15, true]);
  ctx.setClock(AFTER_DEADLINE);
  const learner = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`);
  const admin = await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN_HEADERS);
  assert.deepEqual([learner.body.attempt.status, admin.body.attempt.status], ['in_progress', 'in_progress']);
  assertRedacted(learner.body, 'PRIVATE_API_ANSWER_');
  assertRedacted(admin.body, 'PRIVATE_API_ANSWER_');
  const grading = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/grading-input`, undefined, EXAMINER_HEADERS);
  assert.equal(grading.status, 200);
  assert.equal(grading.body.responses.length, 15);
  assert.equal(grading.body.responses[0].response, 'PRIVATE_API_ANSWER_1');
  const finalized = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/finalize`, gradeBody(grading.body), EXAMINER_HEADERS);
  assert.equal(finalized.status, 200);
  assert.deepEqual([finalized.body.attempt.status, finalized.body.attempt.sequence, finalized.body.attempt.completedAt],
    ['complete', 18, AFTER_DEADLINE]);
  const finalLearner = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`);
  const finalAdmin = await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN_HEADERS);
  for (const key of ['status', 'sequence', 'responsesReceived', 'responseCollectionComplete', 'terminalReason', 'completedAt']) {
    assert.deepEqual(finalLearner.body.attempt[key], finalAdmin.body.attempt[key], key);
  }
  assertRedacted(finalized.body, 'PRIVATE_API_ANSWER_');
});

test('malformed response content stays out of logs, errors and learner/admin projections', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  const marker = 'PRIVATE_MALFORMED_ANSWER_0617de48';
  const logs = [];
  const previousLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  t.after(() => { console.log = previousLog; });
  const wrongField = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, {
    ...responseBody(attempt), secretAnswer: marker,
  });
  const malformed = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, undefined,
    AGENT_HEADERS, `{"response":"${marker}"`);
  assert.deepEqual([wrongField.status, malformed.status], [400, 400]);
  assertRedacted(wrongField.body, marker);
  assertRedacted(malformed.body, marker);
  const acceptedBody = responseBody(attempt, { response: marker });
  const accepted = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, acceptedBody);
  assert.equal(accepted.status, 200);
  const learner = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`);
  const admin = await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN_HEADERS);
  for (const body of [accepted.body, learner.body, admin.body]) assertRedacted(body, marker);
  assert.equal(logs.join('\n').includes(marker), false);
  assert.equal((await ctx.store.get(attempt.attemptId)).responses[0].response, marker);
});

test('post-admission fingerprint change, quarantine and dependency failure durably abort with observable attempt IDs', async (t) => {
  for (const failure of ['fingerprint', 'quarantine', 'dependency']) {
    let activeCalls = 0;
    let registrationCalls = 0;
    const ctx = await boot(t, { sources: (input) => ({
      activePackage: async () => {
        activeCalls++;
        if (activeCalls > 1 && failure === 'dependency') throw new DependencyError('validation-activation');
        return activeCalls > 1 && failure === 'quarantine' ? { ...input.pkg, quarantinedScopes: [{ scope: 'module-1' }] } : input.pkg;
      },
      registration: async () => {
        registrationCalls++;
        return registrationCalls > 1 && failure === 'fingerprint' ? { ...input.registration,
          configurationFingerprint: 'sha256:changed-after-admission' } : input.registration;
      },
    }) });
    const result = await ctx.call('POST', '/internal/attempts', { idempotencyKey: `start-${failure}` });
    assert.equal(result.status, failure === 'dependency' ? 503 : 409);
    assert.equal(result.body.attempt.status, 'system_aborted');
    assert.equal(result.body.attempt.sequence, 2);
    const saved = await ctx.store.findByKey(ACTOR, `start-${failure}`);
    assert.equal(result.body.attempt.attemptId, saved.attemptId);
    assert.deepEqual([saved.status, saved.events.length], ['system_aborted', 2]);
    const admin = await ctx.call('GET', `/internal/admin/attempts/${saved.attemptId}`, undefined, ADMIN_HEADERS);
    assert.deepEqual([admin.status, admin.body.attempt.status], [200, 'system_aborted']);
  }
});

test('committed response retries replay during dependency outages; a new response durably aborts', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  ctx.setClock(BEFORE_DEADLINE);
  const body = responseBody(attempt);
  const accepted = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, body);
  assert.equal(accepted.status, 200);
  ctx.sources.activePackage = async () => { throw new DependencyError('validation-activation'); };
  const retry = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, body);
  assert.deepEqual([retry.status, retry.body.outcome, retry.body.attempt.sequence], [200, 'replay', 2]);
  assert.equal((await ctx.store.get(attempt.attemptId)).status, 'in_progress');
  const next = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, {
    ...body, idempotencyKey: 'response-2', expectedSequence: 2, itemId: attempt.form.items[1].id,
  });
  assert.deepEqual([next.status, next.body.attempt.status, next.body.attempt.sequence], [503, 'system_aborted', 3]);
  assert.equal((await ctx.store.get(attempt.attemptId)).responsesReceived, 1);
});

test('expired learner and admin reads reconcile one durable timeout and report identical terminal state', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  ctx.setClock(DEADLINE);
  const [learner, admin] = await Promise.all([
    ctx.call('GET', `/internal/attempts/${attempt.attemptId}`),
    ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN_HEADERS),
  ]);
  assert.deepEqual([learner.status, admin.status], [200, 200]);
  for (const key of ['status', 'sequence', 'terminalReason', 'failedAt']) {
    assert.deepEqual(learner.body.attempt[key], admin.body.attempt[key], key);
  }
  assert.deepEqual([learner.body.attempt.status, learner.body.attempt.sequence, learner.body.attempt.failedAt],
    ['agent_failed', 2, DEADLINE]);
  assert.equal((await ctx.store.get(attempt.attemptId)).events.filter((event) => event.eventType === 'agent_failed').length, 1);
});

test('response deadline is checked after a slow governance lookup rather than at request entry', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  ctx.setClock(BEFORE_DEADLINE);
  ctx.sources.registration = async () => {
    ctx.setClock(DEADLINE);
    return ctx.input.registration;
  };
  const late = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, responseBody(attempt));
  assert.deepEqual([late.status, late.body.error], [409, 'attempt_deadline_elapsed']);
  const saved = await ctx.store.get(attempt.attemptId);
  assert.deepEqual([saved.status, saved.responsesReceived, saved.failedAt], ['agent_failed', 0, DEADLINE]);
});

test('response replay after timeout preserves its original receipt while every current view reports Agent-Failed', async (t) => {
  const ctx = await boot(t);
  const attempt = await start(ctx);
  ctx.setClock(BEFORE_DEADLINE);
  const body = responseBody(attempt);
  const accepted = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, body);
  assert.equal(accepted.status, 200);
  ctx.setClock(DEADLINE);
  const learner = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`);
  assert.deepEqual([learner.body.attempt.status, learner.body.attempt.sequence], ['agent_failed', 3]);
  const replay = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, body);
  assert.deepEqual([replay.status, replay.body.outcome, replay.body.attempt.status, replay.body.attempt.sequence],
    [200, 'replay', 'agent_failed', 3]);
  assert.deepEqual([replay.body.receipt.status, replay.body.receipt.sequence], ['in_progress', 2]);
  assert.deepEqual(replay.body.receipt, accepted.body.receipt);
  const admin = await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN_HEADERS);
  assert.deepEqual([admin.body.attempt.status, admin.body.attempt.sequence], ['agent_failed', 3]);
});

test('the admin view of a fallback attempt carries fallback identifiers and no standard-only or internal fields', async (t) => {
  // Same contract as fallback-sources.js's selectFallback.
  const selectFallback = async ({ pkg }) => {
    const bank = candidate.fallbackBank;
    const selection = JSON.parse(JSON.stringify({ packageId: pkg.packageId, bankId: bank.id, bankVersion: bank.version,
      scoringPolicy: bank.scoringPolicy, attemptId: 'va-selection-PRIVATE', mode: 'fallback',
      items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
        ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) }));
    return { selection, packageVersion: pkg.version, packageDigest: pkg.digest };
  };
  const ctx = await boot(t, { selectFallback });
  const cause = await start(ctx, 'standard-cause');
  const aborted = await ctx.call('POST', `/internal/attempts/${cause.attemptId}/abort`, { idempotencyKey: 'abort',
    expectedSequence: 1, eventId: randomUUID(), reason: 'grading_unavailable' }, EXAMINER_HEADERS);
  assert.equal(aborted.body.attempt.status, 'system_aborted');
  const started = await ctx.call('POST', '/internal/attempts/fallback', { idempotencyKey: 'fallback', agentLearnerKey: ACTOR,
    reason: 'standard_grading_unavailable', causeAttemptId: cause.attemptId }, EXAMINER_HEADERS);
  assert.equal(started.status, 201);
  const admin = await ctx.call('GET', `/internal/admin/attempts/${started.body.attempt.attemptId}`, undefined, ADMIN_HEADERS);
  assert.equal(admin.status, 200);
  const view = admin.body.attempt;
  assert.equal(view.mode, 'fallback');
  assert.deepEqual([view.causeAttemptId, view.reason], [cause.attemptId, 'standard_grading_unavailable']);
  assert.deepEqual(view.bank, { id: candidate.fallbackBank.id, version: candidate.fallbackBank.version });
  assert.deepEqual(view.rubric.id, 'fallback-scoring/1.0.0');
  assert.equal(view.itemReferences.length, 15);
  assert.deepEqual(Object.keys(view.itemReferences[0]).sort(), ['answerType', 'id', 'objectiveIds', 'tier']);
  for (const field of ['template', 'generationPolicySha256', 'trainingEventId', 'vaSelectionId'])
    assert.equal(Object.hasOwn(view, field), false, field);
  assert.equal(JSON.stringify(admin.body).includes('va-selection-PRIVATE'), false);
  assert.equal(JSON.stringify(admin.body).includes('expectedAnswer'), false);
  assert.equal(JSON.stringify(admin.body).includes('"prompt"'), false);
  // The standard admin view is unchanged.
  const standard = await ctx.call('GET', `/internal/admin/attempts/${cause.attemptId}`, undefined, ADMIN_HEADERS);
  assert.ok(['template', 'generationPolicySha256', 'trainingEventId'].every((field) => Object.hasOwn(standard.body.attempt, field)));
  assert.equal(Object.hasOwn(standard.body.attempt, 'bank'), false);
});
