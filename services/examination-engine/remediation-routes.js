'use strict';

// Issue #21: the re-examination gate and the admin remediation trace.

const { fail } = require('./lifecycle');

// After a remediable failure on this package version, a new standard attempt
// needs the Training completion of the remediation session for exactly the
// latest event. A replayed admission never reaches this check.
// An earlier attempt that is fully answered or past its deadline may still
// become a failure, so a new attempt waits for its outcome. It is read before
// the events: its outcome and its remediation event commit together, so one of
// the two reads always sees it.
async function requireRemediation(store, { actor, pkg, completion, now }) {
  const scope = { agentLearnerKey: actor, packageId: pkg.packageId || pkg.id, packageVersion: pkg.version };
  if (await store.hasAttemptAwaitingOutcome({ ...scope, now })) throw fail('previous_attempt_awaiting_outcome');
  const event = await store.latestRemediationEvent(scope);
  if (!event) return;
  if (completion?.sessionKind === 'remediation' && completion.remediationRequestId === event.eventId) return;
  // A remediation closed by a passing re-examination no longer gates new attempts.
  for (const attemptId of await store.findReexaminations(event.eventId)) {
    const attempt = await store.get(attemptId);
    if (attempt?.status === 'complete') return;
  }
  throw fail('remediation_required');
}

// Identifiers and outcomes only: no response, prompt or rationale crosses here.
function reexaminationView(attempt) {
  return { attemptId: attempt.attemptId, status: attempt.status, terminalReason: attempt.terminalReason,
    startedAt: attempt.startedAt, correlationId: attempt.correlationId,
    trainingSessionId: attempt.form.training?.sessionId ?? null, passed: attempt.assessment?.passed ?? null };
}

async function remediationTrace(store, attempt, lifecycleView) {
  const { event, delivery } = await store.findRemediation(attempt.attemptId);
  const ids = event ? await store.findReexaminations(event.eventId) : [];
  const reexaminations = [];
  for (const id of ids) reexaminations.push(reexaminationView(await store.get(id)));
  return {
    correlationId: event?.correlationId ?? attempt.correlationId,
    failure: { ...lifecycleView(attempt), agentLearnerKey: attempt.agentLearnerKey, package: attempt.package,
      admissionCorrelationId: attempt.correlationId, failureReasons: attempt.assessment?.failureReasons ?? null },
    gap: event?.gap ?? null,
    remediation: event ? { event, delivery } : null,
    reexaminations,
  };
}

function registerRemediationRoutes(app, { store, load, reconcile, lifecycleView, sendError }) {
  app.get('/internal/admin/attempts/:id/remediation', async (req, res) => {
    try {
      if (req.header('x-actor-role') !== 'admin') throw fail('forbidden', 403);
      const attempt = await reconcile(await load(req, false), req);
      res.json({ apiVersion: 'v1', trace: await remediationTrace(store, attempt, lifecycleView), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });
}

module.exports = { requireRemediation, registerRemediationRoutes };
