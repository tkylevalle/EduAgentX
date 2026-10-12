'use strict';

class DependencyError extends Error {
  constructor(source, status = 503) { super(`${source} unavailable`); this.source = source; this.status = status; }
}

async function getJson(source, url, { headers = {}, correlationId, timeoutMs = 2500 } = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { ...headers, 'x-correlation-id': correlationId || '' },
      signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw new DependencyError(source); }
  if (response.status === 404) return null;
  if (!response.ok) throw new DependencyError(source, 502);
  try { return await response.json(); }
  catch { throw new DependencyError(source, 502); }
}

function createSources({
  validationUrl = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  registryUrl = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001',
  trainingUrl = process.env.TRAINING_SERVICE_URL || 'http://training-service:4004',
  curriculumKey = process.env.CURRICULUM_INTERNAL_KEY,
  trainingKey = process.env.TRAINING_INTERNAL_KEY,
} = {}) {
  if (!curriculumKey || !trainingKey) throw new Error('curriculum and training keys required');
  return {
    activePackage: (correlationId) => getJson('validation-activation', `${validationUrl}/packages/active`, {
      correlationId, headers: { 'x-internal-service-key': curriculumKey, 'x-actor-subject': 'examination-engine' },
    }),
    registration: async (actor, correlationId) => {
      const body = await getJson('agent-registry',
        `${registryUrl}/v1/registrations?agentLearnerKey=${encodeURIComponent(actor)}`, { correlationId });
      return body?.registration || null;
    },
    completion: async (actor, pkg, correlationId) => {
      const query = new URLSearchParams({ agentLearnerKey: actor, packageId: pkg.packageId,
        packageVersion: pkg.version, packageDigest: pkg.digest });
      const body = await getJson('training-service', `${trainingUrl}/internal/completions/latest?${query}`, {
        correlationId, headers: { 'x-internal-service-key': trainingKey, 'x-actor-subject': 'examination-engine' },
      });
      return body?.completion || null;
    },
  };
}

module.exports = { createSources, DependencyError };
