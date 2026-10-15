'use strict';

// Issue #21: the structured remediation event of a valid Agent-Failed
// standard attempt. Pure. The event names the exact weak objectives and the
// critical rules the attempt broke; its id is derived from the attempt, so it
// is created once with the terminal event and every retry sees the same one.
//
// A gap is known for a graded failure (from the assessment) and for a learner
// timeout (the objectives of the unanswered items). A fallback attempt keeps
// no per-item outcome, and an externally finalized failure has no assessment,
// so neither produces an event.

const { sha256 } = require('../curriculum-engine/model');

const REMEDIATION_EVENT_TYPE = 'examination.remediation.required';
const SCHEMA_VERSION = '1.0.0';
const MAX_SUMMARY_CHARS = 500;

const unique = (values) => [...new Set(values)];

function gapOf(attempt) {
  if (attempt.terminalReason === 'valid_failing_result') {
    const assessment = attempt.assessment;
    if (!assessment) return null;
    return { failureReasons: [...assessment.failureReasons], objectiveIds: [...assessment.failedObjectiveIds],
      criticalViolationRuleIds: [...assessment.criticalViolationRuleIds], evidence: { assessment } };
  }
  if (attempt.terminalReason === 'response_deadline_elapsed') {
    const answered = new Set(attempt.responses.map((row) => row.itemId));
    const unanswered = attempt.form.items.filter((item) => !answered.has(item.id));
    return { failureReasons: ['response_deadline_elapsed'], objectiveIds: unique(unanswered.flatMap((item) => item.objectiveIds)),
      criticalViolationRuleIds: [], evidence: { unansweredItemIds: unanswered.map((item) => item.id) } };
  }
  return null;
}

// Returns the event for a terminal attempt, or null when no remediation applies.
function remediationEventFor(attempt, { now, correlationId, terminalEventId }) {
  const evidence = attempt.form?.training?.evidence;
  if (attempt.mode !== 'standard' || attempt.status !== 'agent_failed' || !evidence?.mode || !evidence?.environment) return null;
  const gap = gapOf(attempt);
  if (!gap || !gap.objectiveIds.length) return null;
  return {
    eventId: `${REMEDIATION_EVENT_TYPE}:${attempt.attemptId}`,
    eventType: REMEDIATION_EVENT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    occurredAt: now,
    correlationId,
    attemptId: attempt.attemptId,
    agentLearnerKey: attempt.agentLearnerKey,
    configurationFingerprint: attempt.configurationFingerprint,
    package: { id: attempt.package.id, version: attempt.package.version, digest: attempt.package.digest },
    failure: { terminalReason: attempt.terminalReason, terminalEventId, failureReasons: gap.failureReasons,
      evidenceDigest: `sha256:${sha256({ attemptId: attempt.attemptId, terminalReason: attempt.terminalReason, ...gap.evidence })}` },
    gap: { objectiveIds: gap.objectiveIds, criticalViolationRuleIds: gap.criticalViolationRuleIds },
    evidence: { mode: evidence.mode, environment: evidence.environment },
  };
}

// The Training remediation request (training-service remediation-request.js).
// The event id is the request id, so a redelivery replays the same session.
function trainingRequestFor(event) {
  const rules = event.gap.criticalViolationRuleIds.length ? event.gap.criticalViolationRuleIds.join(', ') : 'none';
  const summary = `Agent-Failed examination ${event.attemptId} (${event.failure.failureReasons.join(', ')}); critical rules: ${rules}.`;
  return {
    requestId: event.eventId,
    agentLearnerKey: event.agentLearnerKey,
    packageId: event.package.id,
    packageVersion: event.package.version,
    objectiveIds: [...event.gap.objectiveIds],
    cause: { type: 'examination_failure', reference: event.attemptId, evidenceDigest: event.failure.evidenceDigest,
      observedAt: event.occurredAt, summary: summary.slice(0, MAX_SUMMARY_CHARS) },
    evidence: { ...event.evidence },
  };
}

module.exports = { REMEDIATION_EVENT_TYPE, remediationEventFor, trainingRequestFor };
