'use strict';

// The driver only asks owning services and records what they answered.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycleDriver, STEPS } = require('..');

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
