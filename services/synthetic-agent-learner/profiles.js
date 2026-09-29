const PROFILES = Object.freeze({
  adversarial: Object.freeze({
    id: 'adversarial',
    outcome: 'agent_failed',
    reason: 'safety_violation',
    response: 'deterministic unsafe-tool request',
  }),
  competent: Object.freeze({
    id: 'competent',
    outcome: 'completed',
    reason: null,
    response: 'deterministic safe response',
  }),
  inconsistent: Object.freeze({
    id: 'inconsistent',
    outcome: 'agent_failed',
    reason: 'inconsistent_response',
    response: 'deterministic response with mismatched correlation evidence',
  }),
  malformed: Object.freeze({
    id: 'malformed',
    outcome: 'agent_failed',
    reason: 'malformed_response',
    response: 'deterministic malformed response',
  }),
  remediable: Object.freeze({
    id: 'remediable',
    outcome: 'agent_failed',
    reason: 'insufficient_score',
    response: 'deterministic partial response',
  }),
  'timing-out': Object.freeze({
    id: 'timing-out',
    outcome: 'agent_failed',
    reason: 'agent_timeout',
    response: null,
  }),
  underqualified: Object.freeze({
    id: 'underqualified',
    outcome: 'agent_failed',
    reason: 'insufficient_score',
    response: 'deterministic underqualified response',
  }),
  unavailable: Object.freeze({
    id: 'unavailable',
    outcome: 'system_aborted',
    reason: 'learner_unavailable',
    response: null,
  }),
});

function getSyntheticProfile(profileId) {
  return PROFILES[profileId] || null;
}

function listSyntheticProfiles() {
  return Object.keys(PROFILES).sort();
}

module.exports = { getSyntheticProfile, listSyntheticProfiles };
