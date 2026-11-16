'use strict';

// Release Gate (target design 7.1): when an agent's prompt, model, tools or
// knowledge pack change, CI re-examines it and asks here whether it may ship.
// The gate compares the new examination with the agent's last credential for
// the same package and blocks on any regression: a failed examination, a
// critical violation, an objective that passed before and fails now, or a
// success lower bound that fell further than measurement noise. It answers
// with the per-objective diff either way.

const { checkBehaviourEvidence } = require('../../packages/agent-sandbox/src/evidence');

const telemetry = require('../../packages/telemetry');
const { clipSummary } = require('../../packages/incident-log');

const RELEASE_GATE_RESULT = 'release-gate-result/1.0.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// An agent learner key is at most 256 characters everywhere it is registered.
const MAX_SUBJECT_CHARS = 256;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
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
 * @param {{ configurationFingerprint?: string }} [shipping]  the configuration CI is about to ship, when it names one
 * @returns {{ decision: 'pass' | 'block', reasons: string[], objectives: object[] }}
 */
function compareRelease(baseline, attempt, { configurationFingerprint } = {}) {
  const reasons = [];
  // The candidate must be a new examination of the configuration being shipped, not the baseline's own or an older one.
  if (baseline && (attempt?.attemptId === baseline.examinationId || !(Date.parse(attempt?.completedAt) > Date.parse(baseline.issuedAt))))
    reasons.push('candidate_not_newer_than_baseline');
  if (configurationFingerprint && attempt?.configurationFingerprint !== configurationFingerprint) reasons.push('candidate_fingerprint_mismatch');
  const assessment = attempt?.assessment;
  const passed = attempt?.status === 'complete' && attempt.result?.valid === true && attempt.result?.passed === true && assessment?.passed === true;
  if (!passed) reasons.push('candidate_failed_examination', ...(assessment?.failureReasons || []).map((reason) => `failure:${reason}`));
  const reported = assessment?.behaviour ?? null;
  const evidenceValid = reported === null || checkBehaviourEvidence(reported);
  if (!evidenceValid) reasons.push('candidate_behaviour_evidence_invalid');
  // Invalid evidence already blocks; leaving it out of the diff keeps a malformed value from failing the whole check.
  const after = evidenceValid ? reported : null;
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
    baseline: baseline ? { credentialId: baseline.credentialId, examinationId: baseline.examinationId,
      issuedAt: baseline.issuedAt, configurationFingerprint: baseline.credential?.credentialSubject?.configurationFingerprint ?? null } : null,
    candidate: { examinationId: attempt.attemptId, configurationFingerprint: attempt.configurationFingerprint, package: attempt.package },
    incident, checkedAt,
  };
}

/**
 * POST /internal/release-gate/checks for the Gateway: { subjectId, examinationId, configurationFingerprint? }.
 * CI runs the examination through the public API first; the gate judges it.
 */
function registerReleaseGateRoute(app, { store, examinationEvidence, incidentReporter, internalKey, matchesSecret, clock }) {
  app.post('/internal/release-gate/checks', async (req, res) => {
    if (!matchesSecret(req.header('x-internal-service-key'), internalKey) || req.header('x-actor-role') !== 'gateway' || !req.header('x-actor-subject'))
      return res.status(403).json({ error: 'forbidden' });
    const { subjectId, examinationId, configurationFingerprint } = req.body || {};
    if (!req.body || Object.keys(req.body).some((key) => !['subjectId', 'examinationId', 'configurationFingerprint'].includes(key)) ||
      typeof subjectId !== 'string' || !subjectId || subjectId.length > MAX_SUBJECT_CHARS || typeof examinationId !== 'string' || !UUID.test(examinationId) ||
      (configurationFingerprint !== undefined && !FINGERPRINT.test(String(configurationFingerprint))))
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', correlationId: req.correlationId });
    try {
      const attempt = await examinationEvidence(examinationId, req.correlationId);
      if (attempt?.agentLearnerKey !== subjectId) return res.status(409).json({ apiVersion: 'v1', error: 'examination_is_not_this_subjects', correlationId: req.correlationId });
      const baseline = await store.latestCredentialFor(subjectId, attempt.package?.id);
      const comparison = compareRelease(baseline, attempt, { configurationFingerprint });
      const incident = comparison.decision === 'block' ? await reportBlock(incidentReporter, { subjectId, examinationId, comparison, baseline, clock }) : null;
      res.json({ apiVersion: 'v1', result: releaseGateResult({ baseline, attempt, comparison, checkedAt: clock(), incident }), correlationId: req.correlationId });
    } catch (error) {
      if ([404, 409].includes(error.status)) return res.status(error.status).json({ apiVersion: 'v1', error: error.code, correlationId: req.correlationId });
      telemetry.log('certification-service', 'release_gate_failed', { correlationId: req.correlationId, outcome: String(error.code || error.name) });
      res.status(503).json({ apiVersion: 'v1', error: 'release_gate_unavailable', correlationId: req.correlationId });
    }
  });
}

// A blocked release goes to the Assurance Incident log; a failure to record it
// is logged and returned as a code, not hidden. The raw error stays out of the
// answer: it can carry internal addresses.
async function reportBlock(incidentReporter, { subjectId, examinationId, comparison, baseline, clock }) {
  if (!incidentReporter?.enabled) return { notRecorded: 'incident_log_not_configured' };
  try {
    const reported = await incidentReporter.report({ sourceId: `release-gate:${examinationId}`, severity: 'high', kind: 'release_blocked',
      summary: clipSummary(`Release blocked for ${subjectId}: ${comparison.reasons.slice(0, 4).join(', ')}`), subject: { agentId: subjectId, attemptId: examinationId },
      safeState: 'release blocked', requiredAction: 'Fix the regression and re-examine before shipping.',
      detail: { reasons: comparison.reasons, baselineCredentialId: baseline?.credentialId ?? null }, occurredAt: clock() });
    return { incidentId: reported.incidentId };
  } catch (error) {
    telemetry.log('certification-service', 'release_block_not_recorded', { outcome: String(error.code || error.name) });
    return { notRecorded: 'incident_log_failed' };
  }
}

module.exports = { BOUND_DROP_TOLERANCE, RELEASE_GATE_RESULT, UUID, compareRelease, registerReleaseGateRoute, releaseGateResult };
