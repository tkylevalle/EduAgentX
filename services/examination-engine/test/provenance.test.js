'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const p = require('../../../packages/execution-provenance');
const { fixture } = require('../../../packages/execution-provenance/test/fixtures');
const { boot, answerItem, ACTOR, AGENT, EXAMINER, INTERNAL_KEY, EPISODE_KEY } = require('./exam-harness');
const { actionsResponse, policyActions } = require('../behaviour');

async function setup(t, mode, options = {}) {
  const f = fixture(mode, ACTOR);
  const ctx = await boot(t, { sources: { registration: async () => f.registration,
    completion: async () => f.completion }, ...options });
  const admission = { idempotencyKey: 'authoritative-start', trainingSessionId: f.run.runId, trustedExecution: f.authority };
  return { ...ctx, f, admission };
}

for (const mode of ['synthetic','replay']) {
  test(`${mode}: Examination pins exact Training completion and independently validates every answer`, async (t) => {
    const c = await setup(t, mode);
    let response = await c.call('POST', '/internal/attempts', c.admission);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    let a = response.body.attempt;
    assert.deepEqual(a.provenance, c.f.run);
    assert.equal((await c.store.get(a.attemptId)).form.training.completionDigest, p.hash(c.f.completion));
    const retry = await c.call('POST', '/internal/attempts', c.admission);
    assert.equal(retry.status, 200); assert.equal(retry.body.attempt.attemptId, a.attemptId);
    const changed = await c.call('POST', '/internal/attempts', { ...c.admission, trainingSessionId: randomUUID() });
    assert.equal(changed.status, 409);
    let first;
    for (const [index, item] of a.form.items.entries()) {
      if (item.kind === 'behaviour') {
        // A step that departs from the source's reference policy is refused and records nothing.
        const count = (await c.store.get(a.attemptId)).events.length;
        const off = await c.call('POST', `/internal/attempts/${a.attemptId}/episodes/${item.id}/steps`,
          { idempotencyKey: `off-${index}`, expectedSequence: a.sequence, action: { finish: { message: 'done' } } });
        assert.deepEqual([off.status, off.body.error], [409, 'provenance_conflict']);
        assert.equal((await c.store.get(a.attemptId)).events.length, count);
        a = { ...a, ...(await answerItem(c, a, item, { policy: p.episodePolicy(c.f.run, item) }, `answer-${index}`)) };
        continue;
      }
      const produced = p.receipt(c.f.run, 'examination', item, a.attemptId, c.clock());
      const body = { idempotencyKey: `answer-${index}`, expectedSequence: a.sequence, itemId: item.id,
        ...produced, trustedExecution: c.f.authority };
      const count = (await c.store.get(a.attemptId)).events.length;
      const badCases = [{ ...body, executionEvidence: undefined }, { ...body, response: 'arbitrary text' },
        { ...body, trustedExecution: { ...c.f.authority, executorId: 'other' } },
        { ...body, executionEvidence: { ...produced.executionEvidence, attemptId: randomUUID() } }];
      if (first) badCases.push({ ...body, executionEvidence: first });
      for (const bad of badCases) {
        const r = await c.call('POST', `/internal/attempts/${a.attemptId}/responses`, bad);
        assert.equal(r.status, 409); assert.equal((await c.store.get(a.attemptId)).events.length, count);
      }
      first ||= produced.executionEvidence;
      response = await c.call('POST', `/internal/attempts/${a.attemptId}/responses`, body);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      a = { ...a, ...response.body.attempt };
      assert.equal((await c.call('POST', `/internal/attempts/${a.attemptId}/responses`, body)).body.outcome, 'replay');
    }
    await c.call('POST', `/internal/attempts/${a.attemptId}/grade`, {}, EXAMINER);
    const final = await c.store.get(a.attemptId);
    assert.equal(final.status, 'complete'); assert.equal(final.executionCoverage.itemCount, 15);
    const projected = await c.call('GET', `/internal/certification-evidence/${a.attemptId}`, undefined,
      { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-role': 'certification', 'x-actor-subject': 'certification-service' });
    assert.equal(projected.status, 200);
    assert.equal(p.validSummary(projected.body.attempt.provenance, { subjectId: ACTOR,
      fingerprint: c.f.run.configurationFingerprint, package: c.f.run.package, examinationId: a.attemptId }), true);
    assert.equal(projected.body.attempt.responses, undefined);
    assert.equal(projected.body.attempt.provenance.run.evidenceMode, mode);
  });
}

test('a retried provenance-bound episode step replays instead of conflicting', async (t) => {
  const c = await setup(t, 'synthetic');
  const a = (await c.call('POST', '/internal/attempts', c.admission)).body.attempt;
  const item = (await c.store.get(a.attemptId)).form.items.find((value) => value.kind === 'behaviour');
  const [action] = policyActions(a.attemptId, item, EPISODE_KEY, p.episodePolicy(c.f.run, item));
  const body = { idempotencyKey: 'step-retry', expectedSequence: a.sequence, action };
  const path = `/internal/attempts/${a.attemptId}/episodes/${item.id}/steps`;
  const first = await c.call('POST', path, body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const retry = await c.call('POST', path, body);
  assert.deepEqual([retry.status, retry.body.outcome], [200, 'replay'], JSON.stringify(retry.body));
});

test('a concurrent off-policy step sent with the next sequence is refused under the lock', async (t) => {
  const c = await setup(t, 'synthetic');
  const a = (await c.call('POST', '/internal/attempts', c.admission)).body.attempt;
  const item = (await c.store.get(a.attemptId)).form.items.find((value) => value.kind === 'behaviour');
  const [first] = policyActions(a.attemptId, item, EPISODE_KEY, p.episodePolicy(c.f.run, item));
  const path = `/internal/attempts/${a.attemptId}/episodes/${item.id}/steps`;
  const [onPolicy, offPolicy] = await Promise.all([
    c.call('POST', path, { idempotencyKey: 'race-1', expectedSequence: a.sequence, action: first }),
    c.call('POST', path, { idempotencyKey: 'race-2', expectedSequence: a.sequence + 1, action: { finish: { message: 'done' } } })]);
  assert.equal(onPolicy.status, 200, JSON.stringify(onPolicy.body));
  assert.equal(offPolicy.status, 409);
  const steps = (await c.store.get(a.attemptId)).events.filter((e) => e.eventType === 'episode_step_recorded');
  assert.deepEqual(steps.map((e) => e.payload.action), [first]);
});

test('the store refuses caller-supplied episode evidence and a provenance step without the reference', async (t) => {
  const c = await setup(t, 'synthetic');
  const a = (await c.call('POST', '/internal/attempts', c.admission)).body.attempt;
  const item = (await c.store.get(a.attemptId)).form.items.find((value) => value.kind === 'behaviour');
  const [first] = policyActions(a.attemptId, item, EPISODE_KEY, p.episodePolicy(c.f.run, item));
  const step = { type: 'episode_step', idempotencyKey: 'direct', expectedSequence: a.sequence, itemId: item.id, action: first,
    now: c.clock(), correlationId: 'direct' };
  await assert.rejects(c.store.command(a.attemptId, step), /provenance_conflict/);
  const forged = p.episodeReceipt(c.f.run, item, a.attemptId, '{}', '2026-11-09T00:00:00.000Z');
  await assert.rejects(c.store.command(a.attemptId, { ...step, executionEvidence: forged },
    { referenceActions: () => [first] }), /provenance_conflict/);
});

test('an episode receipt binds the run, attempt, item, steps, policy and a well-formed time', () => {
  const f = fixture('synthetic', ACTOR), attemptId = randomUUID();
  const items = require('../standard-generator').createStandardItems({ packageDigest: f.pkg.digest, template: f.pkg.examTemplate,
    objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  const [item, other] = items.filter((value) => value.kind === 'behaviour');
  const response = actionsResponse([{ finish: { message: 'done' } }]);
  const rec = p.episodeReceipt(f.run, item, attemptId, response, '2026-11-09T00:00:00.000Z');
  assert.ok(rec.entryId.endsWith(':episode:safe-agent'));
  assert.deepEqual(p.validateEpisodeReceipt(f.run, rec, item, response, attemptId), rec);
  for (const bad of [() => p.validateEpisodeReceipt(f.run, rec, item, response, randomUUID()),
    () => p.validateEpisodeReceipt(f.run, rec, other, response, attemptId),
    () => p.validateEpisodeReceipt(f.run, rec, item, actionsResponse([{ finish: { message: 'other' } }]), attemptId),
    () => p.validateEpisodeReceipt(f.run, { ...rec, executedAt: 'yesterday' }, item, response, attemptId),
    () => p.validateEpisodeReceipt(f.run, { ...rec, entryId: rec.entryId.replace('safe-agent', 'instruction-follower') }, item, response, attemptId),
    () => p.validateEpisodeReceipt(fixture('synthetic', 'other-agent').run, rec, item, response, attemptId)])
    assert.throws(bad, /provenance_conflict/);
});

test('Examination refuses unknown/wrong exact Training run, incomplete completion and missing internal key', async (t) => {
  const c = await setup(t, 'synthetic');
  assert.equal((await c.call('POST', '/internal/attempts', c.admission, { ...AGENT, 'x-internal-service-key': '' })).status, 403);
  assert.equal((await c.call('POST', '/internal/attempts', { ...c.admission, trainingSessionId: randomUUID() })).status, 409);
  assert.equal((await c.call('POST', '/internal/attempts', { idempotencyKey: 'legacy-bypass' })).status, 409);
  c.f.completion.executionCoverage.itemCount--;
  assert.equal((await c.call('POST', '/internal/attempts', c.admission)).status, 409);
});

test('fallback generation outage retains exact run independently of assessment mode and validates responses', async (t) => {
  const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
  const c = await setup(t, 'synthetic', { appOptions: { selectFallback: async ({ pkg }) => ({
    packageVersion: pkg.version, packageDigest: pkg.digest, selection: { packageId: pkg.packageId,
      bankId: candidate.fallbackBank.id, bankVersion: candidate.fallbackBank.version, attemptId: randomUUID(),
      mode: 'fallback', scoringPolicy: {}, items: candidate.fallbackBank.items.map(({ expectedAnswer, scoringRule, ...i }) => i) } }) } });
  const body = { idempotencyKey: 'fallback-source', agentLearnerKey: ACTOR, reason: 'standard_generation_unavailable', trainingSessionId: c.f.run.runId };
  const r = await c.call('POST', '/internal/attempts/fallback', body, EXAMINER);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = r.body.attempt;
  assert.equal(a.mode, 'fallback'); assert.deepEqual(a.provenance, c.f.run);
  const item = a.form.items[0], produced = p.receipt(c.f.run, 'examination', item, a.attemptId, c.clock());
  const answer = { idempotencyKey: 'fallback-answer', expectedSequence: a.sequence, itemId: item.id, ...produced, trustedExecution: c.f.authority };
  assert.equal((await c.call('POST', `/internal/attempts/${a.attemptId}/responses`, answer)).status, 200);
  assert.equal((await c.call('POST', '/internal/attempts/fallback', { ...body, idempotencyKey: 'wrong-run', trainingSessionId: randomUUID() }, EXAMINER)).status, 409);
});


test('grading-outage fallback preserves the legitimate aborted attempt run and refuses changed configuration', async (t) => {
  const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
  const c = await setup(t, 'synthetic', { appOptions: { selectFallback: async ({ pkg }) => ({ packageVersion: pkg.version,
    packageDigest: pkg.digest, selection: { packageId: pkg.packageId, bankId: candidate.fallbackBank.id,
      bankVersion: candidate.fallbackBank.version, attemptId: randomUUID(), mode: 'fallback', scoringPolicy: {},
      items: candidate.fallbackBank.items.map(({ expectedAnswer, scoringRule, ...i }) => i) } }) } });
  const admitted = await c.call('POST', '/internal/attempts', c.admission);
  const a = admitted.body.attempt;
  const aborted = await c.call('POST', `/internal/attempts/${a.attemptId}/abort`, { idempotencyKey: 'outage',
    expectedSequence: a.sequence, eventId: 'outage-event', reason: 'grading_unavailable' }, EXAMINER);
  assert.equal(aborted.status, 200); assert.equal(aborted.body.attempt.status, 'system_aborted');
  const body = { idempotencyKey: 'grading-fallback', agentLearnerKey: ACTOR, reason: 'standard_grading_unavailable', causeAttemptId: a.attemptId };
  const fallback = await c.call('POST', '/internal/attempts/fallback', body, EXAMINER);
  assert.equal(fallback.status, 201); assert.deepEqual(fallback.body.attempt.provenance, c.f.run);
  c.f.registration.configurationFingerprint = 'changed';
  const changed = await c.call('POST', '/internal/attempts/fallback', { ...body, idempotencyKey: 'changed' }, EXAMINER);
  assert.equal(changed.status, 409);
});
