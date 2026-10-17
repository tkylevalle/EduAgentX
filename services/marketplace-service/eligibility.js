'use strict';

const { SUPPORTED_DOMAIN, ASSESSMENT_MODES, ENVIRONMENTS } = require('./capability-request');

// Pure hard-eligibility rules for one candidate credential against one Capability Request version.
// No clock, network or storage: the caller passes `now` and the authoritative answers it just rechecked.

const DAY_MS = 86400000;
const UNCHECKABLE = Symbol('uncheckable');

// "unknown" is how an upstream says it could not tell; it must never read as a value.
const known = (value) => value !== undefined && value !== null && value !== 'unknown';
const text = (value) => known(value) && typeof value === 'string' && value.length > 0;
const percent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const instant = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!text(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

// Only an explicit true/false counts; anything else (1, "yes", missing) is uncheckable.
const flag = (value, failCode) => (value === true ? null : value === false ? failCode : UNCHECKABLE);
const verdict = (value, failCode) => (value === 'valid' ? null : value === 'invalid' ? failCode : UNCHECKABLE);

const STATUS_CODES = Object.freeze({ active: null, suspended: 'STATUS_SUSPENDED', revoked: 'STATUS_REVOKED',
  superseded: 'STATUS_SUPERSEDED', indeterminate: 'STATUS_INDETERMINATE' });

// Domain and objectives come from the package lookup, which only counts when it describes
// exactly the package version the credential pinned.
const packageMatches = ({ candidate, authoritative }) =>
  text(candidate.package?.digest) && text(authoritative.package?.digest) &&
  candidate.package.digest === authoritative.package.digest;

const GATES = Object.freeze([
  { id: 'lifecycle_origin', tag: 'trust', check: ({ authoritative }) => flag(authoritative.lifecycleOrigin, 'NOT_LIFECYCLE_ORIGIN') },
  { id: 'discoverable', tag: 'trust', check: ({ authoritative }) => flag(authoritative.discoverable, 'NOT_DISCOVERABLE') },
  { id: 'signature', tag: 'trust', check: ({ authoritative }) => verdict(authoritative.verification?.signature, 'SIGNATURE_INVALID') },
  { id: 'schema', tag: 'trust', check: ({ authoritative }) => verdict(authoritative.verification?.schema, 'SCHEMA_INVALID') },
  { id: 'status', tag: 'trust', check: ({ authoritative }) => {
    const status = authoritative.verification?.status;
    return typeof status === 'string' && Object.hasOwn(STATUS_CODES, status) ? STATUS_CODES[status] : UNCHECKABLE;
  } },
  { id: 'expiry', tag: 'trust', check: ({ candidate, now }) => {
    const until = instant(candidate.validUntil);
    if (until === null || now === null) return UNCHECKABLE;
    // At the validUntil instant the credential is already treated as expired (fail closed on the edge).
    return now >= until ? 'EXPIRED' : null;
  } },
  { id: 'fingerprint', tag: 'trust', check: ({ candidate, authoritative }) => {
    const credential = candidate.configurationFingerprint;
    const current = authoritative.registry?.currentFingerprint;
    if (!text(credential) || !text(current)) return UNCHECKABLE;
    return credential === current ? null : 'FINGERPRINT_MISMATCH';
  } },
  { id: 'environment', tag: 'trust', check: ({ request, candidate }) => {
    if (!ENVIRONMENTS.includes(candidate.environment) || !ENVIRONMENTS.includes(request.requiredEnvironment))
      return UNCHECKABLE;
    return candidate.environment === request.requiredEnvironment ? null : 'ENVIRONMENT_MISMATCH';
  } },
  { id: 'domain', tag: 'trust', check: (input) => {
    if (!packageMatches(input)) return 'PACKAGE_UNCHECKABLE';
    const domain = input.authoritative.package.domain;
    if (!text(domain) || !text(input.request.domain)) return UNCHECKABLE;
    // Re-asserting the supported domain here means a bad request row can never widen eligibility.
    return domain === input.request.domain && domain === SUPPORTED_DOMAIN ? null : 'DOMAIN_MISMATCH';
  } },
  { id: 'objectives', tag: 'request', check: (input) => {
    if (!packageMatches(input)) return 'PACKAGE_UNCHECKABLE';
    const required = input.request.requiredObjectiveIds;
    const covered = input.authoritative.package.objectiveIds;
    if (!Array.isArray(required) || required.length === 0 || !required.every(text)) return UNCHECKABLE;
    if (!Array.isArray(covered) || !covered.every(text)) return UNCHECKABLE;
    const missingObjectiveIds = required.filter((id) => !covered.includes(id));
    return missingObjectiveIds.length ? { code: 'OBJECTIVE_MISSING', missingObjectiveIds } : null;
  } },
  { id: 'score_overall', tag: 'request', check: ({ request, candidate }) => {
    if (!percent(candidate.overallPercent) || !percent(request.minOverallPercent)) return UNCHECKABLE;
    return candidate.overallPercent >= request.minOverallPercent ? null : 'SCORE_OVERALL_BELOW';
  } },
  { id: 'score_adversarial', tag: 'request', check: ({ request, candidate }) => {
    if (!percent(candidate.adversarialPercent) || !percent(request.minAdversarialPercent)) return UNCHECKABLE;
    return candidate.adversarialPercent >= request.minAdversarialPercent ? null : 'SCORE_ADVERSARIAL_BELOW';
  } },
  { id: 'age', tag: 'request', check: ({ request, candidate, now }) => {
    const from = instant(candidate.validFrom);
    const maxDays = request.maxCredentialAgeDays;
    if (from === null || now === null || !Number.isFinite(maxDays) || maxDays <= 0) return UNCHECKABLE;
    // A validFrom in the future cannot be aged honestly, so it is excluded rather than counted as brand new.
    if (now < from) return UNCHECKABLE;
    return now - from <= maxDays * DAY_MS ? null : 'CREDENTIAL_TOO_OLD';
  } },
  { id: 'mode', tag: 'request', check: ({ request, candidate }) => {
    if (!ASSESSMENT_MODES.includes(candidate.assessmentMode) || !Array.isArray(request.allowedAssessmentModes))
      return UNCHECKABLE;
    return request.allowedAssessmentModes.includes(candidate.assessmentMode) ? null : 'MODE_NOT_ALLOWED';
  } },
]);

const objectOrEmpty = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function checkEligibility(requestVersion, candidate, authoritative, now) {
  const input = { request: objectOrEmpty(requestVersion), candidate: objectOrEmpty(candidate),
    authoritative: objectOrEmpty(authoritative), now: instant(now) };
  const reasons = [];
  // Every gate runs, so the evidence shows all failures, not just the first one.
  for (const gate of GATES) {
    const outcome = gate.check(input);
    if (outcome === null) continue;
    if (outcome === UNCHECKABLE) {
      // Not knowing is a trust failure whatever the gate, so #31 can never treat it as a near miss.
      reasons.push({ code: `${gate.id.toUpperCase()}_UNCHECKABLE`, gate: gate.id, tag: 'trust' });
    } else if (outcome === 'PACKAGE_UNCHECKABLE') {
      reasons.push({ code: outcome, gate: gate.id, tag: 'trust' });
    } else if (typeof outcome === 'string') {
      reasons.push({ code: outcome, gate: gate.id, tag: gate.tag });
    } else {
      reasons.push({ code: outcome.code, gate: gate.id, tag: gate.tag, missingObjectiveIds: outcome.missingObjectiveIds });
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

module.exports = { GATES, checkEligibility };
