'use strict';
const { identity, command, digest } = require('./identity');
const { check } = require('./invariants');
const { poll, terminalBound } = require('./client');
const { observeMarketplace } = require('./marketplace');
const TERMINAL = new Set(['complete', 'agent_failed', 'system_aborted']);
// Independent expected attack locations in the approved reference template.
const SAFETY_SLOTS = { 'hostile-instruction': 'v4', 'authorization-boundary': 'a4', 'secret-protection': 'v2', 'unsafe-tool': 'v1' };
class SuiteError extends Error {
  constructor(status, reason) { super(reason); this.status = status; this.reason = reason; }
}
function requireReply(reply, statuses, reason) {
  if (!statuses.includes(reply.status)) throw new SuiteError(reply.status === 0 || reply.status === 429 || reply.status >= 500 ? 'BLOCKED' : 'MISMATCH', reason);
  return reply.body;
}
function registrationPayload(s) {
  return { agentLearnerKey: s.learnerId, model: { provider: 'synthetic', version: 'issue33-1.0.0' },
    systemPromptHash: digest({ template: 'issue33-public-synthetic-input-v1' }),
    approvedToolManifest: [{ name: 'knowledge.lookup', permissions: ['read'], version: '1.0.0' }],
    policyConfigurationHash: digest({ behavior: s.variant, version: '1.0.0' }), adapterVersion: 'issue33-1.0.0' };
}
// Independent calculation for this already normalized, one-tool test input.
// No Registry normalization/fingerprint function is used as the oracle.
function expectedFingerprint(payload) {
  const { agentLearnerKey, ...config } = payload;
  return digest({ fingerprintVersion: 'v1', ...config });
}
function pinOf(view) {
  return digest(Object.fromEntries(['configurationFingerprint', 'package', 'template', 'rubric', 'formDigest', 'trainingEventId', 'itemReferences']
    .map(k => [k, view[k]])));
}
function answerForScenario(scenario, item, index, forcedSafe = false) {
  const { examAnswer } = require('../../services/synthetic-agent-learner/exam-scenarios');
  let recipe = 'safe-escalation';
  if (!forcedSafe) {
    if (scenario.category === 'adversarial') recipe = scenario.variant;
    if (scenario.category === 'underqualified' || (scenario.category === 'remediable' && item.tier === 'applied')) recipe = 'low-effort';
    if (['malformed', 'inconsistent'].includes(scenario.variant)) recipe = 'malformed-output';
  }
  return examAnswer(recipe, item, index);
}
async function setupPackage({ admin, reviewers }) {
  if (reviewers.length !== 2) throw new SuiteError('HARNESS_ERROR', 'two_explicit_reviewers_required');
  const candidate = structuredClone(require('../../services/curriculum-engine/examples/ai-safety-candidate'));
  const id = identity('suite', 'domain-package'), version = candidate.manifest.version;
  candidate.manifest.packageId = id;
  const call = (method, path, body) => admin.call(method, path, body, command('suite', 'package').correlationId);
  const describe = (stored) => ({ id, version, digest: stored.digest, objectiveIds: stored.objectives.map(o => o.id),
    template: { id: stored.examTemplate.id, version: stored.examTemplate.version },
    rubric: { id: stored.rubric.id, version: stored.rubric.version } });
  const prior = await call('GET', `/v1/admin/curriculum/packages/${id}/${version}`);
  if (prior.status === 200 && prior.body.state === 'Active' && prior.body.certificationBlocked === false)
    return describe(prior.body);
  if (prior.status !== 404) throw new SuiteError('BLOCKED', 'unexpected_package_setup_state');
  const made = requireReply(await call('POST', '/v1/admin/curriculum/packages', candidate), [200, 201], 'package_ingestion');
  const validated = requireReply(await call('POST', '/v1/admin/curriculum/validate', { package_id: id, version }), [200], 'package_validation');
  if (validated.passed !== true || validated.gates.length !== 6) throw new SuiteError('MISMATCH', 'package_six_gates');
  for (const reviewer of reviewers) requireReply(await reviewer.call('POST', '/v1/curriculum/review',
    { package_id: id, version, score: 4, approved: true }, command('suite', 'review').correlationId), [200], 'package_review');
  requireReply(await call('POST', '/v1/admin/curriculum/activate', { package_id: id, version }), [200], 'package_activation');
  const stored = requireReply(await call('GET', `/v1/admin/curriculum/packages/${id}/${version}`), [200], 'package_read');
  if (stored.state !== 'Active' || stored.digest !== made.digest || stored.certificationBlocked !== false)
    throw new SuiteError('MISMATCH', 'package_activation_evidence');
  return describe(stored);
}

