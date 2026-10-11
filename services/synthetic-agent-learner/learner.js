const { randomUUID } = require('node:crypto');

const {
  createLifecycleMessage,
  createRegistrationMessage,
  canonicalEvidence,
  protocolResponseMetadata,
} = require('../../packages/external-agent-protocol');
const { getSyntheticProfile, listSyntheticProfiles } = require('./profiles');

const DEFAULT_REGISTRATION = Object.freeze({
  model: { provider: 'synthetic', version: '1.0.0' },
  systemPromptHash: 'sha256:synthetic-prompt-v1',
  approvedToolManifest: [{ name: 'knowledge.lookup', version: '1.0.0', permissions: ['read'] }],
  policyConfigurationHash: 'sha256:synthetic-policy-v1',
  adapterVersion: 'synthetic-agent-learner-1.0.0',
});

function createSyntheticAgentLearner({ gatewayClient, idGenerator = randomUUID } = {}) {
  if (!gatewayClient || typeof gatewayClient.register !== 'function' || typeof gatewayClient.interact !== 'function') {
    throw new TypeError('A gateway client with register and interact methods is required');
  }

  async function run({
    profileId = 'competent',
    registration = {},
    correlationId = `synthetic-run-${idGenerator()}`,
    timeoutMs = 5000,
  } = {}) {
    const profile = getSyntheticProfile(profileId);
    if (!profile) {
      return publicResult({
        profileId,
        correlationId,
        outcome: 'rejected',
        reason: 'unsupported_synthetic_profile',
        safeState: 'blocked',
      });
    }

    let registrationMessage;
    try {
      registrationMessage = createRegistrationMessage({
        messageId: `synthetic-registration-${idGenerator()}`,
        correlationId,
        idempotencyKey: `synthetic-registration-${correlationId}`,
        timeoutMs,
        evidence: { mode: 'synthetic' },
        payload: { ...DEFAULT_REGISTRATION, ...registration },
      });
    } catch (error) {
      return publicResult({
        profileId,
        correlationId,
        outcome: 'rejected',
        reason: error.code || 'invalid_registration',
        safeState: 'blocked',
      });
    }

    let registrationResponse;
    try {
      registrationResponse = await gatewayClient.register(registrationMessage);
    } catch (error) {
      return publicResult({
        profileId,
        correlationId,
        outcome: 'system_aborted',
        reason: 'upstream_unavailable',
        safeState: 'blocked',
        evidence: registrationMessage.evidence,
      });
    }

    const registrationResult = publicResult({
      profileId,
      correlationId,
      evidence: registrationMessage.evidence,
      protocol: registrationResponse.body?.protocol || protocolResponseMetadata(registrationMessage),
      registration: registrationResponse.body?.registration || null,
    });

    if (!isSuccess(registrationResponse)) {
      const operationalFailure = registrationResponse.status >= 500 || registrationResponse.status === 429;
      return {
        ...registrationResult,
        outcome: operationalFailure ? 'system_aborted' : 'rejected',
        status: operationalFailure ? 'system_aborted' : 'rejected',
        reason: registrationResponse.body?.error || (operationalFailure ? 'upstream_unavailable' : 'registration_rejected'),
        safeState: 'blocked',
      };
    }

    if (['agent_timeout', 'learner_unavailable'].includes(profile.reason)) {
      return {
        ...registrationResult,
        outcome: profile.outcome,
        status: profile.outcome,
        reason: profile.reason,
        safeState: 'blocked',
      };
    }

    const lifecycleMessage = createProfileLifecycleMessage({
      profile,
      agentLearnerKey: registrationMessage.payload.agentLearnerKey,
      correlationId,
      timeoutMs,
      idGenerator,
      evidence: registrationMessage.evidence,
    });

    let lifecycleResponse;
    try {
      lifecycleResponse = await gatewayClient.interact(lifecycleMessage);
    } catch (error) {
      return {
        ...registrationResult,
        outcome: 'system_aborted',
        status: 'system_aborted',
        reason: 'lifecycle_unavailable',
        safeState: 'blocked',
      };
    }

    if (!isSuccess(lifecycleResponse)) {
      const operationalFailure = lifecycleResponse.status >= 500 || lifecycleResponse.status === 429;
      return {
        ...registrationResult,
        outcome: operationalFailure ? 'system_aborted' : 'agent_failed',
        status: operationalFailure ? 'system_aborted' : 'agent_failed',
        reason: operationalFailure
          ? lifecycleResponse.body?.error || 'lifecycle_unavailable'
          : profile.reason || 'malformed_response',
        safeState: 'blocked',
      };
    }

    if (profile.id === 'inconsistent') {
      return {
        ...registrationResult,
        outcome: 'agent_failed',
        status: 'agent_failed',
        reason: 'inconsistent_response',
        safeState: 'blocked',
        lifecycle: lifecycleSummary(lifecycleMessage, lifecycleResponse),
      };
    }

    const lifecycleOutcome = profile.id === 'competent'
      ? {
        outcome: 'accepted',
        status: 'accepted',
        reason: null,
        safeState: lifecycleResponse.body?.safeState || 'awaiting_lifecycle_owner',
      }
      : {
        outcome: profile.outcome,
        status: profile.outcome,
        reason: profile.reason,
        safeState: 'blocked',
      };

    return {
      ...registrationResult,
      ...lifecycleOutcome,
      lifecycle: lifecycleSummary(lifecycleMessage, lifecycleResponse),
    };
  }

  // Sprint 2 path: a synthetic learner exercises the actual Gateway session
  // contract. Bounded runs make interruption/resumption reproducible.
  async function train({ agentLearnerKey, profileId = 'competent', resumeSessionId,
    maxItems = 20, correlationId = `synthetic-training-${idGenerator()}`, timeoutMs = 5000 } = {}) {
    const profile = getSyntheticProfile(profileId);
    if (!profile || !agentLearnerKey || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20)
      return { outcome: 'rejected', reason: 'invalid_training_request', credentialIssued: false };
    const evidence = canonicalEvidence('synthetic');
    const registrationMessage = createRegistrationMessage({
      messageId: `synthetic-registration-${idGenerator()}`, correlationId,
      idempotencyKey: `synthetic-registration-${correlationId}`, timeoutMs, evidence,
      payload: { ...DEFAULT_REGISTRATION, agentLearnerKey },
    });
    try {
      const registrationResponse = await gatewayClient.register(registrationMessage);
      if (!isSuccess(registrationResponse)) return { outcome: 'system_aborted', reason: registrationResponse.body?.error || 'registration_unavailable', credentialIssued: false };
      const interact = async (interactionType, data) => gatewayClient.interact(createLifecycleMessage({
        messageId: `synthetic-training-${idGenerator()}`, correlationId,
        idempotencyKey: `synthetic-training-${idGenerator()}`, timeoutMs, evidence,
        payload: { interactionType, data: { agentLearnerKey, response: 'acknowledge', ...data } },
      }));
      const started = await interact('training.session.start', {});
      if (!isSuccess(started) || !started.body?.sessionId)
        return { outcome: 'system_aborted', reason: started.body?.error || 'training_start_failed', credentialIssued: false };
      const sessionId = started.body.sessionId;
      if (resumeSessionId && resumeSessionId !== sessionId)
        return { outcome: 'rejected', reason: 'session_identity_changed', sessionId, credentialIssued: false };
      const completedItems = [];
      for (let index = 0; index < maxItems; index += 1) {
        const delivery = await interact('training.session.continue', { sessionId });
        if (!isSuccess(delivery)) return { outcome: 'system_aborted', reason: delivery.body?.error || 'training_continue_failed', sessionId, completedItems, credentialIssued: false };
        if (delivery.body.status === 'completed') return { outcome: 'completed', sessionId, completedItems, credentialIssued: false };
        const item = delivery.body.item;
        if (!item?.deliveryItemId || delivery.body.bounds?.modelWeightsModified !== false)
          return { outcome: 'rejected', reason: 'unsafe_training_contract', sessionId, completedItems, credentialIssued: false };
        const submitted = await interact('training.session.submit', {
          sessionId, deliveryItemId: item.deliveryItemId, response: profile.response || 'deterministic synthetic practice',
        });
        if (!isSuccess(submitted) || submitted.body.modelWeightsModified !== false)
          return { outcome: 'system_aborted', reason: submitted.body?.error || 'training_submit_failed', sessionId, completedItems, credentialIssued: false };
        completedItems.push({ moduleId: item.moduleId, deliveryItemId: item.deliveryItemId, kind: item.kind });
        if (submitted.body.status === 'completed') return { outcome: 'completed', sessionId, completedItems, credentialIssued: false };
      }
      return { outcome: 'open', sessionId, completedItems, credentialIssued: false };
    } catch {
      return { outcome: 'system_aborted', reason: 'gateway_unavailable', credentialIssued: false };
    }
  }

  return { run, train };
}

