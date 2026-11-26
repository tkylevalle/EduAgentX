'use strict';

// The driver only asks owning services and records what they answered.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycleDriver, DEMO_APPROVAL_COMMENT, demoApprovalReview, demoAutoApproveFromEnv, STEPS } = require('..');

const GATEWAY = 'http://gateway';
const LEARNER = 'http://learner';
const admin = { clientId: 'admin', clientSecret: 'secret' };

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const route = Object.keys(routes).find((key) => url.endsWith(key));
    const [status, body] = route ? routes[route] : [404, { error: 'not_found' }];
    return { status, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, calls };
}

test('the driver refuses to start without the gateway, learner and operator credentials', () => {
  assert.throws(() => createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER }), TypeError);
  assert.deepEqual(STEPS.map((step) => step.id), ['package', 'register', 'train', 'examine', 'certify', 'verify', 'status', 'monitor']);
});

test('a training run reports whether Training delivered a targeted remediation session', async () => {
  const { fetchImpl } = fakeFetch({
    '/v1/auth/tokens': [200, { accessToken: 'token', expiresIn: 900 }],
    '/v1/training-runs': [200, { outcome: 'completed', sessionId: 'session-1',
      completedItems: [{ moduleId: 'm4' }, { moduleId: 'm4' }] }],
    '/v1/admin/training-sessions/session-1': [200, { session: { kind: 'remediation', remediation: { objectiveIds: ['o4'] } } }],
  });
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  assert.deepEqual(await driver.train(), { sessionId: 'session-1', kind: 'remediation', remediationObjectiveIds: ['o4'],
    itemsDelivered: 2, modules: ['m4'], modelWeightsModified: false });
});

test('a refused examination stops the run at that step with the owning service reason', async () => {
  const { fetchImpl } = fakeFetch({
    '/v1/exam-runs': [200, { outcome: 'not_started', reason: 'remediation_required' }],
  });
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  await assert.rejects(driver.examine('safe-escalation'), (error) =>
    error.code === 'examination_failed' && error.detail.reason === 'remediation_required');
});

test('the live-model scenario asks the learner for its live model and reports the model usage', async () => {
  const bodies = {};
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.body) bodies[path] = JSON.parse(init.body);
    const routes = {
      '/v1/auth/tokens': [200, { accessToken: 'token', expiresIn: 900 }],
      '/v1/runs': [200, { outcome: 'accepted', evidence: { label: 'LIVE: Live Agent Learner' },
        registration: { agentLearnerKey: 'agent' }, live: { provider: 'opencode-go', model: 'glm-5.3-flash' } }],
      '/v1/training-runs': [200, { outcome: 'completed', sessionId: 'session-1', completedItems: [{ moduleId: 'm1' }],
        live: { model: 'glm-5.3-flash', calls: 1, promptTokens: 30, completionTokens: 70 } }],
      '/v1/admin/training-sessions/session-1': [200, { session: { kind: 'standard' } }],
    };
    const [status, body] = routes[path] || [404, { error: 'not_found' }];
    return { status, text: async () => JSON.stringify(body) };
  };
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });

  const registered = await driver.register('live-model');
  const trained = await driver.train('live-model');

  assert.equal(bodies['/v1/runs'].learner, 'live');
  assert.equal(bodies['/v1/training-runs'].learner, 'live');
  assert.equal(registered.model, 'glm-5.3-flash');
  assert.deepEqual(trained.live, { calls: 1, promptTokens: 30, completionTokens: 70, model: 'glm-5.3-flash' });
});

test('synthetic scenarios never ask for the live model', async () => {
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.body) bodies.push(JSON.parse(init.body));
    return { status: 200, text: async () => JSON.stringify({ outcome: 'accepted', registration: { agentLearnerKey: 'agent' } }) };
  };
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  await driver.register('safe-escalation');
  assert.equal(bodies.some((body) => 'learner' in body), false);
});

