'use strict';
const { fail } = require('./model');

function createSources(config = {}) {
  const { examinationUrl, examinationKey, marketplaceUrl, marketplaceKey, packageUrl, packageKey,
    trainingUrl, trainingKey, timeoutMs = 2000, fetchImpl = fetch } = config;
  async function call(base, key, path, correlationId, body, role = 'admin') {
    if (!base || !key) throw fail('source_unavailable', 503);
    try {
      const response = await fetchImpl(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-service-key': key,
          'x-actor-subject': 'skill-gap-service', 'x-actor-role': role, 'x-correlation-id': correlationId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 404 && body === undefined) throw fail('source_not_found', 404);
      const value = await response.json();
      if (body !== undefined) return { status: response.status, body: value };
      if (!response.ok) throw fail('source_unavailable', 503);
      return value;
    } catch (error) {
      if (error.code === 'source_not_found') throw error;
      throw fail('source_unavailable', 503);
    }
  }
  return {
    examination: async (id, correlationId) => (await call(examinationUrl, examinationKey,
      `/internal/admin/attempts/${encodeURIComponent(id)}/remediation`, correlationId)).trace,
    marketplace: async (id, correlationId) => (await call(marketplaceUrl, marketplaceKey,
      `/internal/match-results/${encodeURIComponent(id)}`, correlationId)).matchResult,
    package: (ref, correlationId) => call(packageUrl, packageKey, ref
      ? `/packages/${encodeURIComponent(ref.id)}?version=${encodeURIComponent(ref.version)}` : '/packages/active', correlationId),
    training: (request, correlationId) => call(trainingUrl, trainingKey, '/internal/remediations', correlationId, request),
  };
}
module.exports = { createSources };
