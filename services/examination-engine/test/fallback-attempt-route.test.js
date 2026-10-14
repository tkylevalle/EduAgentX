'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { fail } = require('../lifecycle');

const INTERNAL_KEY = 'fallback-route-service-key';
const GRADING_KEY = 'fallback-route-grading-key';
const ACTOR = 'fallback-route-learner';
const START = '2026-10-14T06:00:00.000Z';
const AGENT_HEADERS = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': ACTOR, 'x-actor-role': 'agent' };
const EXAMINER_HEADERS = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': 'trusted-operator',
  'x-actor-role': 'examiner', 'x-internal-grading-key': GRADING_KEY };

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registrations = new Map([[ACTOR, 'sha256:fallback-route-fingerprint'], ['other-learner', 'sha256:other']]);
  const completion = (actor) => ({ eventType: 'training.session.completed', eventId: `completed-${actor}`,
    sessionId: `session-${actor}`, agentLearnerKey: actor, configurationFingerprint: registrations.get(actor),
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest }, completion: { plannedItems: 10, completedItems: 10 } });
  return { pkg, registrations, completion };
}

// Fake with the same contract as fallback-sources.js's selectFallback.
function selectionFor(pkg) {
  const bank = candidate.fallbackBank;
  return JSON.parse(JSON.stringify({ packageId: pkg.packageId, bankId: bank.id, bankVersion: bank.version,
    scoringPolicy: bank.scoringPolicy, attemptId: randomUUID(), mode: 'fallback',
    items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) }));
}

async function boot(t) {
  const input = fixture();
  const store = createMemoryStore();
  const ctx = { input, store, selectCalls: [] };
  const sources = {
    activePackage: async () => input.pkg,
    registration: async (actor) => input.registrations.has(actor)
      ? { agentLearnerKey: actor, configurationFingerprint: input.registrations.get(actor) } : null,
    completion: async (actor) => input.completion(actor),
  };
  ctx.select = async ({ pkg }) => ({ selection: selectionFor(pkg), packageVersion: pkg.version, packageDigest: pkg.digest });
  const selectFallback = async (args) => { ctx.selectCalls.push(args); return ctx.select(args); };
  const server = http.createServer(createApp({ store, sources, internalKey: INTERNAL_KEY, gradingKey: GRADING_KEY,
    clock: () => START, durationMinutes: 60, selectFallback }));
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
  ctx.fallback = (body) => ctx.call('POST', '/internal/attempts/fallback', body, EXAMINER_HEADERS);
  return ctx;
}

// A real standard attempt, started by its learner and aborted through the trusted route.
async function abortedStandard(ctx, { actor = ACTOR, reason = 'grading_unavailable', key = randomUUID() } = {}) {
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: key },
    { ...AGENT_HEADERS, 'x-actor-subject': actor });
  assert.equal(started.status, 201);
  if (reason === null) return started.body.attempt;
  const aborted = await ctx.call('POST', `/internal/attempts/${started.body.attempt.attemptId}/abort`,
    { idempotencyKey: `abort-${key}`, expectedSequence: started.body.attempt.sequence, eventId: randomUUID(), reason },
    EXAMINER_HEADERS);
  assert.deepEqual([aborted.status, aborted.body.attempt.status, aborted.body.attempt.terminalReason],
    [200, 'system_aborted', reason]);
  return aborted.body.attempt;
}
const gradingRequest = (cause, overrides = {}) => ({ idempotencyKey: 'fallback-1', agentLearnerKey: ACTOR,
  reason: 'standard_grading_unavailable', causeAttemptId: cause.attemptId, ...overrides });

