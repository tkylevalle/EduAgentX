'use strict';

// Training Session decisions as pure functions: no HTTP, no database, no clock.
// The caller loads the package and registration through PackageSource and
// RegistrySource, passes `now`, and appends the returned events in one
// transaction. Session state is never stored; it is derived from the events.
// Training delivers curriculum and bounded practice only. It never grades,
// and it has no route to an Agent Learner's model weights.

const {
  LEGACY_POLICY, completionStatus, deliveryPlan, planSummary, practiceShortfall, sessionPlan, targetPlan,
} = require('./plan');

const EVENT_TYPES = Object.freeze([
  'session_started', 'item_delivered', 'item_completed', 'session_completed', 'session_blocked',
  'session_resumed', 'remediation_assigned',
]);
// A new session needs the current Active package. A running session may finish
// on its pinned version after a newer one supersedes it; any other state
// (Candidate, Quarantined, or anything unknown) stops delivery.
const CONTINUE_STATES = new Set(['Active', 'Superseded']);
const COMPLETION_EVENT_TYPE = 'training.session.completed';
const COMPLETION_SCHEMA_VERSION = '1.0.0';

// --- Package pinning: the only place that decides what "the same package" means.
// A session is pinned to the validation service's packageId + digest. Training
// does not compute its own digest, so it detects a change only when that
// service reports a new digest for the pinned packageId.
function pinGoverningPackage(pkg) {
  return { packageId: pkg.id, packageVersion: pkg.version, packageDigest: pkg.digest };
}

function pinMismatch(pkg, session) {
  if (pkg.id !== session.packageId) return 'package_identity_changed';
  if (pkg.digest !== session.packageDigest) return 'package_digest_changed';
  return null;
}

const isPinnable = (pkg) => typeof pkg.id === 'string' && pkg.id.length > 0 &&
  typeof pkg.digest === 'string' && pkg.digest.length > 0;

const policyOf = (session) => session.completionPolicy || LEGACY_POLICY;

function deriveSessionState(events) {
  const state = {
    status: 'not_started', lastSeq: 0, completedItemIds: [], pendingItem: null, blockReason: null,
    resumeCount: 0, replies: new Map(), lastEventAt: null,
  };
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    state.lastSeq = event.seq;
    state.lastEventAt = event.occurredAt;
    if (event.idempotencyKey) {
      state.replies.set(event.idempotencyKey, { requestFingerprint: event.requestFingerprint, response: event.storedResponse });
    }
    if (event.eventType === 'remediation_assigned') state.status = 'assigned';
    if (event.eventType === 'session_started') state.status = 'open';
    if (event.eventType === 'session_resumed') state.resumeCount += 1;
    if (event.eventType === 'item_delivered') {
      state.pendingItem = {
        moduleId: event.moduleId, moduleSequence: event.moduleSequence, deliveryItemId: event.deliveryItemId,
        itemKind: event.itemKind ?? 'lesson', objectiveIds: event.objectiveIds, response: event.storedResponse,
      };
    }
    if (event.eventType === 'item_completed') {
      state.completedItemIds.push(event.deliveryItemId);
      state.pendingItem = null;
    }
    if (event.eventType === 'session_completed') state.status = 'completed';
    if (event.eventType === 'session_blocked') {
      state.status = 'blocked';
      state.blockReason = event.blockReason;
    }
  }
  return state;
}

// The first item in this session's plan that is not yet completed, or null when done.
function nextItem(pkg, state, session) {
  const plan = sessionPlan(pkg.payload, session);
  if (!plan) throw new Error('package_not_deliverable');
  return plan.find((item) => !state.completedItemIds.includes(item.deliveryItemId)) || null;
}

function decideStart(pkg, registration, existing, input) {
  if (existing) return decideExistingStart(pkg, registration, existing, input);
  if (!registration || registration.agentLearnerKey !== input.agentLearnerKey) return rejected('not_registered');
  if (!pkg) return rejected('no_active_package');
  if (pkg.state !== 'Active') return rejected('package_not_active');
  if (!isPinnable(pkg)) return rejected('package_not_pinnable');
  const plan = deliveryPlan(pkg.payload);
  if (!plan) return rejected('package_not_deliverable');
  if (practiceShortfall(plan, input.policy).length) return rejected('insufficient_practice');

  const session = newSession(pkg, registration, input, { kind: 'standard', remediation: null, plan });
  const response = { ...startResponse(session), resumed: false };
  return { outcome: 'ok', session, response, events: [event(session, 1, 'session_started', input, replyFields(input, response))] };
}