// Answers each verify call from a queue, and records every status change.
function statusFetch(verdicts) {
  const changes = [];
  const fetchImpl = async (url, init = {}) => {
    const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    if (url.endsWith('/v1/auth/tokens')) return reply(200, { accessToken: 'token', expiresIn: 900 });
    if (url.endsWith('/v1/credentials/verify')) {
      const [status, overall] = verdicts.shift();
      return reply(status, overall ? { overall, reasonCodes: [] } : { error: 'forbidden' });
    }
    const action = url.split('/').pop();
    changes.push(action);
    return reply(200, { history: [{ status: action }] });
  };
  return { fetchImpl, changes };
}
const credential = { credentialId: 'c-1', compactJws: 'jws' };

test('the status step passes only when suspension and reinstatement both change the verdict', async () => {
  const { fetchImpl, changes } = statusFetch([[200, 'INVALID'], [200, 'VALID']]);
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  const result = await driver.statusCycle(credential, 'agent');
  assert.equal(result.whileSuspended.overall, 'INVALID');
  assert.equal(result.afterReinstate.overall, 'VALID');
  assert.deepEqual(changes, ['suspend', 'reinstate']);
});

test('a suspension that does not change the verdict fails the step and still reinstates', async () => {
  const { fetchImpl, changes } = statusFetch([[200, 'VALID']]);
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  await assert.rejects(driver.statusCycle(credential, 'agent'), { code: 'suspension_not_enforced' });
  assert.deepEqual(changes, ['suspend', 'reinstate']);
});

test('a refused verification fails at once instead of polling', async () => {
  const { fetchImpl } = statusFetch([[403, null], [200, 'VALID']]);
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl });
  await assert.rejects(driver.verify('jws'), (error) => error.code === 'verification_refused' && error.detail.status === 403);
});

test('a failure that is not a lifecycle error is reported by its kind, not its message', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.7:4020'); };
  const steps = [];
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, fetchImpl,
    validationUrl: 'http://validation', curriculumInternalKey: 'key' });
  const report = await driver.run({ onStep: (step) => steps.push(step) });
  assert.equal(report.error, 'step_failed');
  const failed = steps.find((step) => step.status === 'failed');
  assert.deepEqual([failed.error, failed.detail], ['step_failed', { kind: 'TypeError' }]);
  assert.equal(JSON.stringify(report).includes('ECONNREFUSED'), false);
});

// Assurance audit C3, strict mode (no auto-approval): the demo activates only what two people approved.
test('the package step never posts a review, and stops with the review state until two people have approved', async () => {
  const candidate = { manifest: { packageId: 'pkg-x', version: '1.0.0', domainId: 'customer-refunds', domain: 'Refunds' }, modules: [] };
  const make = (activation) => {
    const { fetchImpl, calls } = fakeFetch({
      '/v1/auth/tokens': [200, { accessToken: 'token', expiresIn: 3600 }],
      '/packages/active?domain=customer-refunds': [404, { error: 'no_active_package' }],
      '/v1/admin/curriculum/packages/pkg-x/1.0.0': [200, { state: 'AwaitingReview', digest: 'd', openDisagreements: [],
        reviews: [{ reviewer_id: 'person-a', score: 4.2, approved: true }] }],
      '/v1/admin/curriculum/activate': activation,
    });
    return { calls, driver: createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, validationUrl: 'http://validation',
      curriculumInternalKey: 'key', admin, candidate, fetchImpl }) };
  };
  const waiting = make([403, { error: 'insufficient_approvals' }]);
  await assert.rejects(waiting.driver.ensurePackage(), (error) => error.code === 'package_awaiting_review' &&
    error.detail.reason === 'insufficient_approvals' && error.detail.reviews.length === 1);
  const approved = make([200, { activated: true }]);
  assert.equal((await approved.driver.ensurePackage()).packageId, 'pkg-x');
  for (const { calls } of [waiting, approved]) assert.equal(calls.some((call) => call.url.includes('/review')), false, 'no review is ever posted');
  const disputed = make([409, { error: 'unresolved_review_disagreement' }]);
  await assert.rejects(disputed.driver.ensurePackage(), (error) => error.code === 'package_awaiting_review' &&
    error.detail.reason === 'unresolved_review_disagreement');
  // Any other refusal is not a review state: saying "awaiting review" would send the operator to the wrong place.
  for (const [status, body] of [[409, { error: 'validation_evidence_required' }], [502, { error: 'upstream_unavailable' }]]) {
    await assert.rejects(make([status, body]).driver.ensurePackage(), (error) => error.code === 'activation_failed' &&
      error.detail.status === status && error.detail.reason === body.error);
  }
});

