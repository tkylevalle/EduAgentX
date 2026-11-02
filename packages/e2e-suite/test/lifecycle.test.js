'use strict';
// Scripted public-client contract tests for orchestration only. These fixtures
// are NOT Docker, lifecycle-origin or Issue 33 acceptance evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrchestrator } = require('../lifecycle');
const { manifest } = require('../manifest');
const { computeConfigurationFingerprint } = require('../../../services/agent-registry/domain');
const { safety } = require('../invariants');
const pkg = { id: 'pkg', version: '1.0.0', digest: 'sha256:fixture', objectiveIds: ['o1'],
  template: { id: 'template', version: '1' }, rubric: { id: 'rubric', version: '1' } };
function fixture(scenario, { lostSafety = false, unsafePass = false, systemAbort = false, stressConcurrency = 1 } = {}) {
  let time = Date.parse('2026-11-01T00:00:00Z'), fingerprint, attempts = [], sessions = [], activeSession;
  const form = { package: { id: pkg.id, version: pkg.version, digest: pkg.digest }, template: pkg.template, rubric: pkg.rubric,
    tierWeights: { recall: 20, applied: 40, adversarial: 40 }, items: Array.from({ length: 15 }, (_, n) => ({
      id: `i${n}`, slotId: n === 14 ? 'v4' : `r${n}`, tier: n < 5 ? 'recall' : n < 11 ? 'applied' : 'adversarial',
      prompt: 'A synthetic public item.', objectiveIds: ['o1'] })) };
  const ok = (body, status = 200) => ({ status, body });
  const sessionView = s => ({ sessionId: s.id, status: s.completed === 2 ? 'completed' : 'open', plannedItems: 2,
    completedItems: s.completed, packageDigest: pkg.digest, configurationFingerprint: fingerprint,
    remediation: s.remediation ? { requestId: `examination.remediation.required:${attempts[0].attemptId}` } : null });
  const view = a => {
    const timeout = time >= Date.parse(a.deadlineAt) && a.responses.size < 15;
    const ended = a.responses.size === 15 || timeout;
    const passed = unsafePass || scenario.category === 'competent' || a.round > 0;
    return { attemptId: a.attemptId, sequence: a.sequence, status: ended ? systemAbort ? 'system_aborted' : passed ? 'complete' : 'agent_failed' : 'in_progress',
      deadlineAt: a.deadlineAt, startedAt: a.startedAt, configurationFingerprint: fingerprint,
      package: form.package, template: pkg.template, rubric: pkg.rubric, formDigest: 'sha256:form', trainingEventId: 'training-event',
      itemReferences: form.items.map(({ id, tier }) => ({ id, tier })), responseCollectionComplete: a.responses.size === 15,
      terminalReason: !ended ? null : systemAbort ? 'grading_unavailable' : timeout ? 'response_deadline_elapsed' : passed ? 'valid_passing_result' : 'valid_failing_result',
      assessment: !ended || timeout || systemAbort ? null : { criticalViolationRuleIds: lostSafety || unsafePass ? [] : scenario.category === 'adversarial' ? ['critical-o4'] : [],
        itemOutcomes: form.items.map(i => ({ itemId: i.id, criticalViolationRuleIds: !lostSafety && !unsafePass && scenario.category === 'adversarial' && i.slotId === 'v4' ? ['critical-o4'] : [] })),
        failureReasons: passed ? [] : scenario.category === 'adversarial' ? ['critical_violation'] :
          ['malformed', 'inconsistent'].includes(scenario.variant) ? ['malformed_response'] : ['insufficient_overall_score'] } };
  };
  const attemptFrom = route => attempts.find(a => route.includes(a.attemptId));
  const agent = {
    async register(_s, payload) { fingerprint = computeConfigurationFingerprint(payload); return ok({ registration: {
      agentLearnerKey: scenario.learnerId, status: 'active', configurationVersion: 1, configurationFingerprint: fingerprint, agentLearnerId: 'registered' } }, 201); },
    async interact(_s, operation, type) {
      if (type.startsWith('marketplace.')) return ok({}, 201);
      if (type.endsWith('start')) {
        if (operation.startsWith('remediation') && sessions.some(s => s.remediation)) {
          activeSession = sessions.find(s => s.remediation); return ok({ sessionId: activeSession.id, package: form.package });
        }
        activeSession = { id: `session-${sessions.length}`, completed: 0, remediation: operation.startsWith('remediation') };
        sessions.push(activeSession); return ok({ sessionId: activeSession.id, package: form.package }, 201);
      }
      if (type.endsWith('continue')) return ok({ item: { deliveryItemId: `training-${activeSession.completed}` }, bounds: { modelWeightsModified: false } });
      activeSession.completed++; return ok({ status: activeSession.completed === 2 ? 'completed' : 'open', modelWeightsModified: false });
    },
    async call(method, route, body) {
      if (route.startsWith('/v1/admin/skill-gap')) return ok({}, 403);
      if (route === '/v1/examinations') {
        let a = attempts.find(a => a.key === body.idempotencyKey), replay = !!a;
        if (!a) { a = { key: body.idempotencyKey, round: attempts.length, attemptId: `attempt-${attempts.length}`,
          startedAt: new Date(time).toISOString(), deadlineAt: new Date(time + 60000).toISOString(), sequence: 1, responses: new Map() }; attempts.push(a); }
        return ok({ attempt: { ...view(a), form } }, replay ? 200 : 201);
      }
      const a = attemptFrom(route);
      if (method === 'GET') return ok({ attempt: view(a) });
      const sameKey = [...a.responses.values()].find(r => r.key === body.idempotencyKey);
      if (sameKey && sameKey.response !== body.response) return ok({ error: 'idempotency_conflict' }, 409);
      if (a.responses.has(body.itemId)) {
        const r = a.responses.get(body.itemId);
        return r.response === body.response ? ok({ attempt: view(a), receipt: r.receipt }) : ok({ error: 'answer_conflict' }, 409);
      }
      if (body.expectedSequence !== a.sequence) return ok({ error: 'sequence_conflict' }, 409);
      a.sequence++;
      const receipt = { sequence: a.sequence };
      a.responses.set(body.itemId, { response: body.response, receipt, key: body.idempotencyKey });
      return ok({ attempt: view(a), receipt });
    },
  };
  const admin = { async call(method, route, body) {
    if (route.startsWith('/v1/admin/reconciliation/examinations')) {
      const query = new URLSearchParams(route.split('?')[1]); const found = attempts.filter(a => a.key === query.get('idempotencyKey'));
      return ok({ count: found.length, attemptIds: found.map(a => a.attemptId) });
    }
    if (route.startsWith('/v1/admin/reconciliation/credentials')) {
      const id = new URLSearchParams(route.split('?')[1]).get('examinationId'); const a = attempts.find(a => a.attemptId === id);
      const passed = view(a).status === 'complete'; return ok({ count: passed ? 1 : 0, credentialIds: passed ? ['credential-one'] : [] });
    }
    if (route.startsWith('/v1/admin/reconciliation/matches')) return ok({ count: 1, appearances: [] });
    if (route.startsWith('/v1/admin/training-sessions?')) return ok({ sessions: sessions.map(sessionView) });
    if (route.startsWith('/v1/admin/training-sessions/')) {
      const s = sessions.find(s => route.endsWith(s.id)); return ok({ session: sessionView(s), events: [{ eventType: 'session_completed' }] });
    }
    if (route.startsWith('/v1/admin/skill-gap/')) {
      if (route.endsWith('training-handoff')) return ok({ delivery: { outcome: 'delivered', trainingSessionId: 'session-1' } });
      // The original examination relay already owns its one assigned session.
      if (!sessions.some(s => s.remediation)) sessions.push({ id: 'session-1', completed: 0, remediation: true });
      return ok({ recommendation: { recommendationId: 'rec', source: { eventId: `examination.remediation.required:${attempts[0].attemptId}` } } }, 201);
    }
    if (route.startsWith('/v1/admin/examinations/')) {
      const a = attemptFrom(route);
      return route.endsWith('/remediation') ? ok({ trace: { gap: { objectiveIds: ['o1'] }, remediation: {
        event: { eventId: `examination.remediation.required:${a.attemptId}`, attemptId: a.attemptId, agentLearnerKey: scenario.learnerId } } } }) : ok({ attempt: view(a) });
    }
    if (route.startsWith('/v1/admin/certifications/')) {
      const a = attemptFrom(route); return ok({ decision: { outcome: 'certified' }, credential: { credentialId: 'credential-one', compactJws: 'IN_MEMORY_ONLY',
        credential: { credentialSubject: { configurationFingerprint: fingerprint }, evidence: { examinationId: a.attemptId } } } });
    }
    if (route === '/v1/credentials/verify') return ok({ overall: 'VALID' });
    if (route.endsWith('/open')) return ok({});
    if (route.endsWith('/matches')) return ok({ matchResult: { resultId: 'match-one', policyVersion: 'MATCH-POLICY-1.0.0', totalEligible: 0, totalNearMatches: 0,
      eligibleMatches: [], nearMatches: [], exclusions: [{ agentLearnerKey: scenario.learnerId, reasons: [{ code: 'LIFECYCLE_ORIGIN_UNCHECKABLE' }] }] } }, 200);
    if (route.endsWith('/capability-requests')) return ok({ request: { id: 'request-one' } }, 201);
    throw new Error(`unexpected fixture route ${method}`);
  } };
  const orchestrator = createOrchestrator({ admin, actor: 'operator', pkg, now: () => time, wait: async ms => { time += ms; }, negativeCertificationWaitMs: 0, stressConcurrency });
  return { agent, orchestrator };
}
async function run(scenario, options) {
  const f = fixture(scenario, options), ctx = await f.orchestrator.prepare(scenario, f.agent);
  await f.orchestrator.observe(ctx);
  return f.orchestrator.market(ctx, [scenario.learnerId]);
}
test('positive lifecycle is separately conformant while real-origin Marketplace evidence remains blocked', async () => {
  const r = await run(manifest.scenarios[0]);
  assert.equal(r.lifecycleStatus, 'CONFORMANT'); assert.equal(r.status, 'BLOCKED');
  assert.equal(r.reason, 'marketplace_origin_integration'); assert.equal(r.duplicates.examinations, 0);
  assert.ok(!JSON.stringify(r).includes('IN_MEMORY_ONLY'));
});
test('expected adversarial failure is a conformant scenario; missed rule cannot hide behind score failure', async () => {
  const s = manifest.scenarios.find(s => s.category === 'adversarial');
  const r = await run(s); assert.equal(r.status, 'CONFORMANT');
  assert.equal(r.checks.find(c => c.id === 'no_credential')?.passed, true);
  assert.equal(safety(s, r.observed).falsePass, false);
  const miss = await run(s, { lostSafety: true });
  assert.equal(miss.status, 'MISMATCH'); assert.equal(safety(s, miss.observed).falsePass, true);
  const unsafe = await run(s, { unsafePass: true });
  assert.equal(unsafe.status, 'MISMATCH'); assert.equal(safety(s, unsafe.observed).falsePass, true);
});
for (const variant of ['malformed', 'inconsistent', 'timing-out', 'unavailable']) test(`orchestrates ${variant} to the owner-defined learner failure`, async () => {
  const r = await run(manifest.scenarios.find(s => s.variant === variant));
  assert.equal(r.status, 'CONFORMANT'); assert.equal(r.observed.status, 'agent_failed');
});
test('genuine system abort is distinguished from learner failure and blocks a healthy-path expectation', async () => {
  const r = await run(manifest.scenarios[0], { systemAbort: true });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.reason, 'unexpected_system_abort');
  assert.equal(r.observed.status, 'system_aborted');
});
test('an unsafe-profile infrastructure abort is unmeasured safety, never a fabricated missed rule or learner failure', async () => {
  const s = manifest.scenarios.find(s => s.category === 'adversarial');
  const r = await run(s, { systemAbort: true });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.reason, 'unexpected_system_abort');
  assert.equal(r.observed.status, 'system_aborted'); assert.equal(r.observed.credentialCount, 0);
  assert.ok(!r.checks.some(c => c.passed === false));
  const report = require('../report').buildReport({ mode: 'developer', selected: [s], results: [r] });
  assert.equal(report.mandatorySafetyMeasured, 0); assert.equal(report.mandatorySafetyFalsePasses, 0);
  assert.equal(report.technicalChecks, 'BLOCKED');
});
test('remediable narrative observes the existing assignment, then uses a distinct re-examination', async () => {
  const r = await run(manifest.scenarios.find(s => s.category === 'remediable'));
  assert.equal(r.lifecycleStatus, 'CONFORMANT'); assert.equal(r.status, 'BLOCKED');
  const ids = r.mappings.filter(m => m.operation.endsWith(':admission')).map(m => m.attemptId);
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2);
  assert.ok(r.checks.find(c => c.id === 'remediation_assignment_once').passed);
  assert.ok(r.checks.find(c => c.id === 'original_immutable').passed);
});
test('eight-way public replay orchestration preserves separate remediation admission keys', async () => {
  const r = await run(manifest.scenarios.find(s => s.category === 'remediable'), { stressConcurrency: 8 });
  assert.equal(r.lifecycleStatus, 'CONFORMANT'); assert.equal(r.status, 'BLOCKED');
  assert.ok(Object.values(r.duplicates).every(n => n === 0));
  const admissions = r.mappings.filter(m => m.operation.endsWith(':admission'));
  assert.equal(new Set(admissions.map(m => m.idempotencyKey)).size, 2);
});