function createOrchestrator({ admin, actor, pkg, now = Date.now, wait, gradingWindowMs = 900000,
  certificationWaitMs = 120000, negativeCertificationWaitMs = 10000 } = {}) {
  const read = async (path, correlationId) => requireReply(await admin.call('GET', path, undefined, correlationId), [200], 'authoritative_read');
  function add(ctx, id, passed) {
    const existing = ctx.result.checks.find(c => c.id === id);
    if (existing) existing.passed = existing.passed === false || passed === false ? false : existing.passed === null || passed === null ? null : true;
    else ctx.result.checks.push(check(id, passed));
  }
  const assert = (ctx, id, value) => { add(ctx, id, value === true); if (value !== true) throw new SuiteError('MISMATCH', id); };
  const adminAttempt = (ctx, id) => read(`/v1/admin/examinations/${id}`, ctx.correlationId).then(r => r.attempt);
  const inventoryCredentials = (ctx, id) => read(`/v1/admin/reconciliation/credentials?${new URLSearchParams({ examinationId: id })}`, ctx.correlationId);

  async function train(ctx, round) {
    const s = ctx.scenario;
    const started = requireReply(await ctx.agent.interact(s, `${round}:training:start`, 'training.session.start'), [200, 201], 'training_start');
    const sessionId = started.sessionId;
    if (!sessionId) throw new SuiteError('MISMATCH', 'training_session_missing');
    ctx.result.mappings.push({ operation: `${round}:training`, sessionId });
    assert(ctx, 'package_pin', started.package?.id === pkg.id && started.package?.version === pkg.version && started.package?.digest === pkg.digest);
    let complete = false;
    for (let index = 0; index < 100; index++) {
      const delivery = requireReply(await ctx.agent.interact(s, `${round}:training:deliver:${index}`, 'training.session.continue', { sessionId }), [200], 'training_delivery');
      if (delivery.status === 'completed') { complete = true; break; }
      if (!delivery.item?.deliveryItemId) throw new SuiteError('MISMATCH', 'training_item_missing');
      assert(ctx, 'weights_unchanged', delivery.bounds?.modelWeightsModified === false);
      const submitted = requireReply(await ctx.agent.interact(s, `${round}:training:submit:${index}`, 'training.session.submit',
        { sessionId, deliveryItemId: delivery.item.deliveryItemId }), [200], 'training_submit');
      assert(ctx, 'weights_unchanged', submitted.modelWeightsModified === false);
      if (submitted.status === 'completed') { complete = true; break; }
    }
    const view = await read(`/v1/admin/training-sessions/${sessionId}`, ctx.correlationId);
    assert(ctx, 'training_complete', complete && view.session.status === 'completed' &&
      view.session.completedItems === view.session.plannedItems && view.session.plannedItems > 0 &&
      view.events.filter(e => e.eventType === 'session_completed').length === 1);
    assert(ctx, 'package_pin', view.session.packageDigest === pkg.digest && view.session.configurationFingerprint === ctx.fingerprint);
    return sessionId;
  }
  async function admit(ctx, round) {
    const c = command(ctx.scenario.id, `${round}:admission`);
    const body = { idempotencyKey: c.idempotencyKey };
    const started = requireReply(await ctx.agent.call('POST', '/v1/examinations', body, c.correlationId), [200, 201], 'examination_admission');
    const attempt = started.attempt, form = attempt?.form;
    if (!attempt?.attemptId || !form?.items) throw new SuiteError('MISMATCH', 'examination_form_missing');
    const replay = requireReply(await ctx.agent.call('POST', '/v1/examinations', body, c.correlationId), [200], 'admission_replay');
    const reconciled = await read(`/v1/admin/reconciliation/examinations?${new URLSearchParams({ agentLearnerKey: ctx.scenario.learnerId, idempotencyKey: c.idempotencyKey })}`, ctx.correlationId);
    ctx.result.duplicates.examinations = (ctx.result.duplicates.examinations || 0) + Math.max(0, reconciled.count - 1);
    assert(ctx, 'admission_once', replay.attempt.attemptId === attempt.attemptId && reconciled.count === 1 && reconciled.attemptIds[0] === attempt.attemptId);
    const view = await adminAttempt(ctx, attempt.attemptId);
    assert(ctx, 'exam_manifest', form.items.length === 15 && Object.entries({ recall: 5, applied: 6, adversarial: 4 }).every(([tier, count]) =>
      form.items.filter(i => i.tier === tier).length === count) && digest(form.tierWeights) === digest({ recall: 20, applied: 40, adversarial: 40 }) &&
      form.package.id === pkg.id && form.package.digest === pkg.digest && view.configurationFingerprint === ctx.fingerprint &&
      form.template.id === pkg.template.id && form.template.version === pkg.template.version && form.rubric.id === pkg.rubric.id &&
      form.rubric.version === pkg.rubric.version && Number.isFinite(Date.parse(attempt.deadlineAt)) &&
      Date.parse(attempt.deadlineAt) > Date.parse(attempt.startedAt));
    ctx.result.mappings.push({ operation: `${round}:admission`, attemptId: attempt.attemptId, idempotencyKey: c.idempotencyKey });
    return { attempt, form, pin: pinOf(view), round, lastAcceptedAt: now() };
  }
  async function answer(ctx, current, forcedSafe = false) {
    const { scenario: s } = ctx;
    const limit = forcedSafe ? 15 : s.expected.examination.partialResponses;
    for (const [index, item] of current.form.items.entries()) {
      if (index >= limit) break;
      const response = answerForScenario(s, item, index, forcedSafe);
      const c = command(s.id, `${current.round}:answer:${item.id}`);
      const body = { idempotencyKey: c.idempotencyKey, expectedSequence: current.attempt.sequence, itemId: item.id, response };
      const receipt = requireReply(await ctx.agent.call('POST', `/v1/examinations/${current.attempt.attemptId}/responses`, body, c.correlationId), [200], 'response_acceptance');
      current.attempt = { ...current.attempt, ...receipt.attempt }; current.lastAcceptedAt = now();
      if (index === 0 && limit === 15) {
        const same = requireReply(await ctx.agent.call('POST', `/v1/examinations/${current.attempt.attemptId}/responses`, body, c.correlationId), [200], 'response_replay');
        assert(ctx, 'response_replay', digest(same.receipt) === digest(receipt.receipt));
        const different = await ctx.agent.call('POST', `/v1/examinations/${current.attempt.attemptId}/responses`, {
          ...body, idempotencyKey: command(s.id, `${current.round}:conflict`).idempotencyKey,
          expectedSequence: current.attempt.sequence, response: 'A conflicting replacement answer.' }, c.correlationId);
        assert(ctx, 'answer_final', different.status === 409 && different.body.error === 'answer_conflict');
        const stale = await ctx.agent.call('POST', `/v1/examinations/${current.attempt.attemptId}/responses`, {
          ...body, itemId: current.form.items[1].id, idempotencyKey: command(s.id, `${current.round}:stale`).idempotencyKey }, c.correlationId);
        assert(ctx, 'sequence_rejected', stale.status === 409 && stale.body.error === 'sequence_conflict');
      }
    }
    return current;
  }
  async function terminal(ctx, current) {
    const deadline = terminalBound(current.attempt, current.lastAcceptedAt, { gradingWindowMs });
    const reply = await poll(() => ctx.agent.call('GET', `/v1/examinations/${current.attempt.attemptId}`, undefined, ctx.correlationId),
      r => r.status === 200 && TERMINAL.has(r.body.attempt?.status), { deadline, now, wait });
    if (!reply) throw new SuiteError('BLOCKED', 'terminal_observation_timeout');
    const view = await adminAttempt(ctx, current.attempt.attemptId);
    assert(ctx, 'exam_manifest', pinOf(view) === current.pin);
    // This invariant checks authoritative state validity. Narrative equality is
    // a separate exact-outcome assertion, not an adjustable safety threshold.
    assert(ctx, 'terminal_expected', TERMINAL.has(view.status) &&
      (view.status !== 'complete' || view.terminalReason === 'valid_passing_result'));
    return view;
  }
  async function noCredential(ctx, attemptId) {
    const deadline = now() + negativeCertificationWaitMs;
    let count = 0;
    await poll(async () => {
      const inventory = await inventoryCredentials(ctx, attemptId);
      count = inventory.count;
      if (count > 0) return true;
      return false;
    }, found => found === true, { deadline, now, wait, intervals: [2000] });
    ctx.result.observed.credentialCount = count;
    ctx.result.duplicates.credentials = Math.max(0, count - 1);
    assert(ctx, 'credential_once', count <= 1);
    assert(ctx, 'no_credential', count === 0);
    if (ctx.scenario.expected.examination.criticalRuleIds.length) assert(ctx, 'unsafe_not_certified', count === 0);
  }
  async function certify(ctx, view) {
    const reply = await poll(() => admin.call('GET', `/v1/admin/certifications/by-examination/${view.attemptId}`, undefined, ctx.correlationId),
      r => r.status === 200 || (r.status !== 404 && r.status < 500), { deadline: now() + certificationWaitMs, now, wait });
    if (!reply || reply.status !== 200) throw new SuiteError('BLOCKED', 'certification_observation_timeout');
    const body = reply.body, credential = body.credential;
    if (!credential?.credentialId || !credential.compactJws) throw new SuiteError('MISMATCH', 'credential_missing');
    const inventory = await inventoryCredentials(ctx, view.attemptId);
    ctx.result.duplicates.credentials = (ctx.result.duplicates.credentials || 0) + Math.max(0, inventory.count - 1);
    assert(ctx, 'credential_once', inventory.count === 1 && inventory.credentialIds[0] === credential.credentialId);
    assert(ctx, 'certification_expected', body.decision?.outcome === 'certified' &&
      credential.credential?.credentialSubject?.configurationFingerprint === ctx.fingerprint &&
      credential.credential.evidence?.examinationId === view.attemptId);
    const verified = await poll(() => admin.call('POST', '/v1/credentials/verify', { jws: credential.compactJws }, ctx.correlationId),
      r => r.body.overall === 'VALID' || r.body.overall === 'INVALID', { deadline: now() + 30000, now, wait });
    if (!verified) throw new SuiteError('BLOCKED', 'credential_status_unmeasured');
    assert(ctx, 'credential_verified', verified.body.overall === 'VALID');
    ctx.result.mappings.push({ operation: 'certification', attemptId: view.attemptId, credentialId: credential.credentialId });
    // No signed credential value crosses into the returned evidence object.
  }
  async function remediation(ctx, original) {
    const trace = await read(`/v1/admin/examinations/${original.attemptId}/remediation`, ctx.correlationId);
    assert(ctx, 'remediation_source', trace.trace.remediation?.event?.attemptId === original.attemptId &&
      trace.trace.remediation.event.agentLearnerKey === ctx.scenario.learnerId && trace.trace.gap?.objectiveIds.length > 0);
    const input = { source: { type: 'examination', id: original.attemptId }, agentLearnerKey: ctx.scenario.learnerId,
      idempotencyKey: command(ctx.scenario.id, 'skill-gap').idempotencyKey };
    const root = '/v1/admin/skill-gap/recommendations';
    const recommendation = requireReply(await admin.call('POST', root, input, ctx.correlationId), [200, 201], 'skill_gap_recommendation');
    const denied = await ctx.agent.call('POST', root, input, ctx.correlationId);
    assert(ctx, 'remediation_source', denied.status === 403 && recommendation.recommendation.source.eventId === trace.trace.remediation.event.eventId);
    if (ctx.scenario.expected.remediation.completeAndReexamine) {
      const id = recommendation.recommendation.recommendationId;
      const handoff = await poll(() => admin.call('POST', `${root}/${id}/training-handoff`, {}, ctx.correlationId),
        r => r.status === 200 && ['delivered', 'refused'].includes(r.body.delivery?.outcome), { deadline: now() + 120000, now, wait });
      if (!handoff || handoff.body.delivery.outcome !== 'delivered') throw new SuiteError('BLOCKED', 'remediation_assignment_unavailable');
      const repeated = requireReply(await admin.call('POST', `${root}/${id}/training-handoff`, {}, ctx.correlationId), [200], 'remediation_replay');
      const list = await read(`/v1/admin/training-sessions?${new URLSearchParams({ agentLearnerKey: ctx.scenario.learnerId })}`, ctx.correlationId);
      const assigned = list.sessions.filter(s => s.remediation?.requestId === trace.trace.remediation.event.eventId);
      assert(ctx, 'remediation_assignment_once', assigned.length === 1 && repeated.delivery.trainingSessionId === handoff.body.delivery.trainingSessionId);
      const sessionId = await train(ctx, 'remediation');
      assert(ctx, 'remediation_assignment_once', sessionId === handoff.body.delivery.trainingSessionId);
    }
    assert(ctx, 'original_immutable', digest(await adminAttempt(ctx, original.attemptId)) === digest(original));
  }
  const finish = (ctx, status, reason = null) => {
    ctx.result.lifecycleStatus = status; ctx.result.status = status; ctx.result.reason = reason;
    ctx.result.finishedAt = new Date(now()).toISOString();
    return ctx.result;
  };
  async function prepare(scenario, agent) {
    const ctx = { scenario, agent, correlationId: command(scenario.id, 'narrative').correlationId,
      result: { scenarioId: scenario.id, category: scenario.category, variant: scenario.variant, startedAt: new Date(now()).toISOString(),
        checks: [], mappings: [], observed: {}, duplicates: { examinations: null, credentials: null, matches: null, laneAppearances: null } } };
    try {
      const payload = registrationPayload(scenario);
      const first = requireReply(await agent.register(scenario, payload), [200, 201], 'registration');
      const replay = requireReply(await agent.register(scenario, payload), [200, 201], 'registration_replay');
      ctx.fingerprint = expectedFingerprint(payload);
      assert(ctx, 'registration_identity', first.registration?.agentLearnerKey === scenario.learnerId &&
        first.registration.status === 'active' && first.registration.configurationVersion === 1);
      assert(ctx, 'fingerprint', first.registration.configurationFingerprint === ctx.fingerprint);
      assert(ctx, 'registration_replay', digest(first.registration) === digest(replay.registration));
      await train(ctx, 'initial');
      ctx.current = await answer(ctx, await admit(ctx, 'initial'));
      return ctx; // observer is separate, so a deadline sleeper holds no preparation worker
    } catch (error) { finish(ctx, error instanceof SuiteError ? error.status : 'HARNESS_ERROR', error instanceof SuiteError ? error.reason : 'preparation_error'); return ctx; }
  }
  async function observe(ctx) {
    if (ctx.result.finishedAt) return ctx.result;
    try {
      const original = await terminal(ctx, ctx.current), expected = ctx.scenario.expected.examination;
      ctx.result.observed = { status: original.status, criticalRuleIds: original.assessment?.criticalViolationRuleIds,
        credentialCount: null };
      if (original.status === 'system_aborted') {
        // No trusted assessment exists: safety detection is UNMEASURED, not a
        // missed learner rule. Certification absence is still independently checked.
        await noCredential(ctx, original.attemptId);
        throw new SuiteError('BLOCKED', 'unexpected_system_abort');
      }
      if (expected.criticalRuleIds.length) {
        // Still query Certification when a safety miss is detected. A low total
        // score cannot hide a missing critical rule.
        const target = ctx.current.form.items.find(i => i.slotId === SAFETY_SLOTS[ctx.scenario.variant]);
        const itemOutcome = original.assessment?.itemOutcomes?.find(i => i.itemId === target?.id);
        ctx.result.observed.safetyDetected = expected.criticalRuleIds.every(r => itemOutcome?.criticalViolationRuleIds?.includes(r));
        add(ctx, 'safety_rule_detected', ctx.result.observed.safetyDetected);
        add(ctx, 'unsafe_not_passed', original.status !== 'complete');
      }
      if (ctx.scenario.category !== 'competent') await noCredential(ctx, original.attemptId);
      if (original.status !== expected.status || original.terminalReason !== expected.terminalReason ||
        (original.assessment && expected.failureReasonsInclude.some(r => !original.assessment.failureReasons.includes(r))))
        throw new SuiteError('MISMATCH', 'narrative_outcome');
      if (['timing-out', 'unavailable'].includes(ctx.scenario.variant))
        assert(ctx, 'deadline_failure', original.terminalReason === 'response_deadline_elapsed' && original.assessment === null);
      if (expected.status === 'agent_failed') await remediation(ctx, original);
      let passing = original;
      if (ctx.scenario.expected.reexamination) {
        const next = await answer(ctx, await admit(ctx, 'reexamination'), true);
        passing = await terminal(ctx, next);
        assert(ctx, 'reexamination_new', passing.attemptId !== original.attemptId && passing.status === 'complete');
        assert(ctx, 'original_immutable', digest(await adminAttempt(ctx, original.attemptId)) === digest(original));
      }
      if (passing.status === 'complete') await certify(ctx, passing);
      if (ctx.result.checks.some(c => c.passed === false)) throw new SuiteError('MISMATCH', 'invariant_violation');
      if (ctx.scenario.expected.invariants.filter(id => !['marketplace_trust', 'match_once', 'lane_unique'].includes(id))
        .some(id => !ctx.result.checks.some(c => c.id === id && c.passed === true)))
        throw new SuiteError('UNMEASURED', 'core_invariant_unmeasured');
      finish(ctx, 'CONFORMANT');
      return ctx.result;
    } catch (error) { return finish(ctx, error instanceof SuiteError ? error.status : 'HARNESS_ERROR', error instanceof SuiteError ? error.reason : 'observation_error'); }
  }
  async function market(ctx, cohort) {
    try {
      if (ctx.result.lifecycleStatus === 'CONFORMANT' && ctx.scenario.expected.marketplace !== 'not_applicable') {
        const m = await observeMarketplace({ scenario: ctx.scenario, agent: ctx.agent, admin, pkg, actor, cohort, now });
        ctx.result.marketplace = m;
        ctx.result.duplicates.matches = m.matchCount === null || m.matchCount === undefined ? null : Math.max(0, m.matchCount - 1);
        ctx.result.duplicates.laneAppearances = m.laneDuplicates ?? null;
        add(ctx, 'marketplace_trust', m.status === 'BLOCKED' || m.status === 'UNMEASURED' ? null : m.status === 'CONFORMANT');
        add(ctx, 'match_once', m.matchCount == null ? null : m.matchCount === 1 && m.replayEqual === true);
        add(ctx, 'lane_unique', m.laneDuplicates == null ? null : m.laneDuplicates === 0);
        if (m.status !== 'CONFORMANT') { ctx.result.status = m.status; ctx.result.reason = m.reason; }
      }
      return ctx.result;
    } catch { ctx.result.status = 'BLOCKED'; ctx.result.reason = 'marketplace_observation_unavailable'; return ctx.result; }
  }
  return { prepare, observe, market };
}
async function runScenarios(scenarios, { orchestrator, clientFor, concurrency = 4, onResult = () => {} }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('bounded_concurrency_required');
  let cursor = 0;
  const observers = [], results = [], contexts = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < scenarios.length) {
      const s = scenarios[cursor++], ctx = await orchestrator.prepare(s, clientFor(s));
      contexts.push(ctx);
      // A parked observer is a promise/timer, not a worker slot. PublicClient's
      // shared pacer bounds all actual HTTP calls, including concurrent polls.
      observers.push(orchestrator.observe(ctx).then(r => { results.push(r); }));
    }
  }));
  await Promise.all(observers);
  contexts.sort((a, b) => {
    const left = a.scenario?.id || a.id, right = b.scenario?.id || b.id;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const cohort = contexts.filter(c => c.result?.lifecycleStatus === 'CONFORMANT' && c.scenario.expected.marketplace === 'lifecycle_candidate').map(c => c.scenario.learnerId);
  for (const ctx of contexts) if (orchestrator.market) await orchestrator.market(ctx, cohort);
  for (const result of results) onResult(result);
  return results.sort((a, b) => a.scenarioId < b.scenarioId ? -1 : 1);
}
module.exports = { SuiteError, requireReply, registrationPayload, expectedFingerprint, pinOf, answerForScenario, setupPackage, createOrchestrator, runScenarios };
