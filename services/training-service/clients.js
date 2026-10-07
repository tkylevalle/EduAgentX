'use strict';

// Real PackageSource and RegistrySource over HTTP. Training never reads
// another service's tables. A 404 becomes null ("not found"); anything else
// unexpected throws, so the caller fails closed and writes nothing.

const DEFAULT_TIMEOUT_MS = 2500;

class SourceUnavailableError extends Error {
  constructor(source) {
    super(`${source} unavailable`);
    this.code = 'source_unavailable';
    this.source = source;
  }
}

// The upstream answered, but not in the agreed shape. Never guess a field.
class ContractError extends Error {
  constructor(source, details) {
    super(`${source} response does not match the agreed contract`);
    this.code = 'contract_violation';
    this.source = source;
    this.details = details;
  }
}

const text = (value) => typeof value === 'string' && value.length > 0;

// The single mapping from validation-activation's package response
// (GET /packages/active or GET /packages/:id) to a PackageRecord. Only
// objectives and modules are kept, because those are what Training delivers.
function toPackageRecord(body) {
  const missing = [];
  if (!text(body?.packageId)) missing.push('packageId');
  if (!text(body?.version)) missing.push('version');
  if (!text(body?.state)) missing.push('state');
  if (!text(body?.digest)) missing.push('digest');
  if (!Array.isArray(body?.objectives)) missing.push('objectives');
  if (!Array.isArray(body?.modules)) missing.push('modules');
  if (missing.length) throw new ContractError('validation-activation', missing);
  return {
    id: body.packageId,
    version: body.version,
    state: body.state,
    digest: body.digest,
    payload: { objectives: body.objectives, modules: body.modules },
  };
}

// The single mapping from the Registry's GET /v1/registrations response.
function toRegistration(body) {
  const registration = body?.registration;
  const missing = [];
  if (!text(registration?.agentLearnerKey)) missing.push('agentLearnerKey');
  if (!text(registration?.configurationFingerprint)) missing.push('configurationFingerprint');
  if (!Number.isInteger(registration?.configurationVersion)) missing.push('configurationVersion');
  if (missing.length) throw new ContractError('agent-registry', missing);
  return {
    agentLearnerKey: registration.agentLearnerKey,
    configurationFingerprint: registration.configurationFingerprint,
    configurationVersion: registration.configurationVersion,
  };
}

// Returns the parsed body, or null on 404. Every other failure is an outage.
async function getJson(source, url, { correlationId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: correlationId ? { 'x-correlation-id': correlationId } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SourceUnavailableError(source);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new SourceUnavailableError(source);
  try {
    return await response.json();
  } catch {
    throw new SourceUnavailableError(source);
  }
}

function createPackageSource({
  baseUrl = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  timeoutMs,
} = {}) {
  const read = async (path, options = {}) => {
    const body = await getJson('validation-activation', `${baseUrl}${path}`, { ...options, timeoutMs });
    return body === null ? null : toPackageRecord(body);
  };
  return {
    getActive: (options) => read('/packages/active', options),
    getById: (id, options) => read(`/packages/${encodeURIComponent(id)}`, options),
  };
}

function createRegistrySource({
  baseUrl = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001',
  timeoutMs,
} = {}) {
  return {
    async getRegistration(agentLearnerKey, options = {}) {
      const body = await getJson('agent-registry',
        `${baseUrl}/v1/registrations?agentLearnerKey=${encodeURIComponent(agentLearnerKey)}`, { ...options, timeoutMs });
      return body === null ? null : toRegistration(body);
    },
  };
}

module.exports = {
  ContractError, SourceUnavailableError, createPackageSource, createRegistrySource, toPackageRecord, toRegistration,
};
