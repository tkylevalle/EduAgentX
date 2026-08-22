const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EVIDENCE_MODES,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  createLifecycleMessage,
  createRegistrationMessage,
  protocolResponseMetadata,
  validateProtocolMessage,
} = require('../');

const registrationPayload = {
  agentLearnerKey: 'synthetic-agent-learner-dev',
  model: { provider: 'future-framework', version: '9.2.1' },
  systemPromptHash: 'sha256:system-prompt-v1',
  approvedToolManifest: [{ name: 'knowledge.lookup', version: '1.0.0', permissions: ['read'] }],
  policyConfigurationHash: 'sha256:policy-v1',
  adapterVersion: '1.0.0',
};

test('registration messages accept opaque provider metadata and normalize protocol evidence', () => {
  const message = createRegistrationMessage({
    messageId: 'registration-message-1',
    correlationId: 'registration-correlation-1',
    idempotencyKey: 'registration-idempotency-1',
    timeoutMs: 2500,
    evidence: { mode: 'synthetic' },
    payload: registrationPayload,
  });

  assert.deepEqual(message, {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: 'registration',
    messageId: 'registration-message-1',
    correlationId: 'registration-correlation-1',
    idempotencyKey: 'registration-idempotency-1',
    timeoutMs: 2500,
    evidence: {
      mode: 'synthetic',
      environment: 'simulation',
      label: 'SIMULATION: Synthetic Agent Learner',
    },
    payload: registrationPayload,
  });
  assert.equal(message.payload.model.provider, 'future-framework');
});

test('lifecycle messages use the same versioned envelope for every evidence mode', () => {
  for (const mode of EVIDENCE_MODES) {
    const message = createLifecycleMessage({
      messageId: `lifecycle-${mode}`,
      correlationId: `correlation-${mode}`,
      idempotencyKey: `idempotency-${mode}`,
      timeoutMs: 1000,
      evidence: { mode },
      payload: {
        interactionType: 'training.submit',
        data: { agentLearnerKey: 'mode-agent', moduleId: 'module-1', response: 'safe response' },
      },
    });

    assert.equal(message.protocol, PROTOCOL_NAME);
    assert.equal(message.protocolVersion, PROTOCOL_VERSION);
    assert.equal(message.messageType, 'lifecycle');
    assert.equal(message.evidence.mode, mode);
    assert.match(message.evidence.label, new RegExp(mode, 'i'));
  }
});

test('protocol validation rejects unsupported versions, unsafe evidence labels, and malformed lifecycle payloads', () => {
  assert.throws(
    () => validateProtocolMessage({
      ...createRegistrationMessage({
        messageId: 'message-1',
        correlationId: 'correlation-1',
        idempotencyKey: 'idempotency-1',
        timeoutMs: 1000,
        evidence: { mode: 'synthetic' },
        payload: registrationPayload,
      }),
      protocolVersion: '2.0.0',
    }),
    (error) => error instanceof ProtocolValidationError
      && error.code === 'unsupported_protocol_version'
  );

  assert.throws(
    () => createRegistrationMessage({
      messageId: 'message-2',
      correlationId: 'correlation-2',
      idempotencyKey: 'idempotency-2',
      timeoutMs: 1000,
      evidence: { mode: 'synthetic', environment: 'live' },
      payload: registrationPayload,
    }),
    (error) => error instanceof ProtocolValidationError
      && error.code === 'invalid_evidence_environment'
  );

  assert.throws(
    () => createLifecycleMessage({
      messageId: 'message-3',
      correlationId: 'correlation-3',
      idempotencyKey: 'idempotency-3',
      timeoutMs: 1000,
      evidence: { mode: 'replay' },
      payload: { interactionType: 'training.submit' },
    }),
    (error) => error instanceof ProtocolValidationError
      && error.code === 'invalid_lifecycle_payload'
  );
});

test('response metadata carries the evidence label and correlation without exposing payload data', () => {
  const message = createLifecycleMessage({
    messageId: 'metadata-message',
    correlationId: 'metadata-correlation',
    idempotencyKey: 'metadata-idempotency',
    timeoutMs: 1000,
    evidence: { mode: 'synthetic' },
    payload: {
      interactionType: 'examination.submit',
      data: { agentLearnerKey: 'metadata-agent', answer: 'private answer' },
    },
  });

  assert.deepEqual(protocolResponseMetadata(message), {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: 'lifecycle',
    messageId: 'metadata-message',
    correlationId: 'metadata-correlation',
    evidence: {
      mode: 'synthetic',
      environment: 'simulation',
      label: 'SIMULATION: Synthetic Agent Learner',
    },
  });
});
