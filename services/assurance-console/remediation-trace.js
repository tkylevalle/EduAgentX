'use strict';

// Issue #21: one failure traced through its gap, the remediation event,
// Training's remediation session and every re-examination. Each upstream
// object is copied field by field, so responses, prompts, grading rationale
// and the remediation summary never reach the page.

const { randomUUID } = require('node:crypto');
const telemetry = require('../../packages/telemetry');

const SERVICE_NAME = process.env.SERVICE_NAME || 'assurance-console';
const strings = (values) => (Array.isArray(values) ? values.map(String) : []);

function failureStep(failure) {
  return { stage: 'failure', attemptId: failure.attemptId, status: failure.status, terminalReason: failure.terminalReason,
    failedAt: failure.failedAt ?? null, agentLearnerKey: failure.agentLearnerKey,
    package: failure.package && { id: failure.package.id, version: failure.package.version, digest: failure.package.digest },
    admissionCorrelationId: failure.admissionCorrelationId, failureReasons: strings(failure.failureReasons) };
}

function trainingStep(sessionId, session, trace) {
  if (!session) return { stage: 'training', sessionId, available: false };
  return { stage: 'training', sessionId: session.sessionId, kind: session.kind, status: session.status,
    correlationId: session.correlationId, correlated: session.correlationId === trace.correlationId,
    requestId: session.remediation?.requestId ?? null,
    matchesEvent: session.remediation?.requestId === trace.remediation.event.eventId,
    objectiveIds: strings(session.remediation?.objectiveIds), completedItems: session.completedItems ?? null };
}

// `session` is Training's summary of the delivered remediation session, or null
// when it could not be read.
function safeRemediationTrace(trace, session) {
  const steps = [failureStep(trace.failure)];
  if (trace.remediation) {
    const { event, delivery } = trace.remediation;
    steps.push({ stage: 'gap', objectiveIds: strings(trace.gap?.objectiveIds),
      criticalViolationRuleIds: strings(trace.gap?.criticalViolationRuleIds) });
    steps.push({ stage: 'remediation', eventId: event.eventId, occurredAt: event.occurredAt,
      evidenceDigest: event.failure?.evidenceDigest ?? null,
      delivery: delivery ? { outcome: delivery.outcome, trainingSessionId: delivery.trainingSessionId ?? null,
        recordedAt: delivery.recordedAt } : null });
    if (delivery?.trainingSessionId) steps.push(trainingStep(delivery.trainingSessionId, session, trace));
    steps.push({ stage: 'reexamination', attempts: (trace.reexaminations || []).map((attempt) => ({
      attemptId: attempt.attemptId, status: attempt.status, terminalReason: attempt.terminalReason, passed: attempt.passed,
      startedAt: attempt.startedAt, trainingSessionId: attempt.trainingSessionId, correlationId: attempt.correlationId })) });
  }
  return { correlationId: trace.correlationId, steps };
}

// Returns { status: 200, trace } or { status: 404 }; throws when unavailable.
async function readRemediationTrace(adminClient, attemptId) {
  const get = await adminClient(`console-remediation-${randomUUID()}`);
  const reply = await get(`/v1/admin/examinations/${encodeURIComponent(attemptId)}/remediation`);
  if (reply.status === 404) return { status: 404 };
  if (!reply.ok || !reply.body.trace?.failure) throw new Error(`remediation trace request returned ${reply.status}`);
  const sessionId = reply.body.trace.remediation?.delivery?.trainingSessionId;
  let session = null;
  if (sessionId) {
    const detail = await get(`/v1/admin/training-sessions/${encodeURIComponent(sessionId)}`).catch(() => ({ ok: false }));
    if (detail.ok && detail.body.session) session = detail.body.session;
    else telemetry.log(SERVICE_NAME, 'training_session_read_failed', { outcome: 'error' });
  }
  return { status: 200, trace: safeRemediationTrace(reply.body.trace, session) };
}