test('a grading-outage fallback for a real system-aborted cause starts a new labelled attempt with answer types', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  const started = await ctx.fallback(gradingRequest(cause));
  assert.deepEqual([started.status, started.body.outcome], [201, 'started']);
  const { attempt } = started.body;
  assert.notEqual(attempt.attemptId, cause.attemptId);
  assert.deepEqual([attempt.mode, attempt.status, attempt.sequence], ['fallback', 'in_progress', 1]);
  assert.equal(attempt.form.schemaVersion, 'examination-form-fallback/1.0.0');
  assert.equal(attempt.form.mode, 'fallback');
  const multiple = attempt.form.items.find((item) => item.answerType === 'multiple_choice');
  assert.ok(Array.isArray(multiple.choices) && multiple.choices.length);
  assert.equal(JSON.stringify(started.body).includes('expectedAnswer'), false);
  assert.deepEqual(ctx.selectCalls.map(({ reason }) => reason), ['standard_grading_unavailable']);
  const saved = await ctx.store.get(attempt.attemptId);
  assert.deepEqual([saved.fallbackCauseAttemptId, saved.fallbackReason, saved.fallbackBankId],
    [cause.attemptId, 'standard_grading_unavailable', candidate.fallbackBank.id]);
  assert.deepEqual(saved.package, { id: ctx.input.pkg.packageId, version: ctx.input.pkg.version, digest: ctx.input.pkg.digest });
  // The learner's own read delivers the fallback projection, not the standard one.
  const read = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}`, undefined, AGENT_HEADERS);
  assert.deepEqual([read.status, read.body.attempt.form.mode], [200, 'fallback']);
  assert.ok(read.body.attempt.form.items.every((item) => typeof item.answerType === 'string'));
});

test('the same idempotency key replays without selecting a second bank; a changed meaning conflicts', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  const first = await ctx.fallback(gradingRequest(cause));
  const again = await ctx.fallback(gradingRequest(cause));
  assert.deepEqual([again.status, again.body.outcome, again.body.attempt.attemptId], [200, 'replay', first.body.attempt.attemptId]);
  assert.equal(ctx.selectCalls.length, 1);
  const changed = await ctx.fallback({ ...gradingRequest(cause), reason: 'standard_generation_unavailable', causeAttemptId: null });
  assert.deepEqual([changed.status, changed.body.error], [409, 'idempotency_conflict']);
  // A second fallback for the same cause under a new key is refused by the store.
  const second = await ctx.fallback(gradingRequest(cause, { idempotencyKey: 'fallback-2' }));
  assert.deepEqual([second.status, second.body.error], [409, 'fallback_already_admitted']);
});

test('a cause owned by another learner, still in progress, or aborted for another reason is refused', async (t) => {
  const ctx = await boot(t);
  const othersCause = await abortedStandard(ctx, { actor: 'other-learner' });
  const inProgress = await abortedStandard(ctx, { reason: null });
  const infrastructure = await abortedStandard(ctx, { reason: 'infrastructure_failure' });
  const governance = await abortedStandard(ctx, { reason: 'governance_changed' });
  for (const [cause, error] of [[othersCause, 'fallback_cause_wrong_learner'], [inProgress, 'fallback_cause_not_aborted'],
    [infrastructure, 'fallback_cause_reason_mismatch'], [governance, 'fallback_cause_reason_mismatch']]) {
    const refused = await ctx.fallback(gradingRequest(cause, { idempotencyKey: `refused-${error}-${cause.attemptId}` }));
    assert.deepEqual([refused.status, refused.body.error], [409, error]);
  }
  const missing = await ctx.fallback(gradingRequest({ attemptId: randomUUID() }, { idempotencyKey: 'missing' }));
  assert.deepEqual([missing.status, missing.body.error], [404, 'fallback_cause_not_found']);
  assert.equal(ctx.selectCalls.length, 0);
});

test('a fallback cannot be caused by another fallback, and a changed fingerprint does not carry over', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  const fallback = await ctx.fallback(gradingRequest(cause));
  const abortedFallback = await ctx.call('POST', `/internal/attempts/${fallback.body.attempt.attemptId}/abort`,
    { idempotencyKey: 'abort-fallback', expectedSequence: 1, eventId: randomUUID(), reason: 'grading_unavailable' }, EXAMINER_HEADERS);
  assert.equal(abortedFallback.body.attempt.status, 'system_aborted');
  const chained = await ctx.fallback(gradingRequest(abortedFallback.body.attempt, { idempotencyKey: 'chained' }));
  assert.deepEqual([chained.status, chained.body.error], [409, 'fallback_cause_not_standard']);
  const second = await abortedStandard(ctx);
  ctx.input.registrations.set(ACTOR, 'sha256:reconfigured-agent');
  const changed = await ctx.fallback(gradingRequest(second, { idempotencyKey: 'reconfigured' }));
  assert.deepEqual([changed.status, changed.body.error], [409, 'fallback_cause_fingerprint_changed']);
  assert.equal(ctx.selectCalls.length, 1);
});

test('a generation-outage fallback needs no cause and starts a fallback attempt', async (t) => {
  const ctx = await boot(t);
  const started = await ctx.fallback({ idempotencyKey: 'generation-1', agentLearnerKey: ACTOR,
    reason: 'standard_generation_unavailable', causeAttemptId: null });
  assert.deepEqual([started.status, started.body.attempt.mode], [201, 'fallback']);
  const omitted = await ctx.fallback({ idempotencyKey: 'generation-2', agentLearnerKey: ACTOR, reason: 'standard_generation_unavailable' });
  assert.equal(omitted.status, 201);
  assert.equal((await ctx.store.get(started.body.attempt.attemptId)).fallbackCauseAttemptId, null);
  assert.deepEqual(ctx.selectCalls.map(({ reason }) => reason), ['standard_generation_unavailable', 'standard_generation_unavailable']);
});

test('invalid reason/cause combinations and untrusted callers are refused before any work', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  for (const body of [
    gradingRequest(cause, { causeAttemptId: null }), gradingRequest(cause, { causeAttemptId: 'not-a-uuid' }),
    { idempotencyKey: 'g', agentLearnerKey: ACTOR, reason: 'standard_generation_unavailable', causeAttemptId: cause.attemptId },
    gradingRequest(cause, { reason: 'grading_unavailable' }), gradingRequest(cause, { reason: 'infrastructure_failure' }),
    gradingRequest(cause, { agentLearnerKey: '' }), gradingRequest(cause, { idempotencyKey: '\n' }),
    { ...gradingRequest(cause), extra: true }]) {
    const refused = await ctx.fallback(body);
    assert.deepEqual([refused.status, refused.body.error], [400, 'invalid_request'], JSON.stringify(body));
  }
  for (const headers of [AGENT_HEADERS, { ...EXAMINER_HEADERS, 'x-internal-grading-key': 'wrong' }]) {
    assert.equal((await ctx.call('POST', '/internal/attempts/fallback', gradingRequest(cause), headers)).status, 403);
  }
  assert.equal(ctx.selectCalls.length, 0);
});

test('a quarantined or refused selection admits nothing', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  ctx.select = async () => { throw Object.assign(fail('fallback_scope_quarantined'), { source: 'validation-activation', upstreamStatus: 409 }); };
  const refused = await ctx.fallback(gradingRequest(cause));
  assert.deepEqual([refused.status, refused.body.error], [409, 'fallback_scope_quarantined']);
  assert.equal(await ctx.store.findByKey(ACTOR, 'fallback-1'), null);
  // A quarantine visible in governance itself stops the request before selection.
  ctx.input.pkg = { ...ctx.input.pkg, quarantinedScopes: [{ scopeType: 'module', scopeId: 'm1' }] };
  const blocked = await ctx.fallback(gradingRequest(cause, { idempotencyKey: 'fallback-2' }));
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'active_package_required']);
  assert.equal(await ctx.store.findByKey(ACTOR, 'fallback-2'), null);
  assert.equal(ctx.selectCalls.length, 1);
});

test('a package that changes between the two Active checks is refused and admits nothing', async (t) => {
  const ctx = await boot(t);
  const cause = await abortedStandard(ctx);
  const original = ctx.input.pkg;
  ctx.select = async ({ pkg }) => {
    // Governance moves to a new version while the selection call is in flight.
    ctx.input.pkg = { ...original, version: `${original.version}-next`, digest: 'e'.repeat(64) };
    return { selection: selectionFor(pkg), packageVersion: pkg.version, packageDigest: pkg.digest };
  };
  const refused = await ctx.fallback(gradingRequest(cause));
  assert.deepEqual([refused.status, refused.body.error], [409, 'fallback_governance_changed']);
  assert.equal(await ctx.store.findByKey(ACTOR, 'fallback-1'), null);
});
