'use strict';

const { createHash } = require('node:crypto');
const { EVIDENCE_ENVIRONMENTS } = require('../../packages/external-agent-protocol');
const POLICY = 'SKILL-GAP-1.0.0';
const DOMAIN = 'ai-agent-safety-secure-tool-use';
const identifier = (v) => typeof v === 'string' && /^[\x20-\x7e]{1,256}$/.test(v);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const instant = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
const digest = (v) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}`;
const fail = (code, status = 422) => Object.assign(new Error(code), { code, status });
const requireThat = (condition, code = 'invalid_source') => { if (!condition) throw fail(code); };
const ids = (v, allowEmpty = false) => Array.isArray(v) && (allowEmpty || v.length > 0) && v.length <= 20 &&
  v.every(identifier) && new Set(v).size === v.length;
const TRUST_GATES = ['lifecycle_origin','discoverable','signature','schema','status','expiry','fingerprint','environment','domain','identity','evidence_mode'];
const packageRef = (p) => object(p) && ['id', 'version', 'digest'].every((k) => identifier(p[k]));
const packageView = (p) => ({ id: p.id, version: p.version, digest: p.digest });
const labels = (e) => object(e) && Object.hasOwn(EVIDENCE_ENVIRONMENTS, e.mode) && EVIDENCE_ENVIRONMENTS[e.mode] === e.environment;

function command(body) {
  requireThat(object(body) && Object.keys(body).sort().join(',') === 'agentLearnerKey,idempotencyKey,source', 'invalid_request');
  const s = body.source;
  requireThat(identifier(body.agentLearnerKey) && identifier(body.idempotencyKey) && object(s) &&
    Object.keys(s).sort().join(',') === 'id,type' && ['examination', 'marketplace'].includes(s.type) && identifier(s.id), 'invalid_request');
  return { agentLearnerKey: body.agentLearnerKey, source: { type: s.type, id: s.id } };
}

function normalizeExamination(trace, input) {
  const event = trace?.remediation?.event;
  requireThat(trace?.failure?.attemptId === input.source.id && trace.failure.status === 'agent_failed' &&
    event?.eventType === 'examination.remediation.required' && event.schemaVersion === '1.0.0' &&
    event.attemptId === input.source.id && event.agentLearnerKey === input.agentLearnerKey &&
    event.eventId === `examination.remediation.required:${event.attemptId}` && packageRef(event.package) &&
    ids(event.gap?.objectiveIds) && ids(event.gap?.criticalViolationRuleIds, true) &&
    ids(event.failure?.failureReasons) && /^sha256:[0-9a-f]{64}$/.test(event.failure.evidenceDigest) &&
    identifier(event.failure.terminalEventId) && instant(event.occurredAt) && labels(event.evidence));
  return { source: { ...input.source, version: event.schemaVersion, digest: digest(event), eventId: event.eventId },
    package: packageView(event.package), objectiveIds: [...event.gap.objectiveIds],
    reasonCodes: [...event.failure.failureReasons], criticalRuleIds: [...event.gap.criticalViolationRuleIds],
    evidence: { mode: event.evidence.mode, environment: event.evidence.environment }, observedAt: event.occurredAt,
    governing: { terminalEventId: event.failure.terminalEventId, failureEvidenceDigest: event.failure.evidenceDigest,
      template: versionRef(trace.failure.template), rubric: versionRef(trace.failure.rubric) },
    // The existing relay owns this request; preserve its exact request digest and session identity.
    trainingOwner: 'examination-engine' };
}

function normalizeMarketplace(result, input) {
  requireThat(result?.resultId === input.source.id && result.policyVersion === 'MATCH-POLICY-1.0.0' &&
    instant(result.generatedAt) && result.outcome === 'MATCHED', 'invalid_source');
  const near = result.nearMatches?.filter((n) => n.agentLearnerKey === input.agentLearnerKey);
  requireThat(near?.length === 1 && !result.eligibleMatches?.some((n) => n.agentLearnerKey === input.agentLearnerKey), 'not_a_near_match');
  const item = near[0];
  requireThat(item.eligible === false && item.lane === 'Not Eligible' && packageRef(item.evidence?.package) &&
    Array.isArray(item.checks) && TRUST_GATES.every((gate) => item.checks.filter((c) => c.gate === gate && c.tag === 'trust' && c.passed === true).length === 1) &&
    item.checks.filter((c) => c.tag === 'trust').every((c) => c.passed === true) &&
    labels({ mode: item.evidence.evidenceMode, environment: item.evidence.environment }) &&
    Array.isArray(item.gaps) && item.gaps.length > 0 && item.gaps.length <= 24 &&
    item.gaps.every((g) => ['OBJECTIVE_MISSING', 'SCORE_OVERALL_BELOW', 'SCORE_ADVERSARIAL_BELOW', 'CREDENTIAL_TOO_OLD', 'MODE_NOT_ALLOWED'].includes(g.code)));
  const objectives = item.gaps.filter((g) => g.code === 'OBJECTIVE_MISSING').map((g) => g.objectiveId);
  requireThat(ids(objectives, true) && identifier(result.requestId) && Number.isInteger(result.requestVersion) &&
    result.requestVersion > 0 && identifier(result.requestDigest));
  return { source: { ...input.source, version: result.policyVersion, digest: digest(result) },
    package: packageView(item.evidence.package), objectiveIds: objectives,
    reasonCodes: [...new Set(item.gaps.map((g) => g.code))], gaps: item.gaps.map(gapView), criticalRuleIds: [],
    evidence: { mode: item.evidence.evidenceMode, environment: item.evidence.environment }, observedAt: result.generatedAt,
    governing: { matchingPolicyVersion: result.policyVersion, requestId: result.requestId,
      requestVersion: result.requestVersion, requestDigest: result.requestDigest }, trainingOwner: 'skill-gap-service' };
}

function versionRef(ref) {
  requireThat(object(ref) && identifier(ref.id) && identifier(ref.version) && identifier(ref.digest));
  return { id: ref.id, version: ref.version, digest: ref.digest };
}

function gapView(g) {
  if (g.code === 'OBJECTIVE_MISSING') return { code: g.code, objectiveId: g.objectiveId };
  if (g.code.startsWith('SCORE_')) {
    requireThat(Number.isFinite(g.actual) && Number.isFinite(g.required) && g.actual >= 0 && g.actual < g.required && g.required <= 100);
    return { code: g.code, actual: g.actual, required: g.required };
  }
  if (g.code === 'CREDENTIAL_TOO_OLD') {
    requireThat(Number.isFinite(g.actualDays) && Number.isFinite(g.maximumDays) && g.maximumDays > 0 && g.actualDays > g.maximumDays);
    return { code: g.code, actualDays: g.actualDays, maximumDays: g.maximumDays };
  }
  requireThat(['standard','fallback'].includes(g.actual) && Array.isArray(g.allowed) && g.allowed.length > 0 &&
    g.allowed.every(v => ['standard','fallback'].includes(v)) && !g.allowed.includes(g.actual));
  return { code: g.code, actual: g.actual, allowed: [...g.allowed] };
}

function recommend(input, normalized, pkg, now) {
  requireThat(pkg && ['Active', 'Deprecated'].includes(pkg.state) && packageRef({ id: pkg.packageId, version: pkg.version, digest: pkg.digest }), 'package_unavailable');
  requireThat((pkg.manifest?.domain || pkg.domain) === 'AI Agent Safety and Secure Tool Use', 'unsupported_domain');
  requireThat(pkg.certificationBlocked === false && Array.isArray(pkg.quarantinedScopes) && !pkg.quarantinedScopes.length, 'package_unavailable');
  if (input.source.type === 'examination') requireThat(pkg.packageId === normalized.package.id &&
    pkg.version === normalized.package.version && pkg.digest === normalized.package.digest, 'package_mismatch');
  const known = pkg.objectives?.map((o) => o.id);
  requireThat(Array.isArray(known) && known.length > 0 && known.every(identifier) && new Set(known).size === known.length &&
    normalized.objectiveIds.every((id) => known.includes(id)), 'unknown_objectives');
  const identity = digest({ policy: POLICY, source: input.source, learner: input.agentLearnerKey }).slice(7, 39);
  const recommendationId = `${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20)}`;
  return { recommendationId, schemaVersion: 'skill-gap-recommendation/1.0.0', policyVersion: POLICY,
    agentLearnerKey: input.agentLearnerKey, domain: DOMAIN, createdAt: now, ...normalized,
    trainingScope: { package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
      objectiveIds: [...normalized.objectiveIds], automaticEnrollment: false,
      outcome: normalized.objectiveIds.length ? 'targeted_training_available' : 'no_targeted_training',
      requiredActions: normalized.reasonCodes.filter((c) => c !== 'OBJECTIVE_MISSING') },
    notice: 'Recommendation only. Original assurance outcomes and request requirements remain authoritative.' };
}

function trainingRequest(r) {
  return { requestId: `skill-gap:${r.recommendationId}`, agentLearnerKey: r.agentLearnerKey,
    packageId: r.trainingScope.package.id, packageVersion: r.trainingScope.package.version,
    objectiveIds: r.trainingScope.objectiveIds,
    cause: { type: 'skill_gap', reference: r.recommendationId, evidenceDigest: r.source.digest,
      observedAt: r.observedAt, summary: 'Targeted practice recommended from a stored Marketplace Near Match.' },
    evidence: r.evidence };
}

module.exports = { POLICY, DOMAIN, identifier, digest, fail, command, normalizeExamination, normalizeMarketplace, recommend, trainingRequest };
