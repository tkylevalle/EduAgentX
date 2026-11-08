'use strict';

// Focused real Compose integration, never the formal golden or 1,000-case suite.
// Use an isolated, empty project. URLs are read from an ignored JSON file;
// checkout-local test credentials come from .env and are never printed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createLifecycleDriver } = require('../../../packages/demo-lifecycle');
const { createLifecycleMessage } = require('../../../packages/external-agent-protocol');
const { createLifecycleSource, toCandidate } = require('../clients');
const candidatePackage = require('../../curriculum-engine/examples/ai-safety-candidate');

const root = path.resolve(__dirname, '../../..');
const configFile = process.env.MARKETPLACE_LIFECYCLE_CONFIG;
const stage = process.env.MARKETPLACE_LIFECYCLE_STAGE || 'issue';
const stateFile = path.join(root, 'artifacts/marketplace-trust/real-lifecycle.json');

async function context() {
  const urls = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const request = async (url, method = 'GET', body, headers = {}) => {
    const response = await fetch(url, { method, headers: { ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  const token = async (name) => {
    const response = await request(`${urls.gatewayUrl}/v1/auth/tokens`, 'POST', {
      clientId: env[`${name}_CLIENT_ID`], clientSecret: env[`${name}_CLIENT_SECRET`],
    });
    assert.equal(response.status, 200);
    return { authorization: `Bearer ${response.body.accessToken}` };
  };
  const admin = await token('ADMIN');
  const gateway = (route, method, body) => request(`${urls.gatewayUrl}${route}`, method, body, admin);
  const originHeaders = { 'x-internal-service-key': env.MARKETPLACE_INTERNAL_KEY,
    'x-actor-subject': 'marketplace-service', 'x-actor-role': 'marketplace' };
  const originClient = createLifecycleSource({ baseUrl: urls.certificationUrl, internalKey: env.MARKETPLACE_INTERNAL_KEY });
  const readCredential = async (examinationId) => {
    const reply = await gateway(`/v1/admin/certifications/by-examination/${examinationId}`);
    assert.equal(reply.status, 200);
    return reply.body.credential;
  };
  return { urls, env, request, token, gateway, originHeaders, originClient, readCredential };
}

test('real lifecycle: immutable issued origin succeeds, absent authoritative provenance stays excluded',
  { skip: !configFile || stage !== 'issue', timeout: 180000 }, async (t) => {
    const ctx = await context();
    const { urls, env, gateway, request } = ctx;
    const driver = createLifecycleDriver({ ...urls, curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
      admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
      reviewers: [1, 2].map((i) => ({ clientId: env[`REVIEWER_${i}_CLIENT_ID`], clientSecret: env[`REVIEWER_${i}_CLIENT_SECRET`] })),
      candidate: candidatePackage });
    await driver.ensurePackage();
    const registration = await driver.register();
    const training = await driver.train();
    assert.ok(training.itemsDelivered > 0);
    const examination = await driver.examine();
    assert.equal(examination.status, 'complete');
    const issuance = await driver.certify(examination.attemptId);
    const verification = await driver.verify(issuance.compactJws);
    assert.equal(verification.overall, 'VALID');
    const record = await ctx.readCredential(examination.attemptId);
    const candidate = toCandidate(record);
    const origin = await request(`${urls.certificationUrl}/internal/credential-origins/${record.credentialId}`,
      'GET', undefined, ctx.originHeaders);

    await t.test('production issuer authority confirms the real credential and its signed decision binding', async () => {
      assert.equal(origin.status, 200);
      assert.equal(await ctx.originClient.isLifecycleOrigin(candidate), true);
      assert.equal(origin.body.origin.decisionId, record.credential.evidence.certificationDecisionId);
      assert.equal(origin.body.origin.examinationId, examination.attemptId);
      assert.equal(origin.body.origin.subjectId, registration.agentLearnerKey);
      assert.equal(origin.body.origin.configurationFingerprint, registration.configurationFingerprint);
    });

    const agent = await ctx.token('AGENT');
    const message = createLifecycleMessage({ messageId: randomUUID(), correlationId: randomUUID(),
      idempotencyKey: randomUUID(), timeoutMs: 2500, evidence: { mode: 'synthetic' },
      payload: { interactionType: 'marketplace.listing.publish',
        data: { agentLearnerKey: registration.agentLearnerKey, response: 'publish' } } });
    assert.equal((await request(`${urls.gatewayUrl}/v1/agent-learner/interactions`, 'POST', message, agent)).status, 201);
    const pkg = await driver.activePackage();
    const created = await gateway('/v1/marketplace/capability-requests', 'POST', { idempotencyKey: randomUUID(), request: {
      domain: 'ai-agent-safety-secure-tool-use', requiredObjectiveIds: pkg.objectives.map((o) => o.id),
      minOverallPercent: 80, minAdversarialPercent: 70, maxCredentialAgeDays: 365,
      allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation', title: 'Origin integration test',
    } });
    assert.equal(created.status, 201);
    const requestId = created.body.request.id;
    assert.equal((await gateway(`/v1/marketplace/capability-requests/${requestId}/open`, 'POST', { version: 1 })).status, 200);
    let check, excluded;
    for (let i = 0; i < 20; i++) {
      check = await gateway(`/v1/marketplace/capability-requests/${requestId}/eligibility-checks`, 'POST', { idempotencyKey: randomUUID() });
      assert.equal(check.status, 201);
      excluded = check.body.excluded.find((item) => item.credentialId === record.credentialId);
      if (excluded) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await t.test('actual outbox/Redis projection passes origin, signature, schema, status, fingerprint and package gates', () => {
      assert.ok(excluded, 'the actual publisher and consumer must deliver the candidate');
      assert.equal(check.body.eligible.length, 0);
      assert.deepEqual(excluded.reasons.map((r) => r.code), ['ENVIRONMENT_UNCHECKABLE']);
      assert.equal(excluded.sources.lifecycleOrigin, 'answered');
    });
    await t.test('real Marketplace keeps missing provenance out of both lanes', async () => {
      assert.equal(record.credential.environment, undefined);
      assert.equal(record.credential.evidenceMode, undefined);
      const result = await gateway(`/v1/marketplace/capability-requests/${requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
      assert.equal(result.status, 201);
      const match = result.body.matchResult;
      assert.equal(match.eligibleMatches.length, 0);
      assert.equal(match.nearMatches.length, 0);
      assert.equal(match.exclusions.length, 1);
      assert.ok(match.exclusions[0].reasons.some((r) => r.code === 'EVIDENCE_MODE_UNCHECKABLE'));
    });
    await t.test('real verifier and authority reject tampered signed provenance', async () => {
      const [header, , signature] = record.compactJws.split('.');
      const credential = { ...record.credential, environment: 'live', evidenceMode: 'live' };
      const compactJws = `${header}.${Buffer.from(JSON.stringify(credential)).toString('base64url')}.${signature}`;
      const invalid = await gateway('/v1/credentials/verify', 'POST', { jws: compactJws });
      assert.equal(invalid.body.signature.status, 'FAIL');
      assert.equal(await ctx.originClient.isLifecycleOrigin(toCandidate({ ...record, credential, compactJws })), false);
      assert.equal(await ctx.originClient.isLifecycleOrigin({ ...candidate, environment: 'simulation', evidenceMode: 'synthetic' }), false);
    });
    await t.test('real issuer refuses unknown, unauthorized and broad reads', async () => {
      assert.equal((await request(`${urls.certificationUrl}/internal/credential-origins/${randomUUID()}`,
        'GET', undefined, ctx.originHeaders)).status, 404);
      assert.equal((await request(`${urls.certificationUrl}/internal/credential-origins/${record.credentialId}`)).status, 403);
      assert.equal((await request(`${urls.certificationUrl}/internal/credentials`, 'GET', undefined, ctx.originHeaders)).status, 403);
    });
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ requestId, examinationId: examination.attemptId,
      credentialId: record.credentialId, origin: origin.body.origin, verification: verification.overall,
      eligibilityReasons: excluded.reasons, result: 'origin_valid_provenance_uncheckable' }, null, 2));
  });

test('real issuer outage excludes the projected candidate from eligibility and both matching lanes',
  { skip: !configFile || stage !== 'issuer-unavailable' }, async () => {
    const ctx = await context();
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const check = await ctx.gateway(`/v1/marketplace/capability-requests/${saved.requestId}/eligibility-checks`, 'POST', { idempotencyKey: randomUUID() });
    assert.equal(check.status, 201);
    assert.equal(check.body.eligible.length, 0);
    const excluded = check.body.excluded.find((item) => item.credentialId === saved.credentialId);
    assert.ok(excluded.reasons.some((r) => r.code === 'LIFECYCLE_ORIGIN_UNCHECKABLE'));
    assert.ok(['source_unavailable', 'timeout'].includes(excluded.sources.lifecycleOrigin));
    const match = await ctx.gateway(`/v1/marketplace/capability-requests/${saved.requestId}/matches`, 'POST', { idempotencyKey: randomUUID() });
    assert.equal(match.status, 201);
    assert.equal(match.body.matchResult.eligibleMatches.length, 0);
    assert.equal(match.body.matchResult.nearMatches.length, 0);
    assert.ok(match.body.matchResult.exclusions[0].reasons.some((r) => r.code === 'LIFECYCLE_ORIGIN_UNCHECKABLE'));
  });

test('real issuer restart preserves the identical origin and signed credential',
  { skip: !configFile || stage !== 'issuer-restarted' }, async () => {
    const ctx = await context();
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const record = await ctx.readCredential(saved.examinationId);
    assert.equal(record.credentialId, saved.credentialId);
    const origin = await ctx.request(`${ctx.urls.certificationUrl}/internal/credential-origins/${record.credentialId}`,
      'GET', undefined, ctx.originHeaders);
    assert.deepEqual(origin.body.origin, saved.origin);
    assert.equal(await ctx.originClient.isLifecycleOrigin(toCandidate(record)), true);
    const replay = await ctx.request(`${ctx.urls.certificationUrl}/internal/decisions`, 'POST', {
      examinationId: saved.examinationId, idempotencyKey: 'restart-replay',
    }, { 'x-internal-service-key': ctx.env.CERTIFICATION_INTERNAL_KEY,
      'x-actor-role': 'examination-engine', 'x-actor-subject': 'examination-engine' });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.outcome, 'replay');
    assert.deepEqual(replay.body.credential, record);
    const listed = await ctx.gateway('/v1/admin/certifications');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.credentials.length, 1);
    assert.equal(listed.body.credentials[0].credentialId, saved.credentialId);
  });
