'use strict';
const { createHash } = require('node:crypto');
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = (v) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}`;
const VERSION = '1.0.0';
const SEED = 'eduagentx-sprint5-issue33-v1';
function identity(scenarioId, operation, { version = VERSION, seed = SEED } = {}) {
  if (![scenarioId, operation, version, seed].every(v => typeof v === 'string' && v.length && v.length <= 256))
    throw new TypeError('explicit bounded identity components required');
  return `e2e33-${digest({ version, seed, scenarioId, operation }).slice(7, 47)}`;
}
const learnerId = (id) => identity(id, 'learner');
function command(scenarioId, operation) {
  return { commandId: identity(scenarioId, `command:${operation}`),
    correlationId: identity(scenarioId, `correlation:${operation}`),
    idempotencyKey: identity(scenarioId, `idempotency:${operation}`),
    requestId: identity(scenarioId, `request:${operation}`) };
}
module.exports = { VERSION, SEED, canonical, digest, identity, learnerId, command };
