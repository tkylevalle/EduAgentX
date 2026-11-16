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

test('Sprint 2 driver uses session start/continue/submit and resumes without duplicate item completion', async () => {
  const interactions = [];
  const items = [
    { moduleId: 'm1', deliveryItemId: 'm1-lesson', kind: 'lesson' },
    { moduleId: 'm1', deliveryItemId: 'm1-practice', kind: 'practice' },
  ];
  let completed = 0;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async (message) => {
      const { interactionType, data } = message.payload;
      interactions.push(interactionType);
      if (interactionType === 'training.session.start') return { status: 200, body: { sessionId: 'session-1' } };
      if (interactionType === 'training.session.continue') return { status: 200, body: {
        sessionId: 'session-1', status: completed === items.length ? 'completed' : 'open',
        item: items[completed] || null, bounds: { modelWeightsModified: false },
      } };
      assert.equal(data.deliveryItemId, items[completed].deliveryItemId);
      completed += 1;
      return { status: 200, body: { sessionId: 'session-1', status: completed === items.length ? 'completed' : 'open', modelWeightsModified: false } };
    },
  } });
  const first = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev', maxItems: 1 });
  assert.equal(first.outcome, 'open');
  const resumed = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev', resumeSessionId: first.sessionId });
  assert.equal(resumed.outcome, 'completed');
  assert.equal(completed, 2);
  assert.deepEqual(interactions, ['training.session.start', 'training.session.continue', 'training.session.submit',
    'training.session.start', 'training.session.continue', 'training.session.submit']);
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

test('a live learner registers its own configuration and submits the model answer for each training item', async () => {
  const registrations = [];
  const submitted = [];
  const item = { moduleId: 'm1', deliveryItemId: 'm1-practice', kind: 'practice' };
  let done = false;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async (message) => { registrations.push(message); return { status: 200, body: {} }; },
    interact: async (message) => {
      const { interactionType, data } = message.payload;
      assert.equal(message.evidence.mode, 'live');
      if (interactionType === 'training.session.start') return { status: 200, body: { sessionId: 'session-1' } };
      if (interactionType === 'training.session.continue') return { status: 200, body: {
        sessionId: 'session-1', status: done ? 'completed' : 'open', item: done ? null : item, bounds: { modelWeightsModified: false } } };
      submitted.push(data.response);
      done = true;
      return { status: 200, body: { sessionId: 'session-1', status: 'completed', modelWeightsModified: false } };
    },
  } });
  const result = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev', evidenceMode: 'live',
    registration: { model: { provider: 'opencode-go', version: 'glm-5.3-flash' } },
    respond: async (delivered) => `Model practice answer for ${delivered.deliveryItemId}`,
  });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(submitted, ['Model practice answer for m1-practice']);
  assert.deepEqual(registrations[0].payload.model, { provider: 'opencode-go', version: 'glm-5.3-flash' });
  assert.equal(registrations[0].evidence.label, 'LIVE: Live Agent Learner');
});

test('a remediation session\'s reason reaches the learner with every item', async () => {
  const remediation = { requestId: 'req-1', objectiveIds: ['o3'], cause: { type: 'examination_failure', summary: 'critical rules: critical-o3.' } };
  const seen = [];
  let done = false;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async (message) => {
      const { interactionType } = message.payload;
      if (interactionType === 'training.session.start') return { status: 200, body: { sessionId: 'session-r', remediation } };
      if (interactionType === 'training.session.continue') return { status: 200, body: { sessionId: 'session-r', status: done ? 'completed' : 'open',
        item: done ? null : { deliveryItemId: 'm3-lesson', moduleId: 'm3', objectiveIds: ['o3'] }, bounds: { modelWeightsModified: false } } };
      done = true;
      return { status: 200, body: { sessionId: 'session-r', status: 'completed', modelWeightsModified: false } };
    },
  } });
  await learner.train({ agentLearnerKey: 'live-agent-learner-dev', evidenceMode: 'live', registration: {},
    respond: async (item, context) => { seen.push(context); return 'answer'; } });
  assert.deepEqual(seen, [{ remediation, package: null, domainId: null }]);
});

