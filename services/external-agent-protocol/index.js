const PROTOCOL_NAME = 'ExternalAgentLearner';
const PROTOCOL_VERSION = '1.0.0';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION]);
const MAX_TIMEOUT_MS = 60_000;
const MAX_IDENTIFIER_LENGTH = 256;
const EVIDENCE_MODES = Object.freeze(['synthetic', 'replay', 'live', 'fallback']);

const EVIDENCE_ENVIRONMENTS = Object.freeze({
  synthetic: 'simulation',
  replay: 'simulation',
  live: 'live',
  fallback: 'simulation',
});

const EVIDENCE_LABELS = Object.freeze({
  synthetic: 'SIMULATION: Synthetic Agent Learner',
  replay: 'SIMULATION: Replay Agent Learner',
  live: 'LIVE: Live Agent Learner',
  fallback: 'SIMULATION: Deterministic Fallback',
});

const SERVER_OWNED_REGISTRATION_FIELDS = new Set(['fingerprint', 'configurationFingerprint']);

class ProtocolValidationError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.code = code;
    this.details = details;
    this.statusCode = 400;
  }
}

function canonicalEvidence(mode) {
  if (!EVIDENCE_MODES.includes(mode)) throw new RangeError(`Unsupported evidence mode: ${mode}`);
  return {
    mode,
    environment: EVIDENCE_ENVIRONMENTS[mode],
    label: EVIDENCE_LABELS[mode],
  };
}

function createRegistrationMessage(input) {
  return validateProtocolMessage({
    ...input,
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: 'registration',
  }, { expectedMessageType: 'registration' });
}

function createLifecycleMessage(input) {
  return validateProtocolMessage({
    ...input,
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: 'lifecycle',
  }, { expectedMessageType: 'lifecycle' });
}

function validateProtocolMessage(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    throw new ProtocolValidationError(
      'invalid_message',
      'External Agent Learner message must be an object',
      [{ field: 'message', code: 'invalid_type', message: 'message must be an object' }]
    );
  }

  if (input.protocol !== PROTOCOL_NAME) {
    addError(errors, 'protocol', 'invalid_protocol', `protocol must be ${PROTOCOL_NAME}`);
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(input.protocolVersion)) {
    addError(errors, 'protocolVersion', 'unsupported_protocol_version', 'protocolVersion is not supported');
  }

  const messageType = text(input.messageType);
  if (!['registration', 'lifecycle'].includes(messageType)) {
    addError(errors, 'messageType', 'invalid_message_type', 'messageType must be registration or lifecycle');
  }
  if (options.expectedMessageType && messageType !== options.expectedMessageType) {
    addError(errors, 'messageType', 'unexpected_message_type', `messageType must be ${options.expectedMessageType}`);
  }

  const messageId = validateIdentifier(errors, input.messageId, 'messageId');
  const correlationId = validateIdentifier(errors, input.correlationId, 'correlationId');
  const idempotencyKey = validateIdentifier(errors, input.idempotencyKey, 'idempotencyKey');
  const timeoutMs = validateTimeout(errors, input.timeoutMs);
  const evidence = normalizeEvidence(input.evidence, errors);

  if (!isPlainObject(input.payload)) {
    addError(errors, 'payload', 'invalid_payload', 'payload must be an object');
  }

  let payload = isPlainObject(input.payload) ? cloneJson(input.payload) : null;
  if (messageType === 'registration' && payload) {
    payload = normalizeRegistrationPayload(payload, errors);
  }
  if (messageType === 'lifecycle' && payload) {
    validateLifecyclePayload(payload, errors);
  }

  if (errors.length > 0) throw fromErrors(errors);

  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType,
    messageId,
    correlationId,
    idempotencyKey,
    timeoutMs,
    evidence,
    payload,
  };
}

function normalizeRegistrationPayload(input, errors) {
  for (const field of SERVER_OWNED_REGISTRATION_FIELDS) {
    if (hasOwn(input, field)) {
      addError(errors, `payload.${field}`, 'server_owned_field', `${field} is computed by the platform`);
    }
  }

  const agentLearnerKey = requiredText(errors, input.agentLearnerKey, 'payload.agentLearnerKey', 'agentLearnerKey');
  const model = normalizeModel(input, errors);
  const systemPromptHash = requiredText(
    errors,
    input.systemPromptHash,
    'payload.systemPromptHash',
    'systemPromptHash'
  );
  const approvedToolManifest = normalizeToolManifest(input.approvedToolManifest, errors);
  const policyConfigurationHash = requiredText(
    errors,
    input.policyConfigurationHash,
    'payload.policyConfigurationHash',
    'policyConfigurationHash'
  );
  const adapterVersion = requiredText(errors, input.adapterVersion, 'payload.adapterVersion', 'adapterVersion');

  return {
    ...input,
    agentLearnerKey,
    model,
    systemPromptHash,
    approvedToolManifest,
    policyConfigurationHash,
    adapterVersion,
  };
}