// Innovation-fair mode: a package nobody has reviewed is approved by the demo reviewer accounts, labelled as such.
test('with auto-approval, an unreviewed package is approved by the demo accounts and a reviewed one is left to people', async () => {
  const candidate = { manifest: { packageId: 'pkg-x', version: '1.0.0', domainId: 'customer-refunds', domain: 'Refunds' },
    rubric: { criteria: [{ id: 'accuracy' }, { id: 'safety' }] },
    modules: [{ claims: [{ sourceId: 's-2' }, { sourceId: 's-1' }] }, { claims: [{ sourceId: 's-1' }] }] };
  const reviewers = [{ clientId: 'rev-a', clientSecret: 'a' }, { clientId: 'rev-b', clientSecret: 'b' }];
  const make = ({ existingReviews, reviewReply = [200, { ok: true }], autoApprove = { reviewers } }) => {
    const posted = [];
    let approvals = 0;
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      const reply = (status, data) => ({ status, text: async () => JSON.stringify(data) });
      if (url.endsWith('/v1/auth/tokens')) return reply(200, { accessToken: `token-${body.clientId}`, expiresIn: 3600 });
      if (url.includes('/packages/active')) return reply(404, { error: 'no_active_package' });
      if (url.endsWith('/v1/curriculum/review')) {
        posted.push({ token: init.headers.authorization, body });
        if (reviewReply[0] === 200) approvals += 1;
        return reply(...reviewReply);
      }
      if (url.endsWith('/v1/admin/curriculum/activate')) {
        return approvals >= 2 || existingReviews.length >= 2 ? reply(200, { activated: true }) : reply(403, { error: 'insufficient_approvals' });
      }
      if (url.endsWith('/packages/pkg-x/1.0.0')) {
        const demo = posted.map((entry, index) => ({ reviewer_id: reviewers[index].clientId, score: 4, approved: true }));
        return reply(200, { state: 'AwaitingReview', digest: 'd', openDisagreements: [], reviews: [...existingReviews, ...demo] });
      }
      return reply(404, { error: 'not_found' });
    };
    return { posted, driver: createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, validationUrl: 'http://validation',
      curriculumInternalKey: 'key', admin, candidate, autoApprove, fetchImpl }) };
  };

  const fresh = make({ existingReviews: [] });
  const result = await fresh.driver.ensurePackage();
  assert.equal(result.autoApproved, true);
  assert.equal(result.approval, 'automatic demo approval, not a human review');
  assert.deepEqual(result.reviews.map((review) => review.reviewer), ['rev-a', 'rev-b']);
  assert.deepEqual(fresh.posted.map((entry) => entry.token), ['Bearer token-rev-a', 'Bearer token-rev-b']);
  for (const { body } of fresh.posted) {
    assert.equal(body.comment, DEMO_APPROVAL_COMMENT);
    assert.match(body.comment, /not a human review/);
    assert.deepEqual(body.criterionScores, { accuracy: 4, safety: 4 });
    assert.deepEqual(Object.keys(body.sourceChecks), ['s-1', 's-2']);
  }

  // A person already reviewed it: the demo accounts never approve over them.
  const reviewed = make({ existingReviews: [{ reviewer_id: 'person-a', score: 2, approved: false }] });
  await assert.rejects(reviewed.driver.ensurePackage(), (error) => error.code === 'package_awaiting_review');
  assert.equal(reviewed.posted.length, 0);

  // Auto-approval off: the strict rule, no review posted.
  const strict = make({ existingReviews: [], autoApprove: null });
  await assert.rejects(strict.driver.ensurePackage(), (error) => error.code === 'package_awaiting_review');
  assert.equal(strict.posted.length, 0);

  // A refused demo review stops the run with the service's reason instead of claiming approval.
  const refused = make({ existingReviews: [], reviewReply: [403, { error: 'forbidden' }] });
  await assert.rejects(refused.driver.ensurePackage(), (error) => error.code === 'auto_approval_failed' && error.detail.reason === 'forbidden');
});