test('onAccepted runs only for an answer Training accepted', async () => {
  const accepted = [];
  for (const submitStatus of [200, 409]) {
    const learner = createSyntheticAgentLearner({ gatewayClient: {
      register: async () => ({ status: 200, body: {} }),
      interact: async (message) => {
        const { interactionType } = message.payload;
        if (interactionType === 'training.session.start') return { status: 200, body: { sessionId: 's', package: { id: 'p', version: '1' } } };
        if (interactionType === 'training.session.continue') return { status: 200, body: { sessionId: 's', status: 'open',
          item: { deliveryItemId: 'm1-lesson', moduleId: 'm1', objectiveIds: ['o1'] }, bounds: { modelWeightsModified: false } } };
        return submitStatus === 200 ? { status: 200, body: { sessionId: 's', status: 'completed', modelWeightsModified: false } }
          : { status: 409, body: { error: 'response_too_long' } };
      },
    } });
    await learner.train({ agentLearnerKey: 'live-agent-learner-dev', evidenceMode: 'live', registration: {}, maxItems: 1,
      respond: async () => `answer ${submitStatus}`, onAccepted: (item, answer, context) => accepted.push([answer, context.package.version]) });
  }
  assert.deepEqual(accepted, [['answer 200', '1']]);
});

test('a live learner that cannot reach its model stops training as a system abort', async () => {
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async (message) => {
      const { interactionType } = message.payload;
      if (interactionType === 'training.session.start') return { status: 200, body: { sessionId: 'session-1' } };
      if (interactionType === 'training.session.continue') return { status: 200, body: { sessionId: 'session-1', status: 'open',
        item: { moduleId: 'm1', deliveryItemId: 'm1-lesson', kind: 'lesson' }, bounds: { modelWeightsModified: false } } };
      throw new Error('submit must not be called');
    },
  } });
  const result = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev', evidenceMode: 'live',
    respond: async () => { const error = new Error('down'); error.code = 'live_model_timeout'; throw error; } });
  assert.equal(result.outcome, 'system_aborted');
  assert.equal(result.reason, 'live_model_timeout');
});

test('a requested domain goes to Training on session start and reaches the learner with every item', async () => {
  const starts = [];
  const seen = [];
  let done = false;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async (message) => {
      const { interactionType, data } = message.payload;
      if (interactionType === 'training.session.start') { starts.push(data.domainId); return { status: 200, body: { sessionId: 's-d' } }; }
      if (interactionType === 'training.session.continue') return { status: 200, body: { sessionId: 's-d', status: done ? 'completed' : 'open',
        item: done ? null : { deliveryItemId: 'r1-lesson', moduleId: 'r1', objectiveIds: ['o1'] }, bounds: { modelWeightsModified: false } } };
      done = true;
      return { status: 200, body: { sessionId: 's-d', status: 'completed', modelWeightsModified: false } };
    },
  } });
  const result = await learner.train({ agentLearnerKey: 'live-agent-learner-dev', domainId: 'customer-refunds',
    respond: async (item, context) => { seen.push(context.domainId); return 'answer'; } });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(starts, ['customer-refunds']);
  assert.deepEqual(seen, ['customer-refunds']);
});

test('an unknown domain is refused before the learner registers or starts a session', async () => {
  let calls = 0;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => { calls += 1; return { status: 200, body: {} }; },
    interact: async () => { calls += 1; return { status: 200, body: {} }; },
  } });
  for (const domainId of ['refunds', '', 42, '__proto__']) {
    const result = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev', domainId });
    assert.deepEqual(result, { outcome: 'rejected', reason: 'invalid_domain', credentialIssued: false }, String(domainId));
  }
  assert.equal(calls, 0);
});

test('a start that ends an outdated session is followed by one more start, which opens the new session', async () => {
  const starts = [];
  let done = false;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async (message) => {
      const { interactionType } = message.payload;
      if (interactionType === 'training.session.start') {
        starts.push(starts.length);
        return starts.length === 1
          ? { status: 409, body: { error: 'training_blocked', reason: 'configuration_changed', sessionId: 'old' } }
          : { status: 201, body: { sessionId: 'new' } };
      }
      if (interactionType === 'training.session.continue') return { status: 200, body: { sessionId: 'new', status: done ? 'completed' : 'open',
        item: done ? null : { deliveryItemId: 'm1-lesson', moduleId: 'm1', objectiveIds: ['o1'] }, bounds: { modelWeightsModified: false } } };
      done = true;
      return { status: 200, body: { sessionId: 'new', status: 'completed', modelWeightsModified: false } };
    },
  } });
  const result = await learner.train({ agentLearnerKey: 'live-agent-learner-dev', respond: async () => 'answer' });
  assert.deepEqual([result.outcome, result.sessionId, starts.length], ['completed', 'new', 2]);
});

test('a second blocked start is reported, not retried again', async () => {
  let starts = 0;
  const learner = createSyntheticAgentLearner({ gatewayClient: {
    register: async () => ({ status: 200, body: {} }),
    interact: async () => { starts += 1; return { status: 409, body: { error: 'training_blocked', reason: 'package_state:Watch' } }; },
  } });
  const result = await learner.train({ agentLearnerKey: 'synthetic-agent-learner-dev' });
  assert.deepEqual([result.outcome, result.reason, starts], ['system_aborted', 'training_blocked', 2]);
});
