const crypto = require('node:crypto');

const FINGERPRINT_VERSION = 'v1';
const MAX_TEXT_LENGTH = 512;
const SERVER_OWNED_FIELDS = new Set(['fingerprint', 'configurationFingerprint']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pushError(errors, field, code, message) {
  errors.push({ field, code, message });
}

function validateText(errors, value, field, label) {
  const normalized = text(value);
  if (!normalized) {
    pushError(errors, field, 'required', `${label} is required`);
    return '';
  }
  if (normalized.length > MAX_TEXT_LENGTH) {
    pushError(errors, field, 'too_long', `${label} must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return normalized;
}

function resolveModel(input, errors) {
  const nestedModel = input.model;
  if (nestedModel !== undefined && !isPlainObject(nestedModel)) {
    pushError(errors, 'model', 'invalid_type', 'model must be an object');
  }

  const nestedProvider = isPlainObject(nestedModel) ? nestedModel.provider : undefined;
  const nestedVersion = isPlainObject(nestedModel) ? nestedModel.version : undefined;
  const provider = input.modelProvider ?? nestedProvider;
  const version = input.modelVersion ?? nestedVersion;

  if (input.modelProvider !== undefined && nestedProvider !== undefined && text(input.modelProvider) !== text(nestedProvider)) {
    pushError(errors, 'modelProvider', 'conflict', 'modelProvider conflicts with model.provider');
  }
  if (input.modelVersion !== undefined && nestedVersion !== undefined && text(input.modelVersion) !== text(nestedVersion)) {
    pushError(errors, 'modelVersion', 'conflict', 'modelVersion conflicts with model.version');
  }

  return {
    provider: validateText(errors, provider, 'model.provider', 'model provider'),
    version: validateText(errors, version, 'model.version', 'model version'),
  };
}

function normalizeToolManifest(manifest, errors) {
  if (!Array.isArray(manifest)) {
    pushError(errors, 'approvedToolManifest', 'invalid_type', 'approvedToolManifest must be an array');
    return [];
  }

  const normalized = [];
  const names = new Set();

  manifest.forEach((entry, index) => {
    let tool;
    if (typeof entry === 'string') {
      tool = { name: text(entry) };
    } else if (isPlainObject(entry)) {
      tool = cloneJson(entry);
      tool.name = text(tool.name);
      if (Array.isArray(tool.permissions)) {
        tool.permissions = [...new Set(tool.permissions.map((permission) => text(permission)).filter(Boolean))].sort();
      }
    } else {
      pushError(errors, `approvedToolManifest[${index}]`, 'invalid_type', 'tool entries must be strings or objects');
      return;
    }

    if (!tool.name) {
      pushError(errors, `approvedToolManifest[${index}].name`, 'required', 'tool name is required');
      return;
    }
    if (tool.name.length > MAX_TEXT_LENGTH) {
      pushError(errors, `approvedToolManifest[${index}].name`, 'too_long', 'tool name is too long');
    }
    if (names.has(tool.name)) {
      pushError(errors, `approvedToolManifest[${index}].name`, 'duplicate', `tool '${tool.name}' appears more than once`);
      return;
    }
    names.add(tool.name);
    normalized.push(tool);
  });

  return normalized.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function validateRegistrationRequest(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return {
      valid: false,
      errors: [{ field: 'body', code: 'invalid_type', message: 'request body must be an object' }],
    };
  }

  for (const field of SERVER_OWNED_FIELDS) {
    if (hasOwn(input, field)) {
      pushError(errors, field, 'server_owned_field', `${field} is computed by the Agent Registry`);
    }
  }

  const agentLearnerKey = validateText(errors, input.agentLearnerKey, 'agentLearnerKey', 'agentLearnerKey');
  const model = resolveModel(input, errors);
  const systemPromptHash = validateText(errors, input.systemPromptHash, 'systemPromptHash', 'systemPromptHash');
  const approvedToolManifest = normalizeToolManifest(input.approvedToolManifest, errors);
  const policyConfigurationHash = validateText(
    errors,
    input.policyConfigurationHash,
    'policyConfigurationHash',
    'policyConfigurationHash'
  );
  const adapterVersion = validateText(errors, input.adapterVersion, 'adapterVersion', 'adapterVersion');

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      agentLearnerKey,
      model,
      systemPromptHash,
      approvedToolManifest,
      policyConfigurationHash,
      adapterVersion,
    },
  };
}

function normalizeRegistrationRequest(input) {
  const result = validateRegistrationRequest(input);
  if (!result.valid) {
    const error = new TypeError('Invalid Agent Learner registration request');
    error.details = result.errors;
    throw error;
  }
  return result.value;
}

function fingerprintPayload(input) {
  return {
    fingerprintVersion: FINGERPRINT_VERSION,
    model: input.model,
    systemPromptHash: input.systemPromptHash,
    approvedToolManifest: input.approvedToolManifest,
    policyConfigurationHash: input.policyConfigurationHash,
    adapterVersion: input.adapterVersion,
  };
}

function computeConfigurationFingerprint(input) {
  const normalized = input.agentLearnerKey === undefined
    ? input
    : normalizeRegistrationRequest(input);
  const digest = crypto.createHash('sha256').update(canonicalJson(fingerprintPayload(normalized))).digest('hex');
  return `sha256:${digest}`;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

module.exports = {
  FINGERPRINT_VERSION,
  canonicalJson,
  computeConfigurationFingerprint,
  fingerprintPayload,
  isUuid,
  normalizeRegistrationRequest,
  validateRegistrationRequest,
};
