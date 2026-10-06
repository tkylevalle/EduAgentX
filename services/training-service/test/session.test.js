'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decideContinue, decideStart, decideSubmit, deriveSessionState, nextItem, pinGoverningPackage, pinMismatch,
} = require('../session');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');

const LEARNER = 'learner-1';
const registration = { agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:config-1', configurationVersion: 1 };

const payload = () => ({
  manifest: { packageId: 'pkg-a', version: '1.0.0' },
  objectives: [
    { id: 'o1', deliveryItemIds: ['m1-a'] },
    { id: 'o2', deliveryItemIds: ['m1-b'] },
    { id: 'o3', deliveryItemIds: [] },
  ],
  // Listed out of order on purpose: delivery must follow `sequence`, not array position.
  modules: [
    { id: 'm2', sequence: 2, objectiveIds: ['o3'], deliveryItems: [{ id: 'm2-a', text: 'Lesson B1' }] },
    { id: 'm1', sequence: 1, objectiveIds: ['o1', 'o2'],
      deliveryItems: [{ id: 'm1-a', text: 'Lesson A1' }, { id: 'm1-b', text: 'Lesson A2' }] },
  ],
});

let counter = 0;
const input = (extra = {}) => {
  counter += 1;
  return {
    now: '2026-10-06T10:00:00.000Z',
    evidence: { mode: 'synthetic', environment: 'simulation' },
    correlationId: `correlation-${counter}`,
    actor: LEARNER,
    idempotencyKey: `key-${counter}`,
    requestFingerprint: `fingerprint-${counter}`,
    ...extra,
  };
};

// Builds a started Training Session the way the HTTP layer will: load from the
// sources, decide, then append the returned events.
async function started({ state = 'Active' } = {}) {
  const packages = createFakePackageSource([{ id: 'pkg-a', version: '1.0.0', state, digest: 'digest-1', payload: payload() }]);
  const registry = createFakeRegistrySource([registration]);
  const decision = decideStart(await packages.getActive(), await registry.getRegistration(LEARNER), null,
    input({ sessionId: 'session-1', agentLearnerKey: LEARNER }));
  assert.equal(decision.outcome, 'ok');
  return { packages, registry, session: decision.session, events: [...decision.events] };
}

// Reloads package and registration on every call, as continue and submit must.
async function step(ctx, decide, extra = {}) {
  const decision = decide(await ctx.packages.getById(ctx.session.packageId), deriveSessionState(ctx.events),
    input({ session: ctx.session, registration: await ctx.registry.getRegistration(LEARNER), ...extra }));
  ctx.events.push(...decision.events);
  return decision;
}

const submit = (ctx, deliveryItemId, extra = {}) =>
  step(ctx, decideSubmit, { deliveryItemId, responseDigest: 'sha256:answer', ...extra });

test('nextItem orders modules by sequence, then deliveryItems order, and links objectives', () => {
  const pkg = { id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1', payload: payload() };
  const state = deriveSessionState([]);
  assert.deepEqual(nextItem(pkg, state), {
    moduleId: 'm1', moduleSequence: 1, deliveryItemId: 'm1-a', text: 'Lesson A1',
    objectiveIds: ['o1'], position: 1, total: 3,
  });
  assert.equal(nextItem(pkg, { ...state, completedItemIds: ['m1-a'] }).deliveryItemId, 'm1-b');
  const last = nextItem(pkg, { ...state, completedItemIds: ['m1-a', 'm1-b'] });
  assert.equal(last.deliveryItemId, 'm2-a');
  assert.deepEqual(last.objectiveIds, ['o3'], 'falls back to the module objectives when no objective names the item');
  assert.equal(nextItem(pkg, { ...state, completedItemIds: ['m1-a', 'm1-b', 'm2-a'] }), null);
});

test('deriveSessionState reports not_started, open, completed and blocked from events alone', () => {
  assert.equal(deriveSessionState([]).status, 'not_started');
  const base = { sessionId: 's', packageId: 'p', packageVersion: '1' };
  const open = [{ ...base, seq: 1, eventType: 'session_started' },
    { ...base, seq: 2, eventType: 'item_delivered', deliveryItemId: 'm1-a', storedResponse: { item: 'x' } }];
  assert.equal(deriveSessionState(open).status, 'open');
  assert.equal(deriveSessionState(open).pendingItem.deliveryItemId, 'm1-a');
  assert.equal(deriveSessionState([...open, { ...base, seq: 3, eventType: 'session_completed' }]).status, 'completed');
  const blocked = deriveSessionState([...open, { ...base, seq: 3, eventType: 'session_blocked', blockReason: 'r' }]);
  assert.deepEqual([blocked.status, blocked.blockReason, blocked.lastSeq], ['blocked', 'r', 3]);
});

test('a full Training Session delivers every item once, in order, with complete progress evidence', async () => {
  const ctx = await started();
  const delivered = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const shown = await step(ctx, decideContinue);
    assert.equal(shown.outcome, 'ok');
    if (shown.response.status === 'completed') break;
    delivered.push(shown.response.item.deliveryItemId);
    assert.equal((await submit(ctx, shown.response.item.deliveryItemId)).outcome, 'ok');
  }
  assert.deepEqual(delivered, ['m1-a', 'm1-b', 'm2-a']);
  assert.equal(deriveSessionState(ctx.events).status, 'completed');
  assert.deepEqual(ctx.events.map((event) => event.eventType), [
    'session_started',
    'item_delivered', 'item_completed', 'item_delivered', 'item_completed', 'item_delivered', 'item_completed',
    'session_completed',
  ]);
  assert.deepEqual(ctx.events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const event of ctx.events) {
    assert.equal(event.packageId, 'pkg-a');
    assert.equal(event.packageVersion, '1.0.0');
    assert.equal(event.evidenceMode, 'synthetic');
    assert.equal(event.evidenceEnvironment, 'simulation');
    assert.equal(event.occurredAt, '2026-10-06T10:00:00.000Z');
  }
  for (const event of ctx.events.filter((e) => e.eventType.startsWith('item_'))) {
    assert.ok(event.moduleId && Number.isInteger(event.moduleSequence) && event.objectiveIds.length, event.eventType);
  }
});

test('resume after interruption keeps the governing package and never duplicates a completion', async () => {
  const ctx = await started();
  await step(ctx, decideContinue);
  assert.equal((await submit(ctx, 'm1-a')).outcome, 'ok');

  // The Agent Learner reconnects and calls start again: same session, nothing appended.
  const resumed = decideStart(await ctx.packages.getById('pkg-a'), registration,
    { session: ctx.session, state: deriveSessionState(ctx.events) },
    input({ sessionId: 'session-2', agentLearnerKey: LEARNER }));
  assert.equal(resumed.outcome, 'ok');
  assert.equal(resumed.session.sessionId, 'session-1');
  assert.equal(resumed.session.packageDigest, ctx.session.packageDigest);
  assert.equal(resumed.response.resumed, true);
  assert.deepEqual(resumed.events, []);

  const shown = await step(ctx, decideContinue);
  assert.equal(shown.response.item.deliveryItemId, 'm1-b');
  const shownAgain = await step(ctx, decideContinue);
  assert.deepEqual([shownAgain.outcome, shownAgain.events.length], ['ok', 0]);
  assert.deepEqual(shownAgain.response, shown.response, 'an open item is re-sent, not re-delivered');

  const duplicate = await submit(ctx, 'm1-a');
  assert.deepEqual([duplicate.outcome, duplicate.reason, duplicate.events.length], ['conflict', 'out_of_sequence', 0]);
  const completions = ctx.events.filter((e) => e.eventType === 'item_completed' && e.deliveryItemId === 'm1-a');
  assert.equal(completions.length, 1);
});

test('the same idempotency key with the same content replays the stored response', async () => {
  const ctx = await started();
  const shown = await step(ctx, decideContinue, { idempotencyKey: 'deliver-1', requestFingerprint: 'fp-deliver' });
  const replayedShow = await step(ctx, decideContinue, { idempotencyKey: 'deliver-1', requestFingerprint: 'fp-deliver' });
  assert.equal(replayedShow.outcome, 'replay');
  assert.deepEqual(replayedShow.response, shown.response);

  const done = await submit(ctx, 'm1-a', { idempotencyKey: 'submit-1', requestFingerprint: 'fp-submit' });
  const count = ctx.events.length;
  const replayedDone = await submit(ctx, 'm1-a', { idempotencyKey: 'submit-1', requestFingerprint: 'fp-submit' });
  assert.equal(replayedDone.outcome, 'replay');
  assert.deepEqual(replayedDone.response, done.response);
  assert.equal(ctx.events.length, count, 'a replay appends nothing');
});

test('the same idempotency key with different content conflicts', async () => {
  const ctx = await started();
  await step(ctx, decideContinue);
  await submit(ctx, 'm1-a', { idempotencyKey: 'submit-1', requestFingerprint: 'fp-a' });
  const conflict = await submit(ctx, 'm1-a', { idempotencyKey: 'submit-1', requestFingerprint: 'fp-b' });
  assert.deepEqual([conflict.outcome, conflict.reason, conflict.events.length], ['conflict', 'idempotency_conflict', 0]);
});

for (const state of ['Candidate', 'Quarantined', 'AwaitingReview']) {
  test(`a ${state} package cannot start or continue delivery`, async () => {
    const offered = { id: 'pkg-a', version: '1.0.0', state, digest: 'digest-1', payload: payload() };
    const refused = decideStart(offered, registration, null, input({ sessionId: 's', agentLearnerKey: LEARNER }));
    assert.deepEqual([refused.outcome, refused.reason, refused.events.length], ['rejected', 'package_not_active', 0]);

    const ctx = await started();
    await step(ctx, decideContinue);
    ctx.packages.setState('pkg-a', state);
    const blocked = await submit(ctx, 'm1-a');
    assert.deepEqual([blocked.outcome, blocked.reason], ['blocked', `package_state:${state}`]);
    assert.deepEqual(blocked.events.map((e) => e.eventType), ['session_blocked']);
    assert.equal(deriveSessionState(ctx.events).status, 'blocked');

    const again = await step(ctx, decideContinue);
    assert.deepEqual([again.outcome, again.events.length], ['blocked', 0], 'a block is recorded once');
  });
}

test('a Superseded package keeps a running session going but cannot start a new one', async () => {
  const ctx = await started();
  await step(ctx, decideContinue);
  ctx.packages.setState('pkg-a', 'Superseded');
  assert.equal((await submit(ctx, 'm1-a')).outcome, 'ok');
  assert.equal((await step(ctx, decideContinue)).response.item.deliveryItemId, 'm1-b');

  const superseded = await ctx.packages.getById('pkg-a');
  const resumed = decideStart(superseded, registration,
    { session: ctx.session, state: deriveSessionState(ctx.events) }, input({ sessionId: 's2', agentLearnerKey: LEARNER }));
  assert.equal(resumed.outcome, 'ok');
  const fresh = decideStart(superseded, registration, null, input({ sessionId: 's3', agentLearnerKey: LEARNER }));
  assert.deepEqual([fresh.outcome, fresh.reason], ['rejected', 'package_not_active']);
});

test('a changed package digest blocks the session even while the package is Active', async () => {
  const ctx = await started();
  ctx.packages.setDigest('pkg-a', 'digest-2');
  const blocked = await step(ctx, decideContinue);
  assert.deepEqual([blocked.outcome, blocked.reason, blocked.events.length], ['blocked', 'package_digest_changed', 1]);
});

test('a changed configuration fingerprint blocks the session', async () => {
  const ctx = await started();
  ctx.registry.setFingerprint(LEARNER, 'sha256:config-2');
  const blocked = await step(ctx, decideContinue);
  assert.deepEqual([blocked.outcome, blocked.reason, blocked.events.length], ['blocked', 'configuration_changed', 1]);
});

test('start is refused without a registration, an Active package, a digest, or deliverable modules', () => {
  const pkg = { id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1', payload: payload() };
  const start = (p, r) => decideStart(p, r, null, input({ sessionId: 's', agentLearnerKey: LEARNER }));
  assert.equal(start(pkg, null).reason, 'not_registered');
  assert.equal(start(null, registration).reason, 'no_active_package');
  assert.equal(start({ ...pkg, digest: null }, registration).reason, 'package_not_pinnable');
  const broken = payload();
  delete broken.modules[0].sequence;
  assert.equal(start({ ...pkg, payload: broken }, registration).reason, 'package_not_deliverable');

  const ok = start(pkg, registration);
  assert.equal(ok.outcome, 'ok');
  assert.deepEqual(ok.session, {
    sessionId: 's', agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:config-1', configurationVersion: 1,
    packageId: 'pkg-a', packageVersion: '1.0.0', packageDigest: 'digest-1',
    startedAt: '2026-10-06T10:00:00.000Z', correlationId: ok.events[0].correlationId,
  });
  assert.deepEqual(ok.events.map((e) => [e.seq, e.eventType]), [[1, 'session_started']]);
});

test('pinning uses the validation service packageId and digest, not a digest Training computes', () => {
  const pkg = { id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1', payload: payload() };
  const pin = pinGoverningPackage(pkg);
  assert.deepEqual(pin, { packageId: 'pkg-a', packageVersion: '1.0.0', packageDigest: 'digest-1' });
  assert.equal(pinMismatch(pkg, pin), null);
  assert.equal(pinMismatch({ ...pkg, digest: 'digest-2' }, pin), 'package_digest_changed');
  assert.equal(pinMismatch({ ...pkg, id: 'pkg-b' }, pin), 'package_identity_changed');
});
