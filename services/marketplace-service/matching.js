'use strict';

const { SUPPORTED_DOMAIN, validateRequestVersion } = require('./capability-request');
const { GATES, checkEligibility } = require('./eligibility');
const POLICY_VERSION = 'MATCH-POLICY-1.0.0';
const DAY_MS = 86400000;
// Code-unit order is independent of host locale/ICU settings.
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const safeText = (s) => typeof s === 'string' && s.length > 0 && s.length <= 256;
const SOURCE_KEYS = ['verification', 'registry', 'package', 'lifecycleOrigin', 'listing'];
const SOURCE_VALUES = ['answered', 'timeout', 'source_unavailable', 'contract_violation', 'source_not_available', 'marketplace'];

function score(request, candidate, objectiveIds, now) {
  const ageDays = (Date.parse(now) - Date.parse(candidate.validFrom)) / DAY_MS;
  const preferred = request.preferredObjectiveIds || [];
  const covered = preferred.filter((id) => objectiveIds.includes(id)).sort(compareId);
  const components = {
    totalPerformance: { weight: 35, actual: candidate.overallPercent, denominator: 100,
      points: 35 * candidate.overallPercent / 100 },
    adversarialPerformance: { weight: 35, actual: candidate.adversarialPercent, denominator: 100,
      points: 35 * candidate.adversarialPercent / 100 },
    preferredCoverage: { weight: 20, coveredObjectiveIds: covered, requestedObjectiveIds: [...preferred].sort(compareId),
      points: preferred.length ? 20 * covered.length / preferred.length : 20 },
    credentialRecency: { weight: 10, ageDays, maximumAgeDays: request.maxCredentialAgeDays,
      points: 10 * Math.max(0, 1 - ageDays / request.maxCredentialAgeDays) },
  };
  const unroundedTotal = Object.values(components).reduce((sum, c) => sum + c.points, 0);
  return { components, unroundedTotal, matchScore: Math.round((unroundedTotal + Number.EPSILON) * 100) / 100 };
}

function gapsFor(request, candidate, objectiveIds, now) {
  const gaps = [];
  const missing = request.requiredObjectiveIds.filter((id) => !objectiveIds.includes(id)).sort(compareId);
  for (const objectiveId of missing) gaps.push({ code: 'OBJECTIVE_MISSING', objectiveId });
  const overall = Math.max(0, request.minOverallPercent - candidate.overallPercent) / request.minOverallPercent;
  const adversarial = Math.max(0, request.minAdversarialPercent - candidate.adversarialPercent) / request.minAdversarialPercent;
  const ageDays = (Date.parse(now) - Date.parse(candidate.validFrom)) / DAY_MS;
  const age = Math.min(1, Math.max(0, ageDays - request.maxCredentialAgeDays) / request.maxCredentialAgeDays);
  const mode = request.allowedAssessmentModes.includes(candidate.assessmentMode) ? 0 : 1;
  if (overall) gaps.push({ code: 'SCORE_OVERALL_BELOW', actual: candidate.overallPercent, required: request.minOverallPercent });
  if (adversarial) gaps.push({ code: 'SCORE_ADVERSARIAL_BELOW', actual: candidate.adversarialPercent, required: request.minAdversarialPercent });
  if (age) gaps.push({ code: 'CREDENTIAL_TOO_OLD', actualDays: ageDays, maximumDays: request.maxCredentialAgeDays });
  if (mode) gaps.push({ code: 'MODE_NOT_ALLOWED', actual: candidate.assessmentMode, allowed: [...request.allowedAssessmentModes] });
  // All five request requirements are applicable; satisfied requirements contribute zero.
  const components = { objectives: missing.length / request.requiredObjectiveIds.length, overall, adversarial, age, mode };
  return { gaps, gapCount: gaps.length, normalizedShortfall: Object.values(components).reduce((a, b) => a + b, 0) / 5,
    shortfallComponents: components, shortfallDivisor: 5 };
}

const criteriaFor = (near) => [
  ...(near ? [['gapCount', 'asc'], ['normalizedShortfall', 'asc']] : []),
  ['matchScore', 'desc'], ['issuedAt', 'desc'], ['agentLearnerKey', 'asc'],
];
function compareBy(a, b, criteria) {
  for (const [field, direction] of criteria) {
    const av = field === 'issuedAt' ? Date.parse(a[field]) : a[field];
    const bv = field === 'issuedAt' ? Date.parse(b[field]) : b[field];
    const delta = typeof av === 'string' ? compareId(av, bv) : av - bv;
    if (delta) return direction === 'desc' ? -delta : delta;
  }
  return 0;
}
function rank(items, near, limit) {
  const criteria = criteriaFor(near);
  items.sort((a, b) => compareBy(a, b, criteria));
  return items.slice(0, limit).map((item, i) => {
    const next = items[i + 1];
    const firstDifference = next && criteria.find(([field]) => field === 'issuedAt'
      ? Date.parse(item[field]) !== Date.parse(next[field]) : item[field] !== next[field]);
    return { ...item, rank: i + 1, ordering: {
      criteria: criteria.map(([field, direction]) => ({ field, direction })),
      comparedWith: next?.agentLearnerKey || null,
      decisiveCriterion: firstDifference?.[0] || 'only_or_last_candidate',
      tiedCriteria: firstDifference ? criteria.slice(0, criteria.indexOf(firstDifference)).map(([field]) => field) : [],
    } };
  });
}

