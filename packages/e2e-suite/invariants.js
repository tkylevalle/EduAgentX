'use strict';
const GROUPS = Object.freeze({
  REGISTRATION: ['registration_identity', 'fingerprint', 'registration_replay'],
  CURRICULUM_TRAINING: ['training_complete', 'package_pin', 'weights_unchanged'],
  EXAMINATION: ['exam_manifest', 'terminal_expected', 'deadline_failure', 'answer_final', 'response_replay', 'sequence_rejected'],
  CERTIFICATION: ['certification_expected', 'credential_verified', 'no_credential'],
  MARKETPLACE: ['marketplace_trust', 'match_once', 'lane_unique'],
  REMEDIATION_SKILL_GAP: ['remediation_source', 'original_immutable', 'remediation_assignment_once', 'reexamination_new'],
  CROSS_CUTTING_SAFETY: ['admission_once', 'credential_once', 'safety_rule_detected', 'unsafe_not_passed', 'unsafe_not_certified'],
});
const groupOf = id => Object.keys(GROUPS).find(g => GROUPS[g].includes(id));
function check(id, passed, reason = null) {
  if (!groupOf(id) || ![true, false, null].includes(passed)) throw new TypeError('invalid invariant observation');
  return { id, group: groupOf(id), passed, reason };
}
function summarizeInvariants(scenarios, results) {
  const byId = new Map(results.map(r => [r.scenarioId, r]));
  const groups = Object.fromEntries(Object.keys(GROUPS).map(g => [g, { passed: 0, failed: 0, unmeasured: 0 }]));
  for (const s of scenarios) for (const id of s.expected.invariants) {
    const observations = (byId.get(s.id)?.checks || []).filter(c => c.id === id);
    // Duplicate or conflicting observations are not silently counted as one success.
    const observation = observations.length === 1 ? observations[0].passed : observations.length > 1 ? false : null;
    groups[groupOf(id)][observation === true ? 'passed' : observation === false ? 'failed' : 'unmeasured'] += 1;
  }
  return { groups, held: Object.values(groups).every(g => g.failed === 0),
    complete: Object.values(groups).every(g => g.unmeasured === 0) };
}
function duplicateCount(records, key, value) {
  const seen = new Map();
  for (const record of records) {
    if (!seen.has(record[key])) seen.set(record[key], new Set());
    seen.get(record[key]).add(record[value]);
  }
  return [...seen.values()].reduce((n, ids) => n + Math.max(0, ids.size - 1), 0);
}
function laneDuplicates(appearances) {
  const seen = new Map();
  for (const a of appearances) {
    const key = `${a.resultId}:${a.agentLearnerKey}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.values()].reduce((n, count) => n + Math.max(0, count - 1), 0);
}
function safety(scenario, observed) {
  const rules = scenario.expected.examination.criticalRuleIds;
  if (!rules.length) return { applicable: false, measured: false, falsePass: false };
  const assessed = ['complete', 'agent_failed'].includes(observed.status) && Array.isArray(observed.criticalRuleIds);
  const measured = assessed && typeof observed.safetyDetected === 'boolean' &&
    Number.isInteger(observed.credentialCount) && observed.credentialCount >= 0;
  // An observed violation fails even when another required measurement is absent.
  const falsePass = (assessed && (observed.safetyDetected === false || rules.some(r => !observed.criticalRuleIds.includes(r)))) ||
    observed.status === 'complete' || observed.credentialCount > 0;
  return { applicable: true, measured, falsePass };
}
module.exports = { GROUPS, check, summarizeInvariants, duplicateCount, laneDuplicates, safety };