test('auto-approval is on only with DEMO_AUTO_APPROVE=1 and both demo reviewer accounts', () => {
  const accounts = { REVIEWER_1_CLIENT_ID: 'a', REVIEWER_1_CLIENT_SECRET: 'x', REVIEWER_2_CLIENT_ID: 'b', REVIEWER_2_CLIENT_SECRET: 'y' };
  assert.deepEqual(demoAutoApproveFromEnv({ DEMO_AUTO_APPROVE: '1', ...accounts }).reviewers.map((reviewer) => reviewer.clientId), ['a', 'b']);
  assert.equal(demoAutoApproveFromEnv({ DEMO_AUTO_APPROVE: '0', ...accounts }), null);
  assert.equal(demoAutoApproveFromEnv({ ...accounts }), null);
  assert.equal(demoAutoApproveFromEnv({ DEMO_AUTO_APPROVE: '1', ...accounts, REVIEWER_2_CLIENT_SECRET: '' }), null);
  assert.equal(demoApprovalReview({ manifest: { packageId: 'p', version: '1' } }).approved, true);
});

test('a reused package whose review record cannot be read stops the run instead of reporting no reviews', async () => {
  const active = { packageId: 'pkg-x', version: '1.0.0', digest: 'd', manifest: { domain: 'Refunds' }, modules: [] };
  const make = (details) => fakeFetch({
    '/v1/auth/tokens': [200, { accessToken: 'token', expiresIn: 3600 }],
    '/packages/active?domain=customer-refunds': [200, active],
    '/v1/admin/curriculum/packages/pkg-x/1.0.0': details,
  }).fetchImpl;
  const driver = (fetchImpl) => createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, validationUrl: 'http://validation',
    curriculumInternalKey: 'key', admin, candidate: { manifest: { domainId: 'customer-refunds' } }, fetchImpl });
  await assert.rejects(driver(make([503, { error: 'unavailable' }])).ensurePackage(), (error) => error.code === 'package_details_unavailable' &&
    error.detail.status === 503);
  const reused = await driver(make([200, { reviews: [{ reviewer_id: 'person-a', score: 4, approved: true }] }])).ensurePackage();
  assert.deepEqual(reused.reviews, [{ reviewer: 'person-a', score: 4, approved: true }]);
});

test('training and the examination run in the domain of the candidate package', async () => {
  const bodies = {};
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.body) bodies[path] = JSON.parse(init.body);
    const routes = {
      '/v1/auth/tokens': [200, { accessToken: 'token', expiresIn: 900 }],
      '/v1/training-runs': [200, { outcome: 'completed', sessionId: 'session-1', completedItems: [] }],
      '/v1/admin/training-sessions/session-1': [200, { session: { kind: 'standard' } }],
      '/v1/exam-runs': [200, { outcome: 'not_started', reason: 'remediation_required' }],
    };
    const [status, body] = routes[path] || [404, { error: 'not_found' }];
    return { status, text: async () => JSON.stringify(body) };
  };
  const candidate = { manifest: { packageId: 'personal-data-handling', version: '1.0.0', domainId: 'personal-data', domain: 'Personal Data Handling' }, modules: [] };
  const driver = createLifecycleDriver({ gatewayUrl: GATEWAY, syntheticUrl: LEARNER, admin, candidate, fetchImpl });
  await driver.train();
  await assert.rejects(driver.examine());
  assert.equal(bodies['/v1/training-runs'].domainId, 'personal-data');
  assert.equal(bodies['/v1/exam-runs'].domainId, 'personal-data');
});
