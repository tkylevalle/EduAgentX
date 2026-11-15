'use strict';

// Standard grading (Issue #18 integration). A complete standard attempt is
// sent to the grader once; the reply is checked against the pinned rubric and
// aggregated with the pinned template into an assessment, which is recorded
// with the result through the Issue #17 finalize command. Every outcome uses a
// fixed per-attempt identity, so a retry or a second writer replays it.
//
// Fail-closed rules:
//   - a changed governing package or fingerprint aborts (governance_changed);
//   - a malformed or refused grader reply aborts (grading_unavailable);
//   - an unreachable grader leaves the attempt in progress for the retry
//     window, then aborts (grading_unavailable), which permits a fallback.

const { randomUUID } = require('node:crypto');
const telemetry = require('../../packages/telemetry');
const { DependencyError } = require('./sources');
const { createGovernance } = require('./governance');
const { fail } = require('./lifecycle');
const { assess, isMalformedResponse, validateGraderReply } = require('./assessment');
const { SANDBOX_GRADER, behaviourGrade } = require('./behaviour');
const { buildBehaviourEvidence } = require('./behaviour-evidence');

const SERVICE_NAME = 'examination-engine';
const DEFAULT_RETRY_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_BATCH = 50;
const RESULT_SCHEMA = 'examination-result/1.0.0';

function gradingRequest(attempt, pkg) {
  const statements = new Map(pkg.objectives.map((objective) => [objective.id, objective.statement]));
  const responses = new Map(attempt.responses.map((row) => [row.itemId, row.response]));
  return {
    rubric: { id: attempt.form.rubric.id, version: attempt.form.rubric.version,
      criticalViolationRuleIds: [...pkg.rubric.criticalViolationRuleIds] },
    // Behaviour items are graded by the Engine's sandbox, not the text grader.
    items: attempt.form.items.filter((item) => item.kind !== 'behaviour').map((item) => ({ itemId: item.id, tier: item.tier,
      reference: item.objectiveIds.map((id) => statements.get(id)).join(' '), response: responses.get(item.id) })),
  };
}

// One grader identity for an assessment that used both graders.
const combinedGrader = (text, behaviourUsed) => (behaviourUsed
  ? { id: `${text.id}+${SANDBOX_GRADER.id}`, version: `${text.version}+${SANDBOX_GRADER.version}` } : text);

// The assessment for one text-grader reply, with behaviour items graded by
// replaying their episodes, or null when the reply is not exactly one valid
// result per text item. Exported with gradingRequest so a validity
// measurement can use the Engine's own request and pass rule.
function assessGraderReply({ attempt, pkg, request, replyBody, episodeSeedKey }) {
  const checked = validateGraderReply(replyBody, request.items.map((item) => item.itemId),
    request.rubric.criticalViolationRuleIds);
  if (!checked) return null;
  const responses = new Map(attempt.responses.map((row) => [row.itemId, row.response]));
  const graded = attempt.form.items.filter((item) => item.kind === 'behaviour')
    .map((item) => behaviourGrade(attempt.attemptId, item, responses.get(item.id), episodeSeedKey));
  const byId = new Map([...checked.results, ...graded.map((grade) => grade.result)].map((result) => [result.itemId, result]));
  return assess({ form: attempt.form, objectives: pkg.objectives, policy: pkg.examTemplate,
    grader: combinedGrader(checked.grader, graded.length > 0), results: attempt.form.items.map((item) => byId.get(item.id)),
    malformedItemIds: request.items.filter((item) => isMalformedResponse(item.response)).map((item) => item.itemId),
    behaviour: buildBehaviourEvidence(attempt.form, graded) });
}

function withinRetryWindow(attempt, now, windowMs) {
  const lastAccepted = Math.max(...attempt.responses.map((row) => Date.parse(row.acceptedAt)));
  return Date.parse(now) < lastAccepted + windowMs;
}

function createGradingRunner({ store, sources, gradeItems, clock = () => new Date().toISOString(),
  retryWindowMs = DEFAULT_RETRY_WINDOW_MS, episodeSeedKey }) {
  const governance = createGovernance(sources);

  // Records one terminal command. A concurrent writer may already have
  // recorded the single outcome; that outcome is then returned.
  async function record(attempt, command, correlationId, options = {}) {
    const id = attempt.attemptId;
    try {
      const result = await store.command(id, { idempotencyKey: `grade:${id}`, expectedSequence: attempt.sequence,
        now: clock(), correlationId, ...command }, { clock, ...options });
      return { outcome: result.replay ? 'replay' : 'accepted', attempt: result.attempt };
    } catch (error) {
      const current = error.status === 409 && await store.get(id);
      if (current && current.status !== 'in_progress') return { outcome: 'replay', attempt: current };
      throw error;
    }
  }
  const abort = (attempt, reason, correlationId) =>
    record(attempt, { type: 'abort', eventId: `grade-abort:${attempt.attemptId}`, reason }, correlationId);

  async function requestGrades(attempt, request, correlationId) {
    try { return { reply: await gradeItems({ ...request, correlationId }) }; }
    catch (error) {
      if (!(error instanceof DependencyError) || withinRetryWindow(attempt, clock(), retryWindowMs)) throw error;
      return { unavailable: true };
    }
  }

  async function grade(attemptId, correlationId = randomUUID()) {
    const attempt = await store.get(attemptId, { clock, correlationId });
    if (!attempt) throw fail('attempt_not_found', 404);
    if (attempt.mode !== 'standard') throw fail('standard_attempt_required');
    if (attempt.status !== 'in_progress') return { outcome: 'replay', attempt };
    if (!attempt.responseCollectionComplete) throw fail('responses_incomplete');
    let pkg;
    try { pkg = await governance.verify(attempt, correlationId); }
    catch (error) {
      if (error.status !== 409) throw error;
      return abort(attempt, 'governance_changed', correlationId);
    }
    const request = gradingRequest(attempt, pkg);
    const { reply, unavailable } = await requestGrades(attempt, request, correlationId);
    const assessment = reply?.ok ? assessGraderReply({ attempt, pkg, request, replyBody: reply.body, episodeSeedKey }) : null;
    if (unavailable || !assessment) return abort(attempt, 'grading_unavailable', correlationId);
    return record(attempt, { type: 'finalize', eventId: `grade:${attempt.attemptId}`, formDigest: attempt.formDigest,
      rubricDigest: attempt.form.rubric.digest, responseSetDigest: attempt.responseSetDigest,
      result: { schemaVersion: RESULT_SCHEMA, valid: true, passed: assessment.passed }, assessment },
    correlationId, { guard: (current) => governance.verify(current, correlationId) });
  }

  // Grades each complete, ungraded standard attempt; returns the ids it ended.
  async function sweep() {
    const ended = [];
    for (const attemptId of await store.listAwaitingGrading(SWEEP_BATCH)) {
      const correlationId = randomUUID();
      try {
        const { attempt } = await grade(attemptId, correlationId);
        if (attempt.status !== 'in_progress') ended.push(attemptId);
      } catch (error) {
        telemetry.log(SERVICE_NAME, 'grading_failed', { correlationId, operation: 'grade_attempt',
          dependency: error instanceof DependencyError ? error.source : undefined, outcome: error.code || 'error' });
      }
    }
    return ended;
  }

  return { grade, sweep };
}

module.exports = { DEFAULT_RETRY_WINDOW_MS, assessGraderReply, createGradingRunner, gradingRequest };