// Inputs are server-owned rechecks, never client-supplied eligibility verdicts.
// Output is deliberately allowlisted: do not spread candidates, source bodies or JWSs.
function matchCandidates(request, inputs, now) {
  const empty = { policyVersion: POLICY_VERSION, eligibleMatches: [], nearMatches: [],
    nearMatchLane: 'Not Eligible', totalEligible: 0, totalNearMatches: 0, exclusions: [], exclusionCounts: {} };
  if (request?.domain !== SUPPORTED_DOMAIN) return { ...empty, outcome: 'UNSUPPORTED_DOMAIN' };
  if (!validateRequestVersion(request).ok || !Number.isFinite(Date.parse(now)))
    return { ...empty, outcome: 'INVALID_REQUEST' };
  const eligible = [], near = [], exclusions = [];
  const exclude = (record, reasons) => exclusions.push({
    agentLearnerKey: safeText(record.agentLearnerKey) ? record.agentLearnerKey : null,
    credentialId: safeText(record.credentialId) ? record.credentialId : null,
    reasons: reasons.map(({ code, gate, tag }) => ({ code, gate, tag })),
  });
  // Duplicate credential identities cannot be resolved using input order.
  const counts = new Map();
  for (const { record } of inputs) counts.set(record.credentialId, (counts.get(record.credentialId) || 0) + 1);
  for (const { record, authoritative, sources = {} } of inputs) {
    const c = record.candidate || {};
    const { eligible: passes, reasons } = checkEligibility(request, c, authoritative, now);
    if (!safeText(record.agentLearnerKey) || !safeText(record.credentialId) || c.agentLearnerKey !== record.agentLearnerKey ||
        c.credentialId !== record.credentialId || counts.get(record.credentialId) !== 1)
      reasons.push({ code: 'IDENTITY_UNCHECKABLE', gate: 'identity', tag: 'trust' });
    if (!['synthetic', 'replay', 'live'].includes(c.evidenceMode) ||
        (c.environment === 'live' && c.evidenceMode !== 'live'))
      reasons.push({ code: 'EVIDENCE_MODE_UNCHECKABLE', gate: 'evidence_mode', tag: 'trust' });
    if (reasons.some((r) => r.tag === 'trust')) { exclude(record, reasons); continue; }
    const failed = new Set(reasons.map((r) => r.gate));
    const gaps = gapsFor(request, c, authoritative.package.objectiveIds, now);
    const item = {
      agentLearnerKey: record.agentLearnerKey, credentialId: record.credentialId,
      eligible: passes, lane: passes ? 'Eligible Matches' : 'Not Eligible',
      ...score(request, c, authoritative.package.objectiveIds, now), ...gaps,
      issuedAt: new Date(c.validFrom).toISOString(),
      satisfiedRequirements: GATES.filter((g) => !failed.has(g.id)).map((g) => g.id),
      checks: [...GATES.map((g) => ({ gate: g.id, tag: g.tag, passed: !failed.has(g.id) })),
        { gate: 'identity', tag: 'trust', passed: true }, { gate: 'evidence_mode', tag: 'trust', passed: true }],
      evidence: { checkedAt: now, credentialStatus: authoritative.verification.status,
        configurationFingerprint: c.configurationFingerprint, assessmentMode: c.assessmentMode,
        evidenceMode: c.evidenceMode, environment: c.environment,
        package: { id: c.package.id, version: c.package.version, digest: c.package.digest } },
      sources: Object.fromEntries(SOURCE_KEYS.map((key) => [key, SOURCE_VALUES.includes(sources[key]) ? sources[key] : 'contract_violation'])),
    };
    (passes ? eligible : near).push(item);
  }
  // One representative credential per learner. Any eligible credential takes
  // precedence over that learner's near misses. Exact same-agent ties use credential ID.
  const selected = new Set();
  const dedupe = (items, isNear) => {
    items.sort((a, b) => compareBy(a, b, criteriaFor(isNear)) || compareId(a.credentialId, b.credentialId));
    return items.filter((item) => {
      if (selected.has(item.agentLearnerKey)) {
        exclude(item, [{ code: 'OTHER_CREDENTIAL_SELECTED', gate: 'representative', tag: 'selection' }]); return false;
      }
      selected.add(item.agentLearnerKey);
      item.credentialSelection = 'best_lane_then_lane_order_then_credential_id';
      return true;
    });
  };
  const uniqueEligible = dedupe(eligible, false), uniqueNear = dedupe(near, true);
  exclusions.sort((a, b) => compareId(a.agentLearnerKey || '', b.agentLearnerKey || '') || compareId(a.credentialId || '', b.credentialId || ''));
  const exclusionCounts = {};
  for (const item of exclusions) for (const code of new Set(item.reasons.map((r) => r.code)))
    exclusionCounts[code] = (exclusionCounts[code] || 0) + 1;
  return { ...empty, outcome: 'MATCHED', totalEligible: uniqueEligible.length, totalNearMatches: uniqueNear.length,
    eligibleMatches: rank(uniqueEligible, false, 5), nearMatches: rank(uniqueNear, true, 3), exclusions, exclusionCounts };
}
module.exports = { POLICY_VERSION, matchCandidates };
