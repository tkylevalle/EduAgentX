'use strict';

// Training Session decisions as pure functions: no HTTP, no database, no clock.
// The caller loads the package and registration through PackageSource and
// RegistrySource, passes `now`, and appends the returned events in one
// transaction. Session state is never stored; it is derived from the events.
// Training delivers curriculum only. It never grades or changes model weights.

const { createHash } = require('node:crypto');

const EVENT_TYPES = Object.freeze([
  'session_started', 'item_delivered', 'item_completed', 'session_completed', 'session_blocked',
]);
// A new session needs the current Active package. A running session may finish
// on its pinned version after a newer one supersedes it; any other state
// (Candidate, Quarantined, or anything unknown) stops delivery.
const CONTINUE_STATES = new Set(['Active', 'Superseded']);

// Same canonical JSON as curriculum-engine/model.js, so equal content always
// gives an equal digest regardless of key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Training computes the digest itself instead of trusting the source's copy.
function packageDigest(payload) {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

// Flattens the package into its delivery order: modules by ascending
// `sequence`, then each module's deliveryItems in array order. Returns null
// when the package cannot be delivered in a well-defined order.
function deliveryPlan(payload) {
  const modules = payload?.modules;
  if (!Array.isArray(modules) || !modules.length) return null;
  const sequences = new Set();
  for (const module of modules) {
    if (typeof module?.id !== 'string' || !Number.isInteger(module.sequence) || sequences.has(module.sequence) ||
      !Array.isArray(module.deliveryItems) || !module.deliveryItems.length ||
      module.deliveryItems.some((item) => typeof item?.id !== 'string' || typeof item?.text !== 'string')) return null;
    sequences.add(module.sequence);
  }
  const objectives = Array.isArray(payload.objectives) ? payload.objectives : [];
  const seen = new Set();
  const items = [];
  for (const module of [...modules].sort((a, b) => a.sequence - b.sequence)) {
    for (const item of module.deliveryItems) {
      // Progress is keyed by item id, so a repeated id would make resume ambiguous.
      if (seen.has(item.id)) return null;
      seen.add(item.id);
      const linked = objectives.filter((o) => Array.isArray(o?.deliveryItemIds) && o.deliveryItemIds.includes(item.id))
        .map((o) => o.id);
      items.push({
        moduleId: module.id, moduleSequence: module.sequence, deliveryItemId: item.id, text: item.text,
        objectiveIds: linked.length ? linked : [...(module.objectiveIds || [])],
      });
    }
  }
  return items.map((item, index) => ({ ...item, position: index + 1, total: items.length }));
}

function deriveSessionState(events) {
  const state = {
    status: 'not_started', lastSeq: 0, completedItemIds: [], pendingItem: null, blockReason: null,
    replies: new Map(),
  };
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    state.lastSeq = event.seq;
    if (event.idempotencyKey) {
      state.replies.set(event.idempotencyKey, { requestFingerprint: event.requestFingerprint, response: event.storedResponse });
    }
    if (event.eventType === 'session_started') state.status = 'open';
    if (event.eventType === 'item_delivered') {
      state.pendingItem = {
        moduleId: event.moduleId, moduleSequence: event.moduleSequence, deliveryItemId: event.deliveryItemId,
        objectiveIds: event.objectiveIds, response: event.storedResponse,
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

// The first item in delivery order that is not yet completed, or null when done.
function nextItem(pkg, state) {
  const plan = deliveryPlan(pkg.payload);
  if (!plan) throw new Error('package_not_deliverable');
  return plan.find((item) => !state.completedItemIds.includes(item.deliveryItemId)) || null;
}

function decideStart(pkg, registration, existingOpenSession, input) {
  // Resuming re-checks the pinned package (the caller passes it as `pkg`) and
  // returns the same session, so a newer Active version never takes over.
  if (existingOpenSession) {
    const { session, state } = existingOpenSession;
    const reason = blockReason(pkg, session, registration);
    if (reason) return block(session, state, input, reason);
    return { outcome: 'ok', session, events: [], response: { ...startResponse(session), resumed: true } };
  }
  if (!registration || registration.agentLearnerKey !== input.agentLearnerKey) return rejected('not_registered');
  if (!pkg) return rejected('no_active_package');
  if (pkg.state !== 'Active') return rejected('package_not_active');
  if (!deliveryPlan(pkg.payload)) return rejected('package_not_deliverable');

  const session = {
    sessionId: input.sessionId,
    agentLearnerKey: input.agentLearnerKey,
    configurationFingerprint: registration.configurationFingerprint,
    configurationVersion: registration.configurationVersion,
    packageId: pkg.id,
    packageVersion: pkg.version,
    packageDigest: packageDigest(pkg.payload),
    startedAt: input.now,
    correlationId: input.correlationId,
  };
  const response = { ...startResponse(session), resumed: false };
  return { outcome: 'ok', session, response, events: [event(session, 1, 'session_started', input, {
    idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, storedResponse: response,
  })] };
}

function decideContinue(pkg, state, input) {
  const { session } = input;
  const guard = guardRequest(pkg, state, input);
  if (guard) return guard;
  if (state.status === 'completed') return ok([], { sessionId: session.sessionId, status: 'completed', item: null });
  // An item already delivered but not completed is re-sent, not delivered twice.
  if (state.pendingItem) return ok([], state.pendingItem.response);

  const item = nextItem(pkg, state);
  if (!item) return conflict('nothing_to_deliver');
  const response = { sessionId: session.sessionId, status: 'open', item };
  return ok([event(session, state.lastSeq + 1, 'item_delivered', input, {
    ...itemFields(item),
    idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, storedResponse: response,
  })], response);
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

  const completed = [...state.completedItemIds, state.pendingItem.deliveryItemId];
  const finished = deliveryPlan(pkg.payload).every((item) => completed.includes(item.deliveryItemId));
  const response = {
    sessionId: session.sessionId, status: finished ? 'completed' : 'open',
    completedItemId: state.pendingItem.deliveryItemId,
  };
  const events = [event(session, state.lastSeq + 1, 'item_completed', input, {
    ...itemFields(state.pendingItem), responseDigest: input.responseDigest,
    idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, storedResponse: response,
  })];
  if (finished) events.push(event(session, state.lastSeq + 2, 'session_completed', input));
  return ok(events, response);
}

// Shared checks for continue and submit. The package and registration are
// checked before any replay, so a stored response is never re-sent from a
// package that is no longer eligible.
function guardRequest(pkg, state, input) {
  if (state.status === 'not_started') return rejected('session_not_started');
  const reason = blockReason(pkg, input.session, input.registration);
  if (state.status === 'blocked' || reason) return block(input.session, state, input, reason);
  const prior = state.replies.get(input.idempotencyKey);
  if (!prior) return null;
  return prior.requestFingerprint === input.requestFingerprint
    ? { outcome: 'replay', events: [], response: prior.response }
    : conflict('idempotency_conflict');
}

function blockReason(pkg, session, registration) {
  if (!pkg) return 'package_missing';
  if (!CONTINUE_STATES.has(pkg.state)) return `package_state:${pkg.state}`;
  if (pkg.id !== session.packageId || pkg.version !== session.packageVersion) return 'package_identity_changed';
  if (packageDigest(pkg.payload) !== session.packageDigest) return 'package_digest_changed';
  if (!registration) return 'registration_missing';
  // A reconfigured Agent Learner is different evidence, so it needs a new session.
  if (registration.configurationFingerprint !== session.configurationFingerprint) return 'configuration_changed';
  return null;
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

function itemFields(item) {
  return {
    moduleId: item.moduleId, moduleSequence: item.moduleSequence,
    deliveryItemId: item.deliveryItemId, objectiveIds: [...item.objectiveIds],
  };
}

function startResponse(session) {
  return {
    sessionId: session.sessionId,
    status: 'open',
    package: { id: session.packageId, version: session.packageVersion, digest: session.packageDigest },
  };
}

const ok = (events, response) => ({ outcome: 'ok', events, response });
const rejected = (reason) => ({ outcome: 'rejected', reason, events: [] });
const conflict = (reason) => ({ outcome: 'conflict', reason, events: [] });

module.exports = {
  EVENT_TYPES, decideContinue, decideStart, decideSubmit, deliveryPlan, deriveSessionState, nextItem, packageDigest,
};
