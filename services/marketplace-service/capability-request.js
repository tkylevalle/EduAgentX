'use strict';

const { createHash } = require('node:crypto');

// The spec limits the Marketplace to the one validated reference domain.
const SUPPORTED_DOMAIN = 'ai-agent-safety-secure-tool-use';
const ASSESSMENT_MODES = ['standard', 'fallback'];
const ENVIRONMENTS = ['simulation', 'live'];
const FIELDS = ['domain', 'requiredObjectiveIds', 'minOverallPercent', 'minAdversarialPercent',
  'maxCredentialAgeDays', 'allowedAssessmentModes', 'requiredEnvironment', 'title', 'preferredObjectiveIds'];

const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const uniqueStrings = (value, min, max, allowed = null) => Array.isArray(value) &&
  value.length >= min && value.length <= max && new Set(value).size === value.length &&
  value.every((item) => typeof item === 'string' && item.trim().length > 0 && item === item.trim() &&
    item.length <= 128 && (!allowed || allowed.includes(item)));

// Sorted keys at every level, so the digest never depends on how a client ordered its JSON.
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const digestOf = (value) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;

function validateRequestVersion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, errors: ['invalid:body'], digest: null };
  const errors = [];
  // Exact equality: a near-miss domain is still a domain we have not validated.
  if (input.domain !== SUPPORTED_DOMAIN) errors.push('domain_unsupported');
  if (!uniqueStrings(input.requiredObjectiveIds, 1, 20)) errors.push('invalid:requiredObjectiveIds');
  if (input.preferredObjectiveIds !== undefined && !uniqueStrings(input.preferredObjectiveIds, 0, 20))
    errors.push('invalid:preferredObjectiveIds');
  // Floors match the examination pass policy (80 overall, 70 adversarial): a request may only be stricter.
  if (!inRange(input.minOverallPercent, 80, 100)) errors.push('invalid:minOverallPercent');
  if (!inRange(input.minAdversarialPercent, 70, 100)) errors.push('invalid:minAdversarialPercent');
  if (!Number.isInteger(input.maxCredentialAgeDays) || !inRange(input.maxCredentialAgeDays, 1, 365))
    errors.push('invalid:maxCredentialAgeDays');
  if (!uniqueStrings(input.allowedAssessmentModes, 1, ASSESSMENT_MODES.length, ASSESSMENT_MODES))
    errors.push('invalid:allowedAssessmentModes');
  if (!ENVIRONMENTS.includes(input.requiredEnvironment)) errors.push('invalid:requiredEnvironment');
  if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200)
    errors.push('invalid:title');
  for (const key of Object.keys(input)) if (!FIELDS.includes(key)) errors.push(`unexpected:${key}`);
  if (errors.length) return { ok: false, errors, digest: null };
  // Objective and mode lists are sets; their order must not create a different version.
  const value = { ...input, requiredObjectiveIds: [...input.requiredObjectiveIds].sort(),
    allowedAssessmentModes: [...input.allowedAssessmentModes].sort(),
    ...(input.preferredObjectiveIds === undefined ? {} : { preferredObjectiveIds: [...input.preferredObjectiveIds].sort() }) };
  return { ok: true, errors: [], digest: digestOf(value), value: canonical(value) };
}

// State is never stored, only derived from the append-only events: closed wins,
// otherwise the most recently opened version is the open one.
function deriveRequestState(events) {
  if (events.some((event) => event.eventType === 'closed')) return { status: 'closed', openVersion: null };
  const opened = events.filter((event) => event.eventType === 'opened' && Number.isInteger(event.version)).at(-1);
  return opened ? { status: 'open', openVersion: opened.version } : { status: 'draft', openVersion: null };
}

module.exports = { SUPPORTED_DOMAIN, ASSESSMENT_MODES, ENVIRONMENTS, validateRequestVersion, deriveRequestState, digestOf };
