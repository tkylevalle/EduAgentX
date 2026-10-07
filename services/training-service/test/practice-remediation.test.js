'use strict';

// Issue 13 decisions: bounded practice, completion policy, one completion
// event, resume evidence and structured remediation.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decideContinue, decideRemediation, decideStart, decideSubmit, deriveSessionState,
} = require('../session');
const { completionPolicy } = require('../plan');

const LEARNER = 'learner-1';
const registration = { agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:config-1', configurationVersion: 1 };
const payload = () => ({
  objectives: [
    { id: 'o1', deliveryItemIds: ['m1-lesson', 'm1-practice'] },
    { id: 'o2', deliveryItemIds: ['m2-lesson', 'm2-practice'] },
  ],
  modules: [
    { id: 'm1', sequence: 1, deliveryItems: [
      { id: 'm1-lesson', kind: 'lesson', text: 'L1' }, { id: 'm1-practice', kind: 'practice', text: 'P1' }] },
    { id: 'm2', sequence: 2, deliveryItems: [
      { id: 'm2-lesson', kind: 'lesson', text: 'L2' }, { id: 'm2-practice', kind: 'practice', text: 'P2' }] },
  ],
});
const pkg = (overrides = {}) => ({ id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1', payload: payload(), ...overrides });

let counter = 0;
const input = (extra = {}) => {
  counter += 1;
  return {
    now: '2026-10-07T10:00:00.000Z', evidence: { mode: 'synthetic', environment: 'simulation' },
    correlationId: `c-${counter}`, actor: LEARNER, idempotencyKey: `k-${counter}`, requestFingerprint: `f-${counter}`,
    policy: completionPolicy(), ...extra,
  };
};
const cause = { type: 'examination_failure', reference: 'attempt-7', evidenceDigest: `sha256:${'a'.repeat(64)}`,
  observedAt: '2026-10-07T09:00:00.000Z', summary: null };
const remediationInput = (extra = {}) => input({
  sessionId: 'rem-1', agentLearnerKey: LEARNER, actor: 'operator-1', requestId: 'req-1', packageId: 'pkg-a',
  packageVersion: '1.0.0', objectiveIds: ['o2'], cause, requestDigest: 'sha256:request-1', ...extra,
});

// Applies decisions to an in-test event log, as the store would.
function run(session, events = []) {
  const ctx = { session, events };
  ctx.apply = (decision) => { ctx.events.push(...decision.events); return decision; };
  ctx.state = () => deriveSessionState(ctx.events);
  ctx.next = (extra = {}) => ctx.apply(decideContinue(pkg(), ctx.state(), input({ session, registration, ...extra })));
  ctx.submit = (deliveryItemId, extra = {}) => ctx.apply(decideSubmit(pkg(), ctx.state(), input({
    session, registration, deliveryItemId, responseDigest: 'sha256:x', responseLength: 10, ...extra })));
  return ctx;
}

function startStandard(policy = completionPolicy()) {
  const decision = decideStart(pkg(), registration, null, input({ sessionId: 's-1', agentLearnerKey: LEARNER, policy }));
  assert.equal(decision.outcome, 'ok');
  return run(decision.session, [...decision.events]);
}

function walk(ctx) {
  const delivered = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const shown = ctx.next();
    if (shown.response.status === 'completed') break;
    delivered.push(shown.response.item.deliveryItemId);
    const done = ctx.submit(shown.response.item.deliveryItemId);
    assert.equal(done.outcome, 'ok');
    if (done.response.status === 'completed') return { delivered, last: done };
  }
  return { delivered };
}

test('a package without the configured practice per module cannot start a session', () => {
  const lessonsOnly = payload();
  for (const module of lessonsOnly.modules) module.deliveryItems = module.deliveryItems.filter((i) => i.kind === 'lesson');
  const refused = decideStart(pkg({ payload: lessonsOnly }), registration, null, input({ sessionId: 's', agentLearnerKey: LEARNER }));
  assert.deepEqual([refused.outcome, refused.reason, refused.events.length], ['rejected', 'insufficient_practice', 0]);
  const twoNeeded = decideStart(pkg(), registration, null,
    input({ sessionId: 's', agentLearnerKey: LEARNER, policy: completionPolicy({ minPracticeItemsPerModule: 2 }) }));
  assert.equal(twoNeeded.reason, 'insufficient_practice');
});

test('practice is bounded: one accepted answer per item, a length cap, tied to module and objectives', () => {
  const ctx = startStandard(completionPolicy({ maxResponseChars: 50 }));
  ctx.next();
  ctx.submit('m1-lesson');
  const shown = ctx.next();
  assert.equal(shown.response.item.kind, 'practice');
  assert.deepEqual([shown.response.item.moduleId, shown.response.item.objectiveIds], ['m1', ['o1']]);
  assert.deepEqual(shown.response.bounds,
    { maxResponseChars: 50, acceptedResponsesPerItem: 1, graded: false, modelWeightsModified: false });

  const tooLong = ctx.submit('m1-practice', { responseLength: 51 });
  assert.deepEqual([tooLong.outcome, tooLong.reason, tooLong.events.length], ['rejected', 'response_too_long', 0]);
  const accepted = ctx.submit('m1-practice', { responseLength: 50 });
  assert.equal(accepted.outcome, 'ok');
  assert.equal(accepted.response.modelWeightsModified, false);
  const completedEvent = ctx.events.at(-1);
  assert.deepEqual([completedEvent.eventType, completedEvent.itemKind, completedEvent.moduleId, completedEvent.objectiveIds],
    ['item_completed', 'practice', 'm1', ['o1']]);
  const again = ctx.submit('m1-practice');
  assert.deepEqual([again.outcome, again.reason], ['conflict', 'nothing_delivered'], 'a second answer is not accepted');
});

test('completion appends one session_completed event and one completion envelope', () => {
  const ctx = startStandard();
  const { delivered, last } = walk(ctx);
  assert.deepEqual(delivered, ['m1-lesson', 'm1-practice', 'm2-lesson', 'm2-practice']);
  assert.deepEqual(last.events.map((e) => e.eventType), ['item_completed', 'session_completed']);
  assert.deepEqual(last.completion, {
    eventId: 'training.session.completed:s-1', eventType: 'training.session.completed', schemaVersion: '1.0.0',
    occurredAt: '2026-10-07T10:00:00.000Z', correlationId: last.events[0].correlationId,
    agentLearnerKey: LEARNER, configurationFingerprint: 'sha256:config-1', configurationVersion: 1,
    sessionId: 's-1', sessionKind: 'standard', remediationRequestId: null,
    package: { id: 'pkg-a', version: '1.0.0', digest: 'digest-1' },
    completionPolicy: completionPolicy(),
    completion: { plannedItems: 4, completedItems: 4, practiceCompleted: 2, modules: ['m1', 'm2'], objectiveIds: ['o1', 'o2'] },
    evidence: { mode: 'synthetic', environment: 'simulation' },
  });
  const after = ctx.submit('m2-practice');
  assert.deepEqual([after.outcome, after.reason, after.completion], ['conflict', 'session_completed', undefined]);
  assert.equal(ctx.events.filter((e) => e.eventType === 'session_completed').length, 1);
});

test('a legacy session without a stored policy completes under the policy it started with', () => {
  const legacy = payload();
  for (const module of legacy.modules) module.deliveryItems = module.deliveryItems.filter((i) => i.kind === 'lesson');
  const decision = decideStart(pkg({ payload: legacy }), registration, null,
    input({ sessionId: 's-old', agentLearnerKey: LEARNER, policy: completionPolicy({ minPracticeItemsPerModule: 0 }) }));
  const { completionPolicy: dropped, deliveryPlan, kind, remediation, ...oldShape } = decision.session;
  const ctx = run(oldShape, [...decision.events]);
  const lessons = { ...pkg({ payload: legacy }) };
  ctx.next = () => ctx.apply(decideContinue(lessons, ctx.state(), input({ session: oldShape, registration })));
  ctx.submit = (id) => ctx.apply(decideSubmit(lessons, ctx.state(), input({
    session: oldShape, registration, deliveryItemId: id, responseDigest: 'sha256:x', responseLength: 1 })));
  const { last } = walk(ctx);
  assert.equal(last.response.status, 'completed');
  assert.equal(last.completion.completionPolicy.version, 'training-completion/0');
});

test('a completed session stays completed when its package later changes state', () => {
  const ctx = startStandard();
  walk(ctx);
  const quarantined = pkg({ state: 'Quarantined', digest: 'digest-2' });
  const next = decideContinue(quarantined, ctx.state(), input({ session: ctx.session, registration }));
  assert.deepEqual([next.outcome, next.events, next.response.status], ['ok', [], 'completed']);
  const submit = decideSubmit(quarantined, ctx.state(), input({
    session: ctx.session, registration, deliveryItemId: 'm2-practice', responseDigest: 'sha256:x', responseLength: 10 }));
  assert.deepEqual([submit.outcome, submit.reason], ['conflict', 'session_completed']);
  const lastKey = ctx.events.at(-1);
  const retried = decideContinue(quarantined, ctx.state(), input({
    session: ctx.session, registration, idempotencyKey: lastKey.idempotencyKey, requestFingerprint: lastKey.requestFingerprint }));
  assert.deepEqual(retried.events, [], 'a retry after completion never appends a block');
  assert.equal(ctx.events.filter((e) => e.eventType === 'session_blocked').length, 0);
});
test('calling start on an open session records a resume and replays a retried start', () => {
  const ctx = startStandard();
  const firstKey = ctx.events[0].idempotencyKey;
  const retried = decideStart(pkg(), registration, { session: ctx.session, state: ctx.state() },
    input({ agentLearnerKey: LEARNER, idempotencyKey: firstKey, requestFingerprint: ctx.events[0].requestFingerprint }));
  assert.deepEqual([retried.outcome, retried.events.length, retried.response.resumed], ['replay', 0, false]);
  const reused = decideStart(pkg(), registration, { session: ctx.session, state: ctx.state() },
    input({ agentLearnerKey: LEARNER, idempotencyKey: firstKey, requestFingerprint: 'other' }));
  assert.deepEqual([reused.outcome, reused.reason], ['conflict', 'idempotency_conflict']);

  ctx.apply(decideStart(pkg(), registration, { session: ctx.session, state: ctx.state() },
    input({ agentLearnerKey: LEARNER, idempotencyKey: 'resume-1' })));
  ctx.apply(decideStart(pkg(), registration, { session: ctx.session, state: ctx.state() },
    input({ agentLearnerKey: LEARNER, idempotencyKey: 'resume-2' })));
  assert.equal(ctx.state().resumeCount, 2);
  assert.equal(ctx.state().status, 'open');
});

test('a remediation request assigns only the targeted content and keeps the evidence that caused it', () => {
  const assigned = decideRemediation(pkg(), registration, {}, remediationInput());
  assert.equal(assigned.outcome, 'ok');
  assert.deepEqual(assigned.events.map((e) => [e.seq, e.eventType, e.objectiveIds, e.actor]),
    [[1, 'remediation_assigned', ['o2'], 'operator-1']]);
  assert.deepEqual(assigned.session.remediation, {
    requestId: 'req-1', objectiveIds: ['o2'], cause, requestedBy: 'operator-1', requestDigest: 'sha256:request-1',
    requestedAt: '2026-10-07T10:00:00.000Z' });
  assert.deepEqual(assigned.session.deliveryPlan.map((item) => item.deliveryItemId), ['m2-lesson', 'm2-practice']);
  assert.deepEqual([assigned.response.status, assigned.response.kind, assigned.response.plannedItems],
    ['assigned', 'remediation', 2]);

  const ctx = run(assigned.session, [...assigned.events]);
  assert.equal(ctx.state().status, 'assigned');
  const early = ctx.next();
  assert.deepEqual([early.outcome, early.reason], ['rejected', 'session_not_started']);

  const started = ctx.apply(decideStart(pkg(), registration, { session: ctx.session, state: ctx.state() },
    input({ agentLearnerKey: LEARNER })));
  assert.deepEqual([started.events[0].eventType, started.response.resumed, started.response.kind],
    ['session_started', false, 'remediation']);
  const { delivered, last } = walk(ctx);
  assert.deepEqual(delivered, ['m2-lesson', 'm2-practice']);
  assert.deepEqual([last.completion.sessionKind, last.completion.remediationRequestId, last.completion.completion.objectiveIds],
    ['remediation', 'req-1', ['o2']]);
});

test('a remediation request is idempotent by requestId and refuses unsafe or unknown targets', () => {
  const assigned = decideRemediation(pkg(), registration, {}, remediationInput());
  const existingRequest = { session: assigned.session, events: assigned.events };
  const replay = decideRemediation(null, null, { existingRequest }, remediationInput({ sessionId: 'rem-2' }));
  assert.deepEqual([replay.outcome, replay.events.length, replay.response.sessionId], ['replay', 0, 'rem-1']);
  const changed = decideRemediation(null, null, { existingRequest }, remediationInput({ requestDigest: 'sha256:other' }));
  assert.deepEqual([changed.outcome, changed.reason], ['conflict', 'remediation_request_conflict']);

  const busy = decideRemediation(pkg(), registration, { openSession: { sessionId: 's-1' } }, remediationInput());
  assert.deepEqual([busy.outcome, busy.reason], ['conflict', 'session_in_progress']);
  const reason = (p, r, extra) => decideRemediation(p, r, {}, remediationInput(extra)).reason;
  assert.equal(reason(pkg(), null), 'not_registered');
  assert.equal(reason(pkg({ state: 'Quarantined' }), registration), 'package_not_active');
  assert.equal(reason(pkg(), registration, { packageVersion: '0.9.0' }), 'package_mismatch');
  assert.equal(reason(pkg(), registration, { objectiveIds: ['o9'] }), 'unknown_objectives');
  const unlinked = payload();
  unlinked.objectives.push({ id: 'o3', deliveryItemIds: [] });
  assert.equal(reason(pkg({ payload: unlinked }), registration, { objectiveIds: ['o3'] }), 'no_targeted_content');
  assert.equal(reason(pkg(), registration, { policy: completionPolicy({ minPracticeItemsPerModule: 2 }) }),
    'insufficient_practice');
});