// Calling start again returns the learner's existing session. It re-checks
// the pinned package (the caller passes it as `pkg`), so a newer Active
// version never takes over. An assigned remediation starts here; an open
// session records a resume, so every reconnection is countable evidence.
function decideExistingStart(pkg, registration, { session, state }, input) {
  const reason = idleReason(state, input) || blockReason(pkg, session, registration);
  if (reason) return block(session, state, input, reason);
  const replay = replayOf(state, input);
  if (replay) return replay;
  const assigned = state.status === 'assigned';
  const response = { ...startResponse(session), resumed: !assigned };
  const eventType = assigned ? 'session_started' : 'session_resumed';
  return { outcome: 'ok', session, response, events: [event(session, state.lastSeq + 1, eventType, input, replyFields(input, response))] };
}

// A structured remediation request creates a session that delivers only the
// items for the targeted objectives. The request, including the evidence that
// caused it, is stored on the session row, which can never be changed.
function decideRemediation(pkg, registration, { existingRequest = null, openSession = null } = {}, input) {
  if (existingRequest) {
    const assigned = existingRequest.events.find((e) => e.eventType === 'remediation_assigned');
    return existingRequest.session.remediation.requestDigest === input.requestDigest
      ? { outcome: 'replay', events: [], response: assigned.storedResponse }
      : conflict('remediation_request_conflict');
  }
  if (openSession) return conflict('session_in_progress');
  if (!registration || registration.agentLearnerKey !== input.agentLearnerKey) return rejected('not_registered');
  if (!pkg || pkg.state !== 'Active') return rejected('package_not_active');
  if (pkg.id !== input.packageId || pkg.version !== input.packageVersion) return conflict('package_mismatch');
  if (!isPinnable(pkg)) return rejected('package_not_pinnable');
  const plan = deliveryPlan(pkg.payload);
  if (!plan) return rejected('package_not_deliverable');
  const known = new Set((pkg.payload.objectives || []).map((objective) => objective?.id));
  if (input.objectiveIds.some((id) => !known.has(id))) return rejected('unknown_objectives');
  const targeted = targetPlan(plan, input.objectiveIds);
  if (!targeted.length) return rejected('no_targeted_content');
  if (practiceShortfall(targeted, input.policy).length) return rejected('insufficient_practice');

  const remediation = {
    requestId: input.requestId, objectiveIds: [...input.objectiveIds], cause: input.cause,
    requestedBy: input.actor, requestDigest: input.requestDigest, requestedAt: input.now,
  };
  const session = newSession(pkg, registration, input, { kind: 'remediation', remediation, plan: targeted });
  const response = { ...startResponse(session), status: 'assigned', agentLearnerKey: session.agentLearnerKey };
  return { outcome: 'ok', session, response, events: [event(session, 1, 'remediation_assigned', input, {
    objectiveIds: [...input.objectiveIds], idempotencyKey: `remediation:${input.requestId}`,
    requestFingerprint: input.requestDigest, storedResponse: response,
  })] };
}

function newSession(pkg, registration, input, { kind, remediation, plan }) {
  return {
    sessionId: input.sessionId,
    agentLearnerKey: input.agentLearnerKey,
    configurationFingerprint: registration.configurationFingerprint,
    configurationVersion: registration.configurationVersion,
    ...pinGoverningPackage(pkg),
    startedAt: input.now,
    correlationId: input.correlationId,
    kind,
    remediation,
    completionPolicy: input.policy,
    deliveryPlan: planSummary(plan),
  };
}

