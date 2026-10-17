'use strict';

// Pure fold of credential events into one projection record. The projection
// only says which credentials exist and what we last heard; every check still
// asks the owners for status and fingerprint.

const text = (value) => typeof value === 'string' && value.length > 0;

// Allowed status changes. Revoked has no entry: it is final.
const TRANSITIONS = Object.freeze({
  'credential.suspended': { active: 'suspended', suspended: 'suspended' },
  'credential.reinstated': { suspended: 'active', active: 'active' },
  'credential.superseded': { active: 'superseded', suspended: 'superseded' },
  'credential.revoked': { active: 'revoked', suspended: 'revoked', superseded: 'revoked' },
});
const EVENT_TYPES = Object.freeze(['credential.issued', ...Object.keys(TRANSITIONS)]);

const ignored = (current, reason) => ({ applied: false, reason, record: current });

function applyCredentialEvent(current, event) {
  if (!event || !EVENT_TYPES.includes(event.eventType) || !text(event.eventId) || !text(event.credentialId) ||
      !text(event.agentLearnerKey) || !Number.isFinite(Date.parse(event.occurredAt)))
    return ignored(current, 'invalid_event');
  // A credential belongs to one learner; an event naming another is not trusted.
  if (current && (current.credentialId !== event.credentialId || current.agentLearnerKey !== event.agentLearnerKey))
    return ignored(current, 'invalid_event');

  if (event.eventType === 'credential.issued') {
    // Credentials are immutable, so a second issue can never replace the first.
    if (current) return ignored(current, 'already_issued');
    if (!event.credential || typeof event.credential !== 'object' || Array.isArray(event.credential))
      return ignored(current, 'invalid_event');
    return { applied: true, reason: null, record: {
      credentialId: event.credentialId, agentLearnerKey: event.agentLearnerKey, status: 'active',
      candidate: { ...structuredClone(event.credential), credentialId: event.credentialId, agentLearnerKey: event.agentLearnerKey },
      lastEventId: event.eventId, lastOccurredAt: event.occurredAt,
    } };
  }

  // A status event for a credential we never saw issued has nothing to attach to.
  if (!current) return ignored(current, 'unknown_credential');
  if (Date.parse(event.occurredAt) < Date.parse(current.lastOccurredAt)) return ignored(current, 'out_of_order');
  if (current.status === 'revoked') return ignored(current, 'revoked_is_final');
  const status = TRANSITIONS[event.eventType][current.status];
  if (!status) return ignored(current, 'invalid_transition');
  return { applied: true, reason: null, record: {
    ...structuredClone(current), status, lastEventId: event.eventId, lastOccurredAt: event.occurredAt } };
}

module.exports = { EVENT_TYPES, applyCredentialEvent };
