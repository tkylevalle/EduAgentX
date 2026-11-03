'use strict';
// Opt-in focused rehearsal through real service interfaces. No injected
// Marketplace sources, database inserts, formal golden dataset or paid model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createLifecycleDriver } = require('../../../packages/demo-lifecycle');
const { createLifecycleMessage } = require('../../../packages/external-agent-protocol');
const p = require('../../../packages/execution-provenance');
const { GatewayProtocolClient } = require('../../synthetic-agent-learner/gateway-client');
const { createSyntheticAgentLearner } = require('../../synthetic-agent-learner/learner');
const { createExamRunner } = require('../../synthetic-agent-learner/exam-runner');
const { examAnswer } = require('../../synthetic-agent-learner/exam-scenarios');
const { createLifecycleSource, toCandidate } = require('../clients');
const config = process.env.MARKETPLACE_PROVENANCE_CONFIG;
const stage = process.env.MARKETPLACE_PROVENANCE_STAGE || 'issue';
const statePath = 'artifacts/marketplace-trust/provenance-real.json';

async function context() {
  const urls = JSON.parse(fs.readFileSync(config, 'utf8'));
  const env = Object.fromEntries(fs.readFileSync(urls.envFile || '.env', 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
  const request = async (url, method = 'GET', body, headers = {}) => {
    const r = await fetch(url, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90000) });
    return { status: r.status, body: await r.json() };
  };
  const token = async (name) => {
    const r = await request(`${urls.gatewayUrl}/v1/auth/tokens`, 'POST', {
      clientId: env[`${name}_CLIENT_ID`], clientSecret: env[`${name}_CLIENT_SECRET`] });
    assert.equal(r.status, 200); return { authorization: `Bearer ${r.body.accessToken}` };
  };
  const admin = await token('ADMIN');
  const gateway = (path, method, body) => request(`${urls.gatewayUrl}${path}`, method, body, admin);
  const driver = createLifecycleDriver({ ...urls, curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
    admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
    reviewers: [1,2].map((i) => ({ clientId: env[`REVIEWER_${i}_CLIENT_ID`], clientSecret: env[`REVIEWER_${i}_CLIENT_SECRET`] })),
    candidate: require('../../curriculum-engine/examples/ai-safety-candidate') });
  const origin = createLifecycleSource({ baseUrl: urls.certificationUrl, internalKey: env.MARKETPLACE_INTERNAL_KEY });
  const list = async (name, mode) => {
    const msg = createLifecycleMessage({ messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
      timeoutMs: 5000, evidence: { mode }, payload: { interactionType: 'marketplace.listing.publish',
        data: { agentLearnerKey: env[`${name}_CLIENT_ID`], response: 'publish' } } });
    assert.equal((await request(`${urls.gatewayUrl}/v1/agent-learner/interactions`, 'POST', msg, await token(name))).status, 201);
  };
  return { urls, env, request, token, gateway, driver, origin, list };
}

