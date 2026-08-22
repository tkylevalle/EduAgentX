const assert = require('node:assert/strict');
const test = require('node:test');

const { createSyntheticAgentLearner, listSyntheticProfiles } = require('../learner');

const registration = {
  agentLearnerKey: 'synthetic-agent-learner-dev',
  model: { provider: 'synthetic', version: '1.0.0' },
  systemPromptHash: 'sha256:synthetic-prompt-v1',
  approvedToolManifest: [{ name: 'knowledge.lookup', version: '1.0.0', permissions: ['read'] }],
  policyConfigurationHash: 'sha256:synthetic-policy-v1',
  adapterVersion: 'synthetic-agent-learner-1.0.0',
};

test('synthetic profiles are deterministic and expose the required safe scenarios', () => {
  assert.deepEqual(listSyntheticProfiles(), [
    'adversarial',
    'competent',
    'inconsistent',
    'malformed',
    'remediable',
    'timing-out',
    'unavailable',
    'underqualified',
  ]);
});

test('a competent synthetic learner registers and sends lifecycle interaction through the gateway client', async () => {
  const calls = [];
  const learner = createSyntheticAgentLearner({
    gatewayClient: {
      register: async (message) => {
        calls.push({ kind: 'register', message });
        return { status: 201, body: { registration: { agentLearnerId: 'learner-1' }, protocol: metadata(message) } };
      },
      interact: async (message) => {
        calls.push({ kind: 'interact', message });
        return {
          status: 202,
          body: { status: 'accepted', safeState: 'awaiting_lifecycle_owner', protocol: metadata(message) },
        };
      },
    },
  });

  const result = await learner.run({ profileId: 'competent', registration, correlationId: 'run-competent' });

  assert.equal(result.outcome, 'accepted');
  assert.equal(result.safeState, 'awaiting_lifecycle_owner');
  assert.equal(result.evidence.mode, 'synthetic');
  assert.equal(result.evidence.environment, 'simulation');
  assert.equal(result.credentialIssued, false);
  assert.deepEqual(calls.map((call) => call.kind), ['register', 'interact']);
  assert.equal(calls[0].message.correlationId, 'run-competent');
  assert.equal(calls[1].message.payload.data.agentLearnerKey, registration.agentLearnerKey);
});

test('malformed and inconsistent synthetic responses fail closed without credential issuance', async () => {
  for (const profileId of ['malformed', 'inconsistent']) {
    const calls = [];
    const learner = createSyntheticAgentLearner({
      gatewayClient: {
        register: async (message) => ({
          status: 201,
          body: { registration: { agentLearnerId: 'learner-1' }, protocol: metadata(message) },
        }),
        interact: async (message) => {
          calls.push(message);
         return {
           status: 202,
           body: { status: 'accepted', safeState: 'awaiting_lifecycle_owner', protocol: metadata(message) },
         };
        },
      },
    });

    const result = await learner.run({ profileId, registration, correlationId: `run-${profileId}` });

    assert.equal(result.outcome, 'agent_failed');
    assert.equal(result.reason, `${profileId}_response`);
    assert.equal(result.safeState, 'blocked');
    assert.equal(result.credentialIssued, false);
    assert.equal(calls.length, 1);
  }
});

test('timing-out and unavailable profiles return distinct safe outcomes after registration', async () => {
  for (const [profileId, expected] of [
    ['timing-out', { outcome: 'agent_failed', reason: 'agent_timeout' }],
    ['unavailable', { outcome: 'system_aborted', reason: 'learner_unavailable' }],
  ]) {
    let registrationCalls = 0;
    let interactionCalls = 0;
    const learner = createSyntheticAgentLearner({
      gatewayClient: {
        register: async (message) => {
          registrationCalls += 1;
          return { status: 201, body: { registration: { agentLearnerId: 'learner-1' }, protocol: metadata(message) } };
        },
        interact: async () => {
          interactionCalls += 1;
          return { status: 202, body: {} };
        },
      },
    });

    const result = await learner.run({ profileId, registration, correlationId: `run-${profileId}` });

    assert.equal(result.outcome, expected.outcome);
    assert.equal(result.reason, expected.reason);
    assert.equal(result.credentialIssued, false);
    assert.equal(registrationCalls, 1);
    assert.equal(interactionCalls, 0);
  }
});

test('gateway or registration unavailability becomes a system-aborted public result', async () => {
  const learner = createSyntheticAgentLearner({
    gatewayClient: {
      register: async () => ({ status: 502, body: { error: 'upstream_unavailable' } }),
      interact: async () => ({ status: 202, body: {} }),
    },
  });

  const result = await learner.run({ profileId: 'competent', registration, correlationId: 'run-gateway-down' });

  assert.equal(result.outcome, 'system_aborted');
  assert.equal(result.reason, 'upstream_unavailable');
  assert.equal(result.safeState, 'blocked');
  assert.equal(result.credentialIssued, false);
});

function metadata(message) {
  return {
    protocol: message.protocol,
    protocolVersion: message.protocolVersion,
    messageType: message.messageType,
    messageId: message.messageId,
    correlationId: message.correlationId,
    evidence: message.evidence,
  };
}