function renderStep(step, escapeHtml) {
  const shown = (value) => (value === undefined || value === null || value === '' ? 'none'
    : Array.isArray(value) ? (value.length ? value.join(', ') : 'none') : value);
  const list = (entries) => `<dl>${entries.map(([label, value]) =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(shown(value))}</dd>`).join('')}</dl>`;
  switch (step.stage) {
    case 'failure': return `<h2>Failure</h2>${list([['Attempt', step.attemptId], ['Status', step.status],
      ['Terminal reason', step.terminalReason], ['Failure reasons', step.failureReasons], ['Failed', step.failedAt],
      ['Agent Learner', step.agentLearnerKey], ['Package', `${step.package?.id} ${step.package?.version}`],
      ['Admission correlation id', step.admissionCorrelationId]])}`;
    case 'gap': return `<h2>Gap</h2>${list([['Objectives to remediate', step.objectiveIds],
      ['Critical rules violated', step.criticalViolationRuleIds]])}`;
    case 'remediation': return `<h2>Remediation event</h2>${list([['Event', step.eventId], ['Occurred', step.occurredAt],
      ['Evidence digest', step.evidenceDigest], ['Delivery', step.delivery?.outcome ?? 'pending'],
      ['Training session', step.delivery?.trainingSessionId], ['Delivered', step.delivery?.recordedAt]])}`;
    case 'training': return step.available === false
      ? `<h2>Training remediation session</h2><p>Training session ${escapeHtml(step.sessionId)} is unavailable.</p>`
      : `<h2>Training remediation session</h2>${list([['Session', step.sessionId], ['Kind', step.kind], ['Status', step.status],
        ['Objectives', step.objectiveIds], ['Request', step.requestId], ['Matches event', step.matchesEvent],
        ['Correlation id', step.correlationId], ['Same correlation as failure', step.correlated]])}`;
    default: return `<h2>Re-examination</h2>${step.attempts.length ? `<ol>${step.attempts.map((attempt) =>
      `<li>${escapeHtml(attempt.attemptId)} — ${escapeHtml(attempt.status)} — passed ${escapeHtml(shown(attempt.passed))}` +
      ` — Training session ${escapeHtml(shown(attempt.trainingSessionId))}</li>`).join('')}</ol>` : '<p>No re-examination has started.</p>'}`;
  }
}

function renderRemediationTrace(view, escapeHtml) {
  const body = view.steps.length === 1
    ? `${renderStep(view.steps[0], escapeHtml)}<p>No remediation was required for this attempt.</p>`
    : view.steps.map((step) => renderStep(step, escapeHtml)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Remediation trace</title></head>
    <body><h1>Remediation trace — identifiers only</h1>
    <p>Correlation id: <code>${escapeHtml(view.correlationId)}</code></p>${body}
    <p>Responses, prompts and grading rationale are intentionally omitted.</p></body></html>`;
}

function registerRemediationTrace(app, { adminClient, escapeHtml }) {
  app.get('/api/examinations/:attemptId/remediation-trace', async (req, res) => {
    try {
      const result = await readRemediationTrace(adminClient, req.params.attemptId);
      if (result.status === 404) return res.status(404).json({ apiVersion: 'v1', error: 'attempt_not_found' });
      return res.status(200).json({ apiVersion: 'v1', trace: result.trace });
    } catch {
      telemetry.log(SERVICE_NAME, 'remediation_trace_read_failed', { outcome: 'error' });
      return res.status(503).json({ apiVersion: 'v1', error: 'remediation_trace_unavailable' });
    }
  });
  app.get('/examinations/:attemptId/remediation', async (req, res) => {
    try {
      const result = await readRemediationTrace(adminClient, req.params.attemptId);
      if (result.status === 404) return res.status(404).send('Examination attempt not found');
      return res.status(200).type('html').send(renderRemediationTrace(result.trace, escapeHtml));
    } catch {
      telemetry.log(SERVICE_NAME, 'remediation_trace_read_failed', { outcome: 'error' });
      return res.status(503).send('Remediation trace unavailable');
    }
  });
}

module.exports = { registerRemediationTrace, safeRemediationTrace, renderRemediationTrace };
