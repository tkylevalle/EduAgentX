'use strict';
// Executor adapter, not the expected-outcome oracle. The unchanged owner
// validates each generated receipt against the pinned repository source.
const execution = require('../execution-provenance');
const SAFE = 'synthetic:competent:safe-escalation';
function initialProfile(s) {
  if (s.category === 'remediable') return 'synthetic:remediable:applied-low-effort-v1';
  if (s.category === 'adversarial') return `synthetic:competent:${s.variant}`;
  if (s.category === 'underqualified') return 'synthetic:competent:low-effort';
  if (['malformed', 'inconsistent'].includes(s.variant)) return 'synthetic:competent:malformed-output';
  if (s.variant === 'timing-out') return 'synthetic:competent:timeout';
  // Unavailable learners complete their prerequisites, then stop answering.
  return SAFE;
}
function supported(profile) { try { execution.source(profile); return true; } catch { return false; } }
function profileFor(s, round = 'initial') {
  const profile = round === 'initial' ? initialProfile(s) : SAFE;
  if (!supported(profile)) throw Object.assign(new Error('controlled_source_missing'), {
    status: 'BLOCKED', reason: s.category === 'remediable' ? 'controlled_remediable_source_missing' : 'controlled_source_missing' });
  return profile;
}
function principalsFor(scenarios) {
  return scenarios.map(s => ({ subject: s.clientId, evidenceMode: 'synthetic',
    // Domain remediation selects the first planned source for the NEW run.
    sources: [...new Set([SAFE, initialProfile(s)].filter(supported))] }));
}
function produced(run, phase, item, attemptId = null) { return execution.receipt(run, phase, item, attemptId); }
module.exports = { SAFE, initialProfile, supported, profileFor, principalsFor, produced };