function decideContinue(pkg, state, input) {
  const { session } = input;
  const guard = guardRequest(pkg, state, input);
  if (guard) return guard;
  if (state.status === 'completed') return ok([], { sessionId: session.sessionId, status: 'completed', item: null });
  // An item already delivered but not completed is re-sent, not delivered twice.
  if (state.pendingItem) return ok([], state.pendingItem.response);

  const item = nextItem(pkg, state, session);
  if (!item) return conflict('nothing_to_deliver');
  const response = { sessionId: session.sessionId, status: 'open', item, bounds: interactionBounds(session) };
  return ok([event(session, state.lastSeq + 1, 'item_delivered', input, {
    ...itemFields(item), ...replyFields(input, response),
  })], response);
}

// What every delivered item tells the Agent Learner about the interaction:
// one accepted answer, a length cap, no grading, and no weight change.
function interactionBounds(session) {
  return {
    maxResponseChars: policyOf(session).maxResponseChars, acceptedResponsesPerItem: 1,
    graded: false, modelWeightsModified: false,
  };
}

function decideSubmit(pkg, state, input) {
  const { session } = input;
  const guard = guardRequest(pkg, state, input);
  if (guard) return guard;
  if (state.status === 'completed') return conflict('session_completed');
  if (!state.pendingItem) return conflict('nothing_delivered');
  // Only the item currently delivered can be completed, so a late retry of an
  // earlier item cannot record a second completion.
  if (input.deliveryItemId !== state.pendingItem.deliveryItemId) return conflict('out_of_sequence');
  if (input.responseLength > policyOf(session).maxResponseChars) return rejected('response_too_long');

  const plan = sessionPlan(pkg.payload, session);
  const completed = [...state.completedItemIds, state.pendingItem.deliveryItemId];
  const status = completionStatus(plan, completed, policyOf(session));
  const response = {
    sessionId: session.sessionId, status: status.complete ? 'completed' : 'open',
    completedItemId: state.pendingItem.deliveryItemId,
    progress: { completedItems: status.completedItems, plannedItems: status.plannedItems,
      practiceCompleted: status.practiceCompleted },
    modelWeightsModified: false,
  };
  const events = [event(session, state.lastSeq + 1, 'item_completed', input, {
    ...itemFields(state.pendingItem), responseDigest: input.responseDigest, ...replyFields(input, response),
  })];
  if (!status.complete) return ok(events, response);
  events.push(event(session, state.lastSeq + 2, 'session_completed', input));
  return { ...ok(events, response), completion: completionEnvelope(session, plan, status, input) };
}

// The one integration event a completed session emits. Its id is derived from
// the session, and the store keeps one row per session, so a retry or a
// second writer can never emit a second completion.
function completionEnvelope(session, plan, status, input) {
  return {
    eventId: `${COMPLETION_EVENT_TYPE}:${session.sessionId}`,
    eventType: COMPLETION_EVENT_TYPE,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    occurredAt: input.now,
    correlationId: input.correlationId,
    agentLearnerKey: session.agentLearnerKey,
    configurationFingerprint: session.configurationFingerprint,
    configurationVersion: session.configurationVersion,
    sessionId: session.sessionId,
    sessionKind: session.kind || 'standard',
    remediationRequestId: session.remediation?.requestId ?? null,
    package: { id: session.packageId, version: session.packageVersion, digest: session.packageDigest },
    completionPolicy: policyOf(session),
    completion: {
      plannedItems: status.plannedItems, completedItems: status.completedItems,
      practiceCompleted: status.practiceCompleted, modules: status.modules.map((m) => m.moduleId),
      objectiveIds: [...new Set(plan.flatMap((item) => item.objectiveIds))],
    },
    evidence: { ...input.evidence },
  };
}

// Shared checks for continue and submit. The package and registration are
// checked before any replay, so a stored response is never re-sent from a
// package that is no longer eligible.
function guardRequest(pkg, state, input) {
  if (state.status === 'not_started' || state.status === 'assigned') return rejected('session_not_started');
  // A completed session keeps its result; a later package change does not block it.
  if (state.status === 'completed') return replayOf(state, input);
  const reason = idleReason(state, input) || blockReason(pkg, input.session, input.registration);
  if (state.status === 'blocked' || reason) return block(input.session, state, input, reason);
  return replayOf(state, input);
}