test('real authoritative synthetic and replay lifecycles become Eligible; legacy and trust failures stay excluded',
  { skip: !config || stage !== 'issue', timeout: 240000 }, async (t) => {
    const c = await context();
    await c.driver.ensurePackage();
    const pkg = await c.driver.activePackage();
    const created = await c.gateway('/v1/marketplace/capability-requests', 'POST', { idempotencyKey: randomUUID(), request: {
      domain: 'ai-agent-safety-secure-tool-use', requiredObjectiveIds: pkg.objectives.map((o) => o.id), minOverallPercent: 80,
      minAdversarialPercent: 70, maxCredentialAgeDays: 365, allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation',
      title: 'Issue 83 authoritative execution rehearsal' } });
    assert.equal(created.status, 201);
    const requestId = created.body.request.id;
    assert.equal((await c.gateway(`/v1/marketplace/capability-requests/${requestId}/open`, 'POST', { version: 1 })).status, 200);
    const saved = { requestId, credentials: [] };
    for (const mode of ['synthetic','replay']) await t.test(`${mode}: real authority, signing, verification, publication, origin and Eligible match`, async () => {
      const training = await c.request(`${c.urls.syntheticUrl}/v1/execution-runs`, 'POST', { evidenceMode: mode, action: 'training' });
      assert.equal(training.status, 200, JSON.stringify(training.body));
      assert.equal(training.body.outcome, 'completed'); assert.equal(training.body.provenance.evidenceMode, mode);
      const exam = await c.request(`${c.urls.syntheticUrl}/v1/execution-runs`, 'POST', {
        evidenceMode: mode, action: 'examination', trainingSessionId: training.body.sessionId });
      assert.equal(exam.status, 200, JSON.stringify(exam.body)); assert.equal(exam.body.outcome, 'complete');
      const issued = await c.driver.certify(exam.body.attempt.attemptId);
      assert.equal((await c.driver.verify(issued.compactJws)).overall, 'VALID');
      const read = await c.gateway(`/v1/admin/certifications/by-examination/${exam.body.attempt.attemptId}`);
      const record = read.body.credential;
      assert.equal(p.credentialProvenance(record.credential), true);
      assert.equal(record.credential.environment, 'simulation'); assert.equal(record.credential.evidenceMode, mode);
      assert.equal(await c.origin.isLifecycleOrigin(toCandidate(record)), true);
      assert.equal(await c.origin.isLifecycleOrigin({ ...toCandidate(record), credentialId: randomUUID() }), false);
      await c.list(mode === 'replay' ? 'REPLAY_AGENT' : 'AGENT', mode);
      let check, candidate;
      for (let n = 0; n < 30; n++) {
        check = await c.gateway(`/v1/marketplace/capability-requests/${requestId}/eligibility-checks`, 'POST', { idempotencyKey: randomUUID() });
        assert.equal(check.status, 201);
        candidate = check.body.eligible.find((r) => r.credentialId === record.credentialId);
        if (candidate) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(candidate, JSON.stringify(check.body));
      const matched = await c.gateway(`/v1/marketplace/capability-requests/${requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
      assert.equal(matched.status, 201);
      assert.ok(matched.body.matchResult.eligibleMatches.some((r) => r.credentialId === record.credentialId));
      assert.ok(!matched.body.matchResult.nearMatches.some((r) => r.credentialId === record.credentialId));
      saved.credentials.push({ mode, record, trainingSessionId: training.body.sessionId, examinationId: exam.body.attempt.attemptId });
    });
    await t.test('ordinary authenticated client labels do not establish provenance; real legacy credential enters neither lane', async () => {
      const client = new GatewayProtocolClient({ gatewayUrl: c.urls.gatewayUrl,
        clientId: c.env.LIVE_AGENT_CLIENT_ID || 'live-agent-learner-dev', clientSecret: c.env.LIVE_AGENT_CLIENT_SECRET });
      const learner = createSyntheticAgentLearner({ gatewayClient: client });
      const trained = await learner.train({ agentLearnerKey: client.clientId, evidenceMode: 'replay' });
      assert.equal(trained.outcome, 'completed'); assert.equal(trained.provenance, undefined);
      const exam = await createExamRunner({ gatewayClient: client }).examine({ answerFor: (item, index) => examAnswer('safe-escalation', item, index) });
      assert.equal(exam.outcome, 'complete');
      const issued = await c.driver.certify(exam.attempt.attemptId);
      assert.equal((await c.driver.verify(issued.compactJws)).overall, 'VALID');
      const record = (await c.gateway(`/v1/admin/certifications/by-examination/${exam.attempt.attemptId}`)).body.credential;
      assert.equal(await c.origin.isLifecycleOrigin(toCandidate(record)), true);
      assert.equal(record.credential.environment, undefined); assert.equal(record.credential.evidenceMode, undefined);
      await c.list('LIVE_AGENT', 'replay');
      let excluded;
      for (let n = 0; n < 30; n++) {
        const r = await c.gateway(`/v1/marketplace/capability-requests/${requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
        excluded = r.body.matchResult.exclusions.find((v) => v.credentialId === record.credentialId);
        assert.ok(![...r.body.matchResult.eligibleMatches,...r.body.matchResult.nearMatches].some((v) => v.credentialId === record.credentialId));
        if (excluded) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(excluded); assert.ok(excluded.reasons.some((r) => r.code === 'ENVIRONMENT_UNCHECKABLE'));
      assert.ok(excluded.reasons.some((r) => r.code === 'EVIDENCE_MODE_UNCHECKABLE'));
      saved.legacyCredentialId = record.credentialId;
    });
    fs.writeFileSync(statePath, JSON.stringify(saved, null, 2));
  });

test('real issuer outage excludes valid-provenance candidates from both lanes',
  { skip: !config || stage !== 'issuer-unavailable' }, async () => {
    const c = await context(), saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const r = await c.gateway(`/v1/marketplace/capability-requests/${saved.requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
    assert.equal(r.status, 201); assert.equal(r.body.matchResult.eligibleMatches.length, 0); assert.equal(r.body.matchResult.nearMatches.length, 0);
    for (const { record } of saved.credentials) assert.ok(r.body.matchResult.exclusions.find((v) => v.credentialId === record.credentialId)
      .reasons.some((v) => v.code === 'LIFECYCLE_ORIGIN_UNCHECKABLE'));
  });

test('real issuer and lifecycle-service restart preserves provenance, origin, exactly-once issuance and Eligible results',
  { skip: !config || stage !== 'restarted' }, async () => {
    const c = await context(), saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    for (const item of saved.credentials) {
      const record = (await c.gateway(`/v1/admin/certifications/by-examination/${item.examinationId}`)).body.credential;
      assert.equal(record.compactJws, item.record.compactJws);
      assert.deepEqual(record.credential.evidence.provenance, item.record.credential.evidence.provenance);
      const run = record.credential.evidence.provenance.run;
      const trainingHeaders = { 'x-internal-service-key': c.env.TRAINING_INTERNAL_KEY, 'x-actor-subject': 'integration-reader' };
      const training = await c.request(`${c.urls.trainingUrl}/internal/sessions/${run.runId}`, 'GET', undefined, trainingHeaders);
      assert.equal(training.status, 200); assert.deepEqual(training.body.session.provenance, run);
      assert.equal(training.body.events.filter(e => e.executionEvidence).length, 10);
      const query = new URLSearchParams({ agentLearnerKey: run.agentLearnerKey, packageId: run.package.id,
        packageVersion: run.package.version, packageDigest: run.package.digest, sessionId: run.runId });
      const completion = await c.request(`${c.urls.trainingUrl}/internal/completions/latest?${query}`, 'GET', undefined, trainingHeaders);
      assert.equal(completion.status, 200); assert.equal(p.validCompletion(completion.body.completion), true);
      const examination = await c.request(`${c.urls.examinationUrl}/internal/certification-evidence/${item.examinationId}`, 'GET', undefined,
        { 'x-internal-service-key': c.env.EXAMINATION_INTERNAL_KEY, 'x-actor-subject': 'certification-service', 'x-actor-role': 'certification' });
      assert.equal(examination.status, 200); assert.deepEqual(examination.body.attempt.provenance, record.credential.evidence.provenance);
      assert.equal(await c.origin.isLifecycleOrigin(toCandidate(record)), true);
      const retry = await c.request(`${c.urls.certificationUrl}/internal/decisions`, 'POST', {
        examinationId: item.examinationId, idempotencyKey: 'after-restart' }, {
        'x-internal-service-key': c.env.CERTIFICATION_INTERNAL_KEY, 'x-actor-role': 'examination-engine', 'x-actor-subject': 'examination-engine' });
      assert.equal(retry.status, 200); assert.equal(retry.body.credential.compactJws, record.compactJws);
    }
    const r = await c.gateway(`/v1/marketplace/capability-requests/${saved.requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
    assert.equal(r.status, 201);
    for (const { record } of saved.credentials) assert.ok(r.body.matchResult.eligibleMatches.some((v) => v.credentialId === record.credentialId));
    assert.equal((await c.gateway('/v1/admin/certifications')).body.credentials.length, saved.credentials.length + 1);
  });
