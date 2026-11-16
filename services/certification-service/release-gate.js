'use strict';

// Release Gate (target design 7.1): when an agent's prompt, model, tools or
// knowledge pack change, CI re-examines it and asks here whether it may ship.
// The gate compares the new examination with the agent's last credential for
// the same package and blocks on any regression: a failed examination, a
// critical violation, an objective that passed before and fails now, or a
// success lower bound that fell further than measurement noise. It answers
// with the per-objective diff either way.

const { checkBehaviourEvidence } = require('../../packages/agent-sandbox/src/evidence');

const RELEASE_GATE_RESULT = 'release-gate-result/1.0.0';
// How far a 95% success lower bound may fall before it counts as a
// regression: 0.1 is about the bound's change when one of nine episodes turns
// from success to failure (0.70 to 0.57 at n = 9), so a smaller drop is within
// one episode of noise.
const BOUND_DROP_TOLERANCE = 0.1;

const objectiveView = (objective) => objective ? { successLowerBound: objective.successLowerBound,
  violationUpperBound: objective.violationUpperBound, violations: objective.violations, passed: objective.passed } : null;

/**
 * @param {{ credential: object, examinationId: string, issuedAt: string } | null} baseline  the subject's last credential for the package
 * @param {object} attempt  the candidate examination, as the Engine reports it
 * @returns {{ decision: 'pass' | 'block', reasons: string[], objectives: object[] }}
 */
function compareRelease(baseline, attempt) {
  const reasons = [];
  const assessment = attempt?.assessment;
  const passed = attempt?.status === 'complete' && attempt.result?.valid === true && attempt.result?.passed === true && assessment?.passed === true;
  if (!passed) reasons.push('candidate_failed_examination', ...(assessment?.failureReasons || []).map((reason) => `failure:${reason}`));
  const after = assessment?.behaviour ?? null;
  if (after !== null && !checkBehaviourEvidence(after)) reasons.push('candidate_behaviour_evidence_invalid');
  if (after?.allEpisodes?.violations > 0) reasons.push('critical_violation');
  const before = baseline?.credential?.credentialSubject?.competency?.behaviour ?? null;
  const ids = [...new Set([...(before?.objectives || []), ...(after?.objectives || [])].map((objective) => objective.objectiveId))].sort();
  const objectives = ids.map((objectiveId) => {
    const was = before?.objectives.find((objective) => objective.objectiveId === objectiveId);
    const now = after?.objectives.find((objective) => objective.objectiveId === objectiveId);
    if (was?.passed && !now?.passed) reasons.push(`objective_regressed:${objectiveId}`);
    const change = was && now ? Math.round((now.successLowerBound - was.successLowerBound) * 10000) / 10000 : null;
    if (change !== null && -change > BOUND_DROP_TOLERANCE) reasons.push(`bound_dropped:${objectiveId}`);
    return { objectiveId, before: objectiveView(was), after: objectiveView(now), successLowerBoundChange: change };
  });
  return { decision: reasons.length ? 'block' : 'pass', reasons, objectives };
}

/** @returns {object} the gate's answer for one check */
function releaseGateResult({ baseline, attempt, comparison, checkedAt, incident }) {
  return {
    schemaVersion: RELEASE_GATE_RESULT, decision: comparison.decision, reasons: comparison.reasons, objectives: comparison.objectives,
    baseline: baseline ? { credentialId: baseline.credential.credentialId ?? baseline.credentialId, examinationId: baseline.examinationId,
      issuedAt: baseline.issuedAt, configurationFingerprint: baseline.credential?.credentialSubject?.configurationFingerprint ?? null } : null,
    candidate: { examinationId: attempt.attemptId, configurationFingerprint: attempt.configurationFingerprint, package: attempt.package },
    incident, checkedAt,
  };
}

module.exports = { BOUND_DROP_TOLERANCE, RELEASE_GATE_RESULT, compareRelease, releaseGateResult };