function replayOf(state, input) {
  const prior = state.replies.get(input.idempotencyKey);
  if (!prior) return null;
  return prior.requestFingerprint === input.requestFingerprint
    ? { outcome: 'replay', events: [], response: prior.response }
    : conflict('idempotency_conflict');
}

function blockReason(pkg, session, registration) {
  if (!pkg) return 'package_missing';
  if (!CONTINUE_STATES.has(pkg.state)) return `package_state:${pkg.state}`;
  const changed = pinMismatch(pkg, session);
  if (changed) return changed;
  if (!registration) return 'registration_missing';
  // A reconfigured Agent Learner is different evidence, so it needs a new session.
  if (registration.configurationFingerprint !== session.configurationFingerprint) return 'configuration_changed';
  return null;
}

// An open session with no event since `idleCutoff` is abandoned. It ends as
// blocked, so it counts as aborted and the next start opens a new session.
// An assigned remediation waits for its learner and never times out.
function idleReason(state, input) {
  if (state.status !== 'open' || !input.idleCutoff || state.lastEventAt == null) return null;
  return new Date(state.lastEventAt).getTime() < new Date(input.idleCutoff).getTime() ? 'session_timed_out' : null;
}

// The expiry sweep's decision for one session: end it if it is idle, else do nothing.
function decideTimeout(state, input) {
  const reason = idleReason(state, input);
  return reason ? block(input.session, state, input, reason) : ok([], null);
}

// A block is recorded once; later requests on a blocked session append nothing.
function block(session, state, input, reason) {
  const finalReason = state.status === 'blocked' ? state.blockReason : reason;
  const response = { sessionId: session.sessionId, status: 'blocked', reason: finalReason };
  const events = state.status === 'blocked'
    ? []
    : [event(session, state.lastSeq + 1, 'session_blocked', input, { blockReason: reason })];
  return { outcome: 'blocked', reason: finalReason, events, response };
}

// Every event carries the package, mode, environment and time, so a single
// row is meaningful evidence without joining other rows.
function event(session, seq, eventType, input, fields = {}) {
  return {
    sessionId: session.sessionId,
    seq,
    eventType,
    packageId: session.packageId,
    packageVersion: session.packageVersion,
    moduleId: null,
    moduleSequence: null,
    objectiveIds: [],
    deliveryItemId: null,
    itemKind: null,
    evidenceMode: input.evidence.mode,
    evidenceEnvironment: input.evidence.environment,
    occurredAt: input.now,
    correlationId: input.correlationId,
    actor: input.actor,
    idempotencyKey: null,
    requestFingerprint: null,
    responseDigest: null,
    storedResponse: null,
    blockReason: null,
    ...fields,
  };
}

const replyFields = (input, response) => ({
  idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, storedResponse: response,
});

function itemFields(item) {
  return {
    moduleId: item.moduleId, moduleSequence: item.moduleSequence, deliveryItemId: item.deliveryItemId,
    itemKind: item.kind ?? item.itemKind ?? 'lesson', objectiveIds: [...item.objectiveIds],
  };
}

function startResponse(session) {
  const policy = policyOf(session);
  return {
    sessionId: session.sessionId,
    status: 'open',
    kind: session.kind || 'standard',
    package: { id: session.packageId, version: session.packageVersion, digest: session.packageDigest },
    plannedItems: session.deliveryPlan?.length ?? null,
    completionPolicy: { version: policy.version, minPracticeItemsPerModule: policy.minPracticeItemsPerModule },
    ...(session.remediation
      ? { remediation: { requestId: session.remediation.requestId, objectiveIds: session.remediation.objectiveIds } }
      : {}),
  };
}

const ok = (events, response) => ({ outcome: 'ok', events, response });
const rejected = (reason) => ({ outcome: 'rejected', reason, events: [] });
const conflict = (reason) => ({ outcome: 'conflict', reason, events: [] });

module.exports = {
  EVENT_TYPES, decideContinue, decideRemediation, decideStart, decideSubmit, decideTimeout, deliveryPlan,
  deriveSessionState, nextItem, pinGoverningPackage, pinMismatch,
};
