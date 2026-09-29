const assert = require('node:assert/strict');

const {
  createLifecycleMessage,
  createRegistrationMessage,
  protocolResponseMetadata,
} = require('./');

const DEFAULT_REGISTRATION_PAYLOAD = Object.freeze({
  agentLearnerKey: 'conformance-agent',
  model: { provider: 'conformance-provider', version: '1.0.0' },
  systemPromptHash: 'sha256:conformance-prompt',
  approvedToolManifest: [],
  policyConfigurationHash: 'sha256:conformance-policy',
  adapterVersion: 'conformance-1.0.0',
});

function createConformanceMessages({
  agentLearnerKey = DEFAULT_REGISTRATION_PAYLOAD.agentLearnerKey,
  evidenceMode = 'synthetic',
  provider = DEFAULT_REGISTRATION_PAYLOAD.model.provider,
} = {}) {
  const registrationPayload = {
    ...DEFAULT_REGISTRATION_PAYLOAD,
    agentLearnerKey,
    model: { provider, version: DEFAULT_REGISTRATION_PAYLOAD.model.version },
  };
  return {
    registration: createRegistrationMessage({
      messageId: 'conformance-registration-message',
      correlationId: 'conformance-registration-correlation',
      idempotencyKey: 'conformance-registration-idempotency',
      timeoutMs: 2000,
      evidence: { mode: evidenceMode },
      payload: registrationPayload,
    }),
    lifecycle: createLifecycleMessage({
      messageId: 'conformance-lifecycle-message',
      correlationId: 'conformance-lifecycle-correlation',
      idempotencyKey: 'conformance-lifecycle-idempotency',
      timeoutMs: 2000,
      evidence: { mode: evidenceMode },
      payload: {
        interactionType: 'training.submit',
        data: { agentLearnerKey, response: 'conformance-response' },
      },
    }),
  };
}

async function runProtocolConformanceSuite({ send, agentLearnerKey, evidenceMode, provider } = {}) {
  if (typeof send !== 'function') throw new TypeError('A protocol send function is required');
  const messages = createConformanceMessages({ agentLearnerKey, evidenceMode, provider });
  const registration = await send(messages.registration);
  assert.ok(registration.status >= 200 && registration.status < 300, 'registration must be accepted');
  assertProtocolResponse(registration.body, messages.registration);

  const lifecycle = await send(messages.lifecycle);
  assert.ok(lifecycle.status >= 200 && lifecycle.status < 300, 'lifecycle interaction must be accepted');
  assertProtocolResponse(lifecycle.body, messages.lifecycle);

  const invalidVersion = await send({
    ...messages.registration,
    protocolVersion: '9.9.9',
    messageId: 'conformance-unsupported-version',
  });
  assert.equal(invalidVersion.status, 400);
  assert.equal(invalidVersion.body.error, 'unsupported_protocol_version');

  const invalidTimeout = await send({
    ...messages.lifecycle,
    timeoutMs: 0,
    messageId: 'conformance-invalid-timeout',
  });
  assert.equal(invalidTimeout.status, 400);
  assert.equal(invalidTimeout.body.error, 'invalid_timeout');

  return { messages, registration, lifecycle, invalidVersion, invalidTimeout };
}

function assertProtocolResponse(body, message) {
  const expected = protocolResponseMetadata(message);
  assert.ok(body.protocol && typeof body.protocol === 'object', 'response must include protocol metadata');
  assert.equal(body.protocol.protocol, expected.protocol);
  assert.equal(body.protocol.protocolVersion, expected.protocolVersion);
  assert.equal(body.protocol.messageId, expected.messageId);
  assert.equal(body.protocol.correlationId, expected.correlationId);
  assert.deepEqual(body.protocol.evidence, expected.evidence);
}

module.exports = {
  DEFAULT_REGISTRATION_PAYLOAD,
  assertProtocolResponse,
  createConformanceMessages,
  runProtocolConformanceSuite,
};
