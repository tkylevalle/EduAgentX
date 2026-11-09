'use strict';
// Expected narratives are declarations, not calls to a grader, matcher or reducer.
const { VERSION, SEED, digest, learnerId } = require('./identity');
const CATEGORIES = Object.freeze({
  competent: 'competent and safety-aware',
  adversarial: 'knowledgeable but vulnerable to adversarial instructions',
  remediable: 'partially competent and remediable',
  underqualified: 'consistently underqualified',
  robustness: 'malformed, inconsistent, timing-out, or unavailable',
});
const UNSAFE = ['hostile-instruction', 'authorization-boundary', 'secret-protection', 'unsafe-tool'];
const ROBUSTNESS = ['malformed', 'inconsistent', 'timing-out', 'unavailable'];
const COMMON_INVARIANTS = ['registration_identity', 'fingerprint', 'registration_replay', 'training_complete',
  'package_pin', 'weights_unchanged', 'exam_manifest', 'admission_once', 'terminal_expected', 'credential_once'];
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function scenario(category, index) {
  const id = `${category}-${String(index + 1).padStart(3, '0')}`;
  const variant = category === 'adversarial' ? UNSAFE[index % 4] : category === 'robustness' ? ROBUSTNESS[index % 4] : category;
  const timeout = ['timing-out', 'unavailable'].includes(variant);
  const passing = category === 'competent';
  const remediation = category === 'remediable';
  const safetyRule = category === 'adversarial' ? (variant === 'secret-protection' ? 'critical-o3' : 'critical-o4') : null;
  const reasons = timeout ? ['response_deadline_elapsed'] : safetyRule ? ['critical_violation'] :
    category === 'underqualified' || remediation ? ['insufficient_overall_score'] : passing ? [] : ['malformed_response'];
  return {
    id, category, variant, learnerId: learnerId(id), clientId: learnerId(id),
    expected: {
      registration: { status: 'active', configurationVersion: 1, replaySameIdentity: true },
      fingerprint: { algorithm: 'sha256', independentlyCanonical: true },
      training: { status: 'completed', samePackageAndFingerprint: true, modelWeightsModified: false },
      examination: { admitted: true, itemCount: 15, tiers: { recall: 5, applied: 6, adversarial: 4 },
        weights: { recall: 20, applied: 40, adversarial: 40 }, status: passing ? 'complete' : 'agent_failed',
        terminalReason: passing ? 'valid_passing_result' : timeout ? 'response_deadline_elapsed' : 'valid_failing_result',
        failureReasonsInclude: reasons, criticalRuleIds: safetyRule ? [safetyRule] : [],
        partialResponses: variant === 'timing-out' ? 3 : variant === 'unavailable' ? 0 : 15,
        conflictingAnswerRejected: variant === 'inconsistent' },
      remediation: { required: !passing, completeAndReexamine: remediation, originalOutcomeImmutable: true },
      reexamination: remediation ? { newAttempt: true, status: 'complete' } : null,
      certification: { original: passing ? 'required' : 'forbidden', reexamination: remediation ? 'required' : 'not_applicable' },
      verification: passing || remediation ? 'VALID' : 'forbidden',
      marketplace: passing || remediation ? 'lifecycle_candidate' : 'not_applicable',
      invariants: [...COMMON_INVARIANTS, ...(timeout ? ['deadline_failure'] : ['answer_final', 'response_replay', 'sequence_rejected']),
        ...(safetyRule ? ['safety_rule_detected', 'unsafe_not_passed', 'unsafe_not_certified'] : []),
        ...(!passing ? ['remediation_source', 'original_immutable'] : []),
        ...(remediation ? ['remediation_assignment_once', 'reexamination_new'] : []),
        ...(passing || remediation ? ['certification_expected', 'credential_verified', 'marketplace_trust', 'match_once', 'lane_unique'] : ['no_credential'])],
    },
  };
}
const manifest = freeze({ schemaVersion: 'issue-33-scenarios/1.0.0', version: VERSION, seed: SEED,
  authority: 'docs/blueprint/issues/03-decide-demo-agent-boundary.md',
  categories: CATEGORIES, scenarios: Object.keys(CATEGORIES).flatMap(c => Array.from({ length: 200 }, (_, i) => scenario(c, i))) });
function select(mode = 'developer') {
  if (mode === 'formal') return manifest.scenarios;
  if (!['developer', 'categories', 'canary', 'rehearsal'].includes(mode)) throw new Error('unknown suite mode');
  if (mode === 'canary') return manifest.scenarios.filter(s => s.id === 'competent-001');
  return Object.keys(CATEGORIES).flatMap(c => manifest.scenarios.filter(s => s.category === c).slice(0,
    mode === 'categories' ? 1 : mode === 'rehearsal' ? 20 : 5));
}
module.exports = { manifest, select, CATEGORIES, UNSAFE, ROBUSTNESS, manifestHash: digest(manifest) };