function createProfileLifecycleMessage({
  profile,
  agentLearnerKey,
  correlationId,
  timeoutMs,
  idGenerator,
  evidence,
}) {
  const message = createLifecycleMessage({
    messageId: `synthetic-lifecycle-${idGenerator()}`,
    correlationId,
    idempotencyKey: `synthetic-lifecycle-${correlationId}`,
    timeoutMs,
    evidence,
    payload: {
      interactionType: 'training.submit',
      data: {
        agentLearnerKey,
        profileId: profile.id,
        response: profile.response,
        expectedOutcome: profile.outcome,
      },
    },
  });

  if (profile.id === 'malformed') {
    message.payload.data = 'malformed synthetic response';
  }
  if (profile.id === 'inconsistent') {
    message.payload.data.responseCorrelationId = `${correlationId}-different`;
  }
  return message;
}

function lifecycleSummary(message, response) {
  return {
    interactionType: message.payload.interactionType,
    messageId: message.messageId,
    status: response.body?.status || 'accepted',
    safeState: response.body?.safeState || 'awaiting_lifecycle_owner',
  };
}

function publicResult({
  profileId,
  correlationId,
  outcome = 'pending',
  reason = null,
  safeState = 'blocked',
  evidence = canonicalEvidence('synthetic'),
  protocol = null,
  registration = null,
} = {}) {
  return {
    apiVersion: 'v1',
    profileId,
    outcome,
    status: outcome,
    reason,
    safeState,
    evidence,
    protocol,
    registration,
    credentialIssued: false,
    correlationId,
  };
}

function isSuccess(response) {
  return Boolean(response && response.status >= 200 && response.status < 300);
}

module.exports = {
  DEFAULT_REGISTRATION,
  createSyntheticAgentLearner,
  createProfileLifecycleMessage,
  listSyntheticProfiles,
};
