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