function normalizeModel(input, errors) {
  if (input.model !== undefined && !isPlainObject(input.model)) {
    addError(errors, 'payload.model', 'invalid_type', 'model must be an object');
  }

  const nestedProvider = isPlainObject(input.model) ? input.model.provider : undefined;
  const nestedVersion = isPlainObject(input.model) ? input.model.version : undefined;
  const provider = input.modelProvider ?? nestedProvider;
  const version = input.modelVersion ?? nestedVersion;

  if (input.modelProvider !== undefined && nestedProvider !== undefined && text(input.modelProvider) !== text(nestedProvider)) {
    addError(errors, 'payload.modelProvider', 'conflict', 'modelProvider conflicts with model.provider');
  }
  if (input.modelVersion !== undefined && nestedVersion !== undefined && text(input.modelVersion) !== text(nestedVersion)) {
    addError(errors, 'payload.modelVersion', 'conflict', 'modelVersion conflicts with model.version');
  }

  return {
    provider: requiredText(errors, provider, 'payload.model.provider', 'model provider'),
    version: requiredText(errors, version, 'payload.model.version', 'model version'),
  };
}

function normalizeToolManifest(value, errors) {
  if (!Array.isArray(value)) {
    addError(errors, 'payload.approvedToolManifest', 'invalid_type', 'approvedToolManifest must be an array');
    return [];
  }

  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (!name) addError(errors, `payload.approvedToolManifest[${index}]`, 'required', 'tool name is required');
      return { name };
    }
    if (!isPlainObject(entry)) {
      addError(errors, `payload.approvedToolManifest[${index}]`, 'invalid_type', 'tool entry must be an object or string');
      return entry;
    }
    const tool = cloneJson(entry);
    tool.name = text(tool.name);
    if (!tool.name) {
      addError(errors, `payload.approvedToolManifest[${index}].name`, 'required', 'tool name is required');
    }
    return tool;
  });
}

function validateLifecyclePayload(payload, errors) {
  const interactionType = text(payload.interactionType);
  if (!interactionType || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(interactionType)) {
    addError(
      errors,
      'payload.interactionType',
      'invalid_lifecycle_payload',
      'interactionType must be a namespaced lifecycle action such as training.submit'
    );
  }
  if (!isPlainObject(payload.data)) {
    addError(errors, 'payload.data', 'invalid_lifecycle_payload', 'lifecycle payload data must be an object');
  } else if (!text(payload.data.agentLearnerKey)) {
    addError(
      errors,
      'payload.data.agentLearnerKey',
      'invalid_lifecycle_identity',
      'lifecycle payload data must identify the Agent Learner by agentLearnerKey'
    );
  }
  if (isPlainObject(payload.data)) {
    requiredText(errors, payload.data.response, 'payload.data.response', 'response');
  }
}

function normalizeEvidence(value, errors) {
  if (!isPlainObject(value)) {
    addError(errors, 'evidence', 'invalid_evidence', 'evidence must be an object');
    return null;
  }

  const mode = text(value.mode);
  if (!EVIDENCE_MODES.includes(mode)) {
    addError(errors, 'evidence.mode', 'invalid_evidence_mode', `evidence.mode must be one of ${EVIDENCE_MODES.join(', ')}`);
    return null;
  }

  const environment = text(value.environment) || EVIDENCE_ENVIRONMENTS[mode];
  if (environment !== EVIDENCE_ENVIRONMENTS[mode]) {
    addError(
      errors,
      'evidence.environment',
      'invalid_evidence_environment',
      `${mode} evidence must use environment ${EVIDENCE_ENVIRONMENTS[mode]}`
    );
  }

  const label = value.label === undefined ? EVIDENCE_LABELS[mode] : text(value.label);
  if (label !== EVIDENCE_LABELS[mode]) {
    addError(
      errors,
      'evidence.label',
      'invalid_evidence_label',
      'evidence.label must be the protocol-defined label for evidence.mode'
    );
  }

  return canonicalEvidence(mode);
}

function protocolResponseMetadata(message) {
  const normalized = validateProtocolMessage(message);
  return {
    protocol: normalized.protocol,
    protocolVersion: normalized.protocolVersion,
    messageType: normalized.messageType,
    messageId: normalized.messageId,
    correlationId: normalized.correlationId,
    evidence: normalized.evidence,
  };
}

function validateIdentifier(errors, value, field) {
  const normalized = text(value);
  if (!normalized) {
    addError(errors, field, 'required', `${field} is required`);
  } else if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    addError(errors, field, 'too_long', `${field} must be at most ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  return normalized;
}

function validateTimeout(errors, value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    addError(errors, 'timeoutMs', 'invalid_timeout', `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
    return 0;
  }
  return value;
}

function requiredText(errors, value, field, label) {
  const normalized = text(value);
  if (!normalized) addError(errors, field, 'required', `${label} is required`);
  return normalized;
}

function fromErrors(errors) {
  const first = errors[0];
  return new ProtocolValidationError(first.code, first.message, errors);
}

function addError(errors, field, code, message) {
  errors.push({ field, code, message });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  EVIDENCE_ENVIRONMENTS,
  EVIDENCE_LABELS,
  EVIDENCE_MODES,
  MAX_TIMEOUT_MS,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  SUPPORTED_PROTOCOL_VERSIONS,
  canonicalEvidence,
  createLifecycleMessage,
  createRegistrationMessage,
  normalizeEvidence,
  normalizeRegistrationPayload,
  protocolResponseMetadata,
  validateProtocolMessage,
};
