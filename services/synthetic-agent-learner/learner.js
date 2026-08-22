const { randomUUID } = require('node:crypto');

const {
  createLifecycleMessage,
  createRegistrationMessage,
  protocolResponseMetadata,
} = require('../external-agent-protocol');
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

    return {
      ...registrationResult,
      outcome: profile.outcome,
      status: profile.outcome,
      reason: profile.reason,
      safeState: profile.outcome === 'completed' ? 'accepted' : 'blocked',
      lifecycle: lifecycleSummary(lifecycleMessage, lifecycleResponse),
    };
  }

  return { run };
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
  };
}

function publicResult({
  profileId,
  correlationId,
  outcome = 'pending',
  reason = null,
  safeState = 'blocked',
  evidence = { mode: 'synthetic', environment: 'simulation', label: 'SIMULATION: Synthetic Agent Learner' },
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
