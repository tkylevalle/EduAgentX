'use strict';

const execution = require('../../packages/execution-provenance');
const { isPassingBehaviourEvidence } = require('../../packages/agent-sandbox/src/evidence');

// Real authoritative sources over HTTP. Marketplace never reads another
// service's tables. One mapping function per source: any missing or unexpected
// field maps to null, so the matching gate becomes UNCHECKABLE. Never guess.
// A transport failure (refused, 5xx, timeout, not JSON) throws a SourceError,
// which askSource turns into null for that one candidate.

const telemetry = require('../../packages/telemetry');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DOMAINS, ASSESSMENT_MODES } = require('./capability-request');

const SERVICE_NAME = 'marketplace-service';
const DEFAULT_TIMEOUT_MS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class SourceError extends Error {
  constructor(source, code) {
    super(`${source}: ${code}`);
    this.source = source;
    this.code = code;
  }
}

const text = (value) => typeof value === 'string' && value.length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const percent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const instant = (value) => (text(value) && Number.isFinite(Date.parse(value)) ? value : null);

// One answer, bounded in time. The outcome is kept as evidence of which sources
// were actually checked: answered, timeout, source_unavailable, contract_violation, source_not_available.
async function askSource(name, call, { timeoutMs = DEFAULT_TIMEOUT_MS, correlationId } = {}) {
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(call),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new SourceError(name, 'timeout')), timeoutMs); }),
    ]);
    return { value: value ?? null, outcome: 'answered' };
  } catch (error) {
    const outcome = error instanceof SourceError ? error.code : 'source_unavailable';
    telemetry.log(SERVICE_NAME, 'source_unavailable', { correlationId, dependency: name, outcome });
    return { value: null, outcome };
  } finally {
    clearTimeout(timer);
  }
}

// --- mappings (pure)

// GET /v1/registrations?agentLearnerKey= on the Agent Registry.
function toCurrentFingerprint(body, agentLearnerKey) {
  const registration = body?.registration;
  // The answer must be about the learner we asked for, and that learner must be active.
  if (!object(registration) || registration.agentLearnerKey !== agentLearnerKey || registration.status !== 'active') return null;
  const fingerprint = registration.configurationFingerprint;
  return text(fingerprint) && fingerprint.startsWith('sha256:') ? fingerprint : null;
}

// A package names its domain by sandbox id (manifest.domainId, and the stored
// domain since Phase 4) and by display name (manifest.domain, and the stored
// domain before it). Each form maps to one Marketplace slug; anything else is unknown.
const DOMAIN_NAMES = Object.freeze(Object.fromEntries(Object.entries(DOMAINS)
  .flatMap(([slug, { domainId, name }]) => [[domainId, slug], [name, slug]])));

// GET /packages/:id?version= on validation-activation (the read training-service uses).
function toPackageAnswer(body, packageId, version) {
  if (!object(body) || body.packageId !== packageId || body.version !== version) return null;
  // A quarantined package cannot support a marketplace claim, so it is not an answer we can use.
  if (body.certificationBlocked !== false || !Array.isArray(body.quarantinedScopes) || body.quarantinedScopes.length) return null;
  // The domain may appear on the manifest (id and name), at the top level, or all three; every copy present must name the same domain.
  const slugs = [body.manifest?.domainId, body.manifest?.domain, body.domain].filter((name) => name !== undefined)
    .map((name) => (Object.hasOwn(DOMAIN_NAMES, name) ? DOMAIN_NAMES[name] : null));
  const domain = slugs.length && slugs.every((slug) => slug !== null && slug === slugs[0]) ? slugs[0] : null;
  const ids = Array.isArray(body.objectives) ? body.objectives.map((objective) => objective?.id) : null;
  const objectiveIds = ids && ids.length && ids.every(text) && new Set(ids).size === ids.length ? ids : null;
  return { digest: text(body.digest) ? body.digest : null, domain, objectiveIds };
}

// The verifier's reason codes for a credential's status (credential-verification verifier.js).
const STATUS_REASON_CODES = Object.freeze(['SUSPENDED', 'REVOKED']);

// POST /verify on credential-verification, used for signature and schema only.
// Each check is mapped on its own and only an explicit PASS counts.
function toSignatureAndSchema(report) {
  if (!object(report)) return null;
  const check = (part) => ({ PASS: 'pass', FAIL: 'fail' })[part?.status] ?? null;
  // Authentic means a good signature from an issuer the verifier accepts.
  const both = (a, b) => (a === 'fail' || b === 'fail' ? 'invalid' : a === 'pass' && b === 'pass' ? 'valid' : null);
  let signature = both(check(report.signature), check(report.issuerPolicy));
  let schema = both(check(report.schema), check(report.credentialPolicy));
  // Without a credentialId the verifier cannot judge status, so INDETERMINATE overall is
  // expected. INVALID while both parts look fine means a check we do not map failed (time),
  // unless the only reasons are status ones: the status gate reports those itself.
  const statusOnly = Array.isArray(report.reasonCodes) && report.reasonCodes.length > 0 &&
    report.reasonCodes.every((code) => STATUS_REASON_CODES.includes(code));
  if (report.overall === 'INVALID' && signature === 'valid' && schema === 'valid' && !statusOnly) schema = 'invalid';
  if (!['VALID', 'INVALID', 'INDETERMINATE'].includes(report.overall)) signature = signature === 'invalid' ? 'invalid' : null;
  return { signature, schema };
}

// GET /status/:credentialId on credential-verification (read-only). Only an answer
// about this exact credential with a known state maps through; anything else is indeterminate.
const KNOWN_STATUSES = ['active', 'suspended', 'revoked'];
function toStatus(body, credentialId) {
  if (!object(body) || body.credentialId !== credentialId || !KNOWN_STATUSES.includes(body.status)) return 'indeterminate';
  return body.status;
}

// What a requester sees of the behaviour evidence: per objective, how many
// episodes ran and the bounds; the scope says what the numbers do not cover.
function behaviourSummary(evidence) {
  if (!isPassingBehaviourEvidence(evidence)) return null;
  return { pool: evidence.pool, scope: evidence.scope, untestedObjectiveIds: [...evidence.untestedObjectiveIds],
    objectives: evidence.objectives.map((objective) => ({
      objectiveId: objective.objectiveId, families: [...objective.families], episodes: objective.episodes,
      successLowerBound: objective.successLowerBound, violationUpperBound: objective.violationUpperBound })) };
}

// The credential record certification-service issues ({ credentialId, credential, compactJws },
// see services/certification-service/evidence.js) mapped to the candidate the gates read.
// Returns null only when the record cannot even be keyed to one credential and one learner.
function toCandidate(record) {
  if (!object(record) || !text(record.credentialId) || !object(record.credential)) return null;
  const vc = record.credential;
  // The VC id is <credentialBase>/<credentialId>; a mismatch means the pieces do not belong together.
  if (!text(vc.id) || !vc.id.endsWith(`/${record.credentialId}`)) return null;
  const subject = vc.credentialSubject;
  const prefix = text(vc.issuer) ? `${vc.issuer}/agents/` : null;
  if (!object(subject) || !prefix || !text(subject.id) || !subject.id.startsWith(prefix)) return null;
  let agentLearnerKey;
  try { agentLearnerKey = decodeURIComponent(subject.id.slice(prefix.length)); } catch { return null; }
  if (!text(agentLearnerKey)) return null;

  const competency = object(subject.competency) ? subject.competency : {};
  // Scores only count on a credential that records a pass.
  const passed = competency.result === 'pass';
  const scores = object(competency.scores) ? competency.scores : {};
  const pinned = vc.evidence?.package;
  const packageAgrees = text(competency.packageId) && text(competency.packageVersion) && object(pinned) &&
    pinned.id === competency.packageId && pinned.version === competency.packageVersion && text(pinned.digest);
  return {
    credentialId: record.credentialId,
    agentLearnerKey,
    configurationFingerprint: text(subject.configurationFingerprint) ? subject.configurationFingerprint : null,
    package: packageAgrees ? { id: pinned.id, version: pinned.version, digest: pinned.digest } : null,
    overallPercent: passed && percent(scores.overallPercent) ? scores.overallPercent : null,
    adversarialPercent: passed && percent(scores.tierPercents?.adversarial) ? scores.tierPercents.adversarial : null,
    assessmentMode: ASSESSMENT_MODES.includes(competency.mode) ? competency.mode : null,
    // The grader behind the scores, shown to requesters (assurance audit A11).
    grader: object(competency.grader) && execution.validGrader({ id: competency.grader.id, version: competency.grader.version })
      ? { id: competency.grader.id, version: competency.grader.version } : null,
    // The behaviour bound per objective (target design 4.4), or null when the
    // credential states none or states one that does not check out.
    behaviour: behaviourSummary(passed ? competency.behaviour : null),
    // L2: the platform ran the agent; L1: its configuration is self-declared (assurance audit D1).
    attestationLevel: execution.ATTESTATION_LEVELS.includes(competency.attestation?.level) ? competency.attestation.level : null,
    // Read only explicit signed fields; missing origin labels remain uncheckable.
    environment: vc.credentialSchema?.id === execution.SCHEMA && execution.credentialProvenance(vc) ? vc.environment : null,
    evidenceMode: vc.credentialSchema?.id === execution.SCHEMA && execution.credentialProvenance(vc) ? vc.evidenceMode : null,
    validFrom: instant(vc.validFrom),
    validUntil: instant(vc.validUntil),
    compactJws: text(record.compactJws) && record.compactJws.split('.').length === 3 ? record.compactJws : null,
  };
}

/**
 * A projected record with its candidate in the current shape. A projection
 * written by an earlier release lacks fields added since (the grader, the
 * behaviour bound, the attestation level), and the origin check compares the
 * candidate with the one derived from its signed credential, so it would fail
 * for every older projection. A candidate of another shape is derived again
 * from its own compact JWS, which the signature, schema and origin gates still
 * check; a candidate of the current shape is never replaced.
 * @param {object} record a credential_projection record
 * @returns {object} the record, or a copy with its candidate derived again
 */
function withCurrentCandidate(record) {
  const stored = record?.candidate;
  if (!object(stored) || !text(stored.compactJws) || !text(stored.credentialId)) return record;
  let credential;
  try { credential = JSON.parse(Buffer.from(stored.compactJws.split('.')[1], 'base64url').toString('utf8')); } catch { return record; }
  const current = toCandidate({ credentialId: stored.credentialId, credential, compactJws: stored.compactJws });
  const shape = (value) => Object.keys(value).sort().join(',');
  return current && shape(current) !== shape(stored) ? { ...record, candidate: current } : record;
}

// --- HTTP

// Returns the parsed body for an accepted status, null on 404, and throws otherwise.
async function requestJson(source, url, { method = 'GET', body, headers = {}, accept = [200], correlationId,
  timeoutMs = DEFAULT_TIMEOUT_MS, notFoundValue = null, redirect = 'follow' } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method, redirect,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SourceError(source, error?.name === 'TimeoutError' ? 'timeout' : 'source_unavailable');
  }
  if (response.status === 404) return notFoundValue;
  if (!accept.includes(response.status)) throw new SourceError(source, 'source_unavailable');
  try { return await response.json(); } catch { throw new SourceError(source, 'contract_violation'); }
}

// --- batching (assurance audit F6)

// The batch routes take at most this many keys; a longer queue is sent in chunks.
// 500 bounds one SQL ANY() list and is twice the largest match the e2e suite measures.
const MAX_BATCH = 500;
// A verify batch also stops at this many bytes of compact JWS: a credential with
// behaviour evidence is about 34 kB, and the verifier takes at most 2 MB on
// /verify/batch (credential-verification VERIFY_BATCH_BODY_LIMIT), so 1 MiB
// leaves room for JSON overhead and larger credentials.
const VERIFY_BATCH_BYTES = 1024 * 1024;

// Consecutive chunks of at most MAX_BATCH calls and maxBytes of key text; a
// single key larger than maxBytes still goes, alone.
function chunksOf(calls, maxBytes) {
  const chunks = [];
  let current = [], bytes = 0;
  for (const call of calls) {
    const size = String(call.key).length;
    if (current.length && (current.length === MAX_BATCH || bytes + size > maxBytes)) { chunks.push(current); current = []; bytes = 0; }
    current.push(call);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Coalesces calls made in the same turn of the event loop into batch calls:
 * the authority dispatcher starts its workers together, so their reads share
 * one request per source instead of one each. A failed batch rejects every
 * call in it, which the caller turns into an uncheckable answer, as before.
 * @param {(keys: string[], options: object) => Promise<unknown[]>} run  answers in key order
 * @param {{ maxBytes?: number }} limits  maxBytes: the most key text one batch call carries
 * @returns {(key: string, options?: object) => Promise<unknown>}
 */
function createBatcher(run, { maxBytes = Infinity } = {}) {
  let pending = [];
  const flush = () => {
    const queued = pending;
    pending = [];
    // One batch per caller's correlation id, so each request's reads stay traceable to it.
    const groups = new Map();
    for (const call of queued) {
      const id = call.options.correlationId ?? '';
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(call);
    }
    for (const group of groups.values()) for (const chunk of chunksOf(group, maxBytes)) {
      run(chunk.map((call) => call.key), chunk[0].options)
        .then((answers) => chunk.forEach((call, index) => call.resolve(answers[index])))
        .catch((error) => chunk.forEach((call) => call.reject(error)));
    }
  };
  return (key, options = {}) => new Promise((resolve, reject) => {
    if (!pending.length) setImmediate(flush);
    pending.push({ key, options, resolve, reject });
  });
}

/** Concurrent identical calls share one request until it settles. */
function coalesce(call, keyOf) {
  const inFlight = new Map();
  return (...args) => {
    const key = keyOf(...args);
    if (!inFlight.has(key)) inFlight.set(key, Promise.resolve().then(() => call(...args)).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  };
}

function createRegistrySource({ baseUrl, timeoutMs } = {}) {
  return {
    async getCurrentFingerprint(agentLearnerKey, options = {}) {
      if (!text(agentLearnerKey)) throw new SourceError('agent-registry', 'contract_violation');
      const body = await requestJson('agent-registry',
        `${baseUrl}/v1/registrations?agentLearnerKey=${encodeURIComponent(agentLearnerKey)}`, { ...options, timeoutMs });
      return body === null ? null : toCurrentFingerprint(body, agentLearnerKey);
    },
  };
}

function createPackageSource({ baseUrl, internalKey, timeoutMs, batch = false } = {}) {
  const source = {
    async getPackage(packageId, version, options = {}) {
      if (!internalKey) throw new SourceError('validation-activation', 'source_not_available');
      if (!text(packageId) || !text(version)) throw new SourceError('validation-activation', 'contract_violation');
      const body = await requestJson('validation-activation',
        `${baseUrl}/packages/${encodeURIComponent(packageId)}?version=${encodeURIComponent(version)}`, { ...options, timeoutMs,
          headers: { 'x-internal-service-key': internalKey, 'x-actor-subject': SERVICE_NAME } });
      return body === null ? null : toPackageAnswer(body, packageId, version);
    },
  };
  // In batch mode candidates that share a package version share its read.
  return batch ? { getPackage: coalesce(source.getPackage, (packageId, version) => `${packageId}@${version}`) } : source;
}

// Blocker 2 (owner Luis): POST /verify registers any credentialId it is given as
// "active", and status lives in memory. So /verify is called with the jws only
// (never a credentialId) and is trusted for signature and schema only; status
// comes from the read-only GET /status/:credentialId. Today that store is empty
// after any restart, so status is indeterminate and the candidate is excluded.
function createVerificationSource({ baseUrl, timeoutMs, batch = false } = {}) {
  if (batch) return createBatchVerificationSource({ baseUrl, timeoutMs });
  async function readStatus(credentialId, options) {
    try {
      const body = await requestJson('credential-verification', `${baseUrl}/status/${encodeURIComponent(credentialId)}`,
        { ...options, timeoutMs });
      return body === null ? 'indeterminate' : toStatus(body, credentialId);
    } catch {
      // An unreachable status service is not knowledge of the status.
      return 'indeterminate';
    }
  }
  return {
    async verify(candidate, options = {}) {
      if (!text(candidate?.compactJws) || !text(candidate?.credentialId))
        throw new SourceError('credential-verification', 'contract_violation');
      const [report, status] = await Promise.all([
        // 422 is the verifier's "INVALID" answer and still carries the per-check report.
        requestJson('credential-verification', `${baseUrl}/verify`, { ...options, timeoutMs,
          method: 'POST', body: { jws: candidate.compactJws }, accept: [200, 422] }),
        readStatus(candidate.credentialId, options),
      ]);
      const parts = report === null ? null : toSignatureAndSchema(report);
      return { signature: parts?.signature ?? null, schema: parts?.schema ?? null, status };
    },
  };
}

// Batch mode: the same answers from POST /verify/batch and POST /status/batch.
function createBatchVerificationSource({ baseUrl, timeoutMs }) {
  const verifyMany = createBatcher(async (jwsList, options) => {
    const body = await requestJson('credential-verification', `${baseUrl}/verify/batch`, { ...options, timeoutMs, method: 'POST', body: { jws: jwsList } });
    if (!Array.isArray(body?.results) || body.results.length !== jwsList.length) throw new SourceError('credential-verification', 'contract_violation');
    return body.results;
  }, { maxBytes: VERIFY_BATCH_BYTES });
  const statusMany = createBatcher(async (ids, options) => {
    const body = await requestJson('credential-verification', `${baseUrl}/status/batch`, { ...options, timeoutMs, method: 'POST', body: { credentialIds: ids } });
    if (!Array.isArray(body?.statuses) || body.statuses.length !== ids.length) throw new SourceError('credential-verification', 'contract_violation');
    return body.statuses;
  });
  return {
    async verify(candidate, options = {}) {
      if (!text(candidate?.compactJws) || !text(candidate?.credentialId))
        throw new SourceError('credential-verification', 'contract_violation');
      const [result, status] = await Promise.all([verifyMany(candidate.compactJws, options),
        // An unreachable status service is not knowledge of the status.
        statusMany(candidate.credentialId, options).catch(() => null)]);
      const parts = [200, 422].includes(result?.httpStatus) ? toSignatureAndSchema(result.report) : null;
      return { signature: parts?.signature ?? null, schema: parts?.schema ?? null,
        status: status?.status ? toStatus({ credentialId: status.credentialId, status: status.status }, candidate.credentialId) : 'indeterminate' };
    },
  };
}

// The issuer's immutable ledger, not possession of a signed credential alone,
// establishes origin. Compare the whole gate projection with the JWS payload as
// well: an event's unsigned copy must never substitute different claims beside
// an otherwise valid JWS. Signature/schema/status remain independent gates.
function toLifecycleOrigin(body, candidate) {
  const origin = body?.origin;
  const fields = ['schemaVersion', 'outcome', 'credentialId', 'decisionId', 'examinationId',
    'subjectId', 'configurationFingerprint', 'credentialDigest'];
  if (body?.apiVersion !== 'v1' || !object(origin) || Object.keys(origin).length !== fields.length ||
      !fields.every((field) => Object.hasOwn(origin, field)) ||
      origin.schemaVersion !== 'certification-origin/1.0.0' || origin.outcome !== 'certified' ||
      ![origin.credentialId, origin.decisionId, origin.examinationId].every((id) => typeof id === 'string' && UUID.test(id)) ||
      !text(origin.subjectId) || !text(origin.configurationFingerprint) ||
      typeof origin.credentialDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(origin.credentialDigest)) return null;
  let vc;
  try { vc = JSON.parse(Buffer.from(candidate.compactJws.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
  const signed = toCandidate({ credentialId: candidate.credentialId, credential: vc, compactJws: candidate.compactJws });
  const decisionId = vc?.evidence?.certificationDecisionId;
  const examinationId = vc?.evidence?.examinationId;
  // Old signed artifacts are never silently given a decision binding.
  if (!signed || typeof decisionId !== 'string' || !UUID.test(decisionId) ||
      typeof examinationId !== 'string' || !UUID.test(examinationId)) return null;
  const credentialDigest = `sha256:${createHash('sha256').update(candidate.compactJws).digest('hex')}`;
  return isDeepStrictEqual(candidate, signed) && origin.credentialId === candidate.credentialId &&
    origin.decisionId === decisionId && origin.examinationId === examinationId &&
    origin.subjectId === signed.agentLearnerKey && origin.configurationFingerprint === signed.configurationFingerprint &&
    origin.credentialDigest === credentialDigest;
}

function createLifecycleSource({ baseUrl, internalKey, timeoutMs, batch = false } = {}) {
  const notFound = Symbol('origin_not_found');
  const headers = { 'x-internal-service-key': internalKey, 'x-actor-subject': SERVICE_NAME, 'x-actor-role': 'marketplace' };
  const originMany = batch && createBatcher(async (ids, options) => {
    const body = await requestJson('certification-service', `${baseUrl}/internal/credential-origins/batch`, {
      ...options, timeoutMs, method: 'POST', body: { credentialIds: ids }, redirect: 'error', headers });
    if (body?.apiVersion !== 'v1' || !Array.isArray(body.origins) || body.origins.length !== ids.length ||
      body.origins.some((entry, index) => entry?.credentialId !== ids[index])) throw new SourceError('certification-service', 'contract_violation');
    return body.origins.map((entry) => entry.origin);
  });
  return {
    async isLifecycleOrigin(candidate, options = {}) {
      if (!baseUrl || !internalKey) throw new SourceError('certification-service', 'source_not_available');
      if (!UUID.test(candidate?.credentialId || '') || !text(candidate?.compactJws))
        throw new SourceError('certification-service', 'contract_violation');
      if (originMany) {
        const origin = await originMany(candidate.credentialId, options);
        if (origin === null) return false;
        const answer = toLifecycleOrigin({ apiVersion: 'v1', origin }, candidate);
        if (answer === null) throw new SourceError('certification-service', 'contract_violation');
        return answer;
      }
      const body = await requestJson('certification-service',
        `${baseUrl}/internal/credential-origins/${encodeURIComponent(candidate.credentialId)}`, {
          ...options, timeoutMs, notFoundValue: notFound, redirect: 'error',
          headers: { 'x-internal-service-key': internalKey, 'x-actor-subject': SERVICE_NAME, 'x-actor-role': 'marketplace' } });
      if (body === notFound) return false;
      const answer = toLifecycleOrigin(body, candidate);
      if (answer === null) throw new SourceError('certification-service', 'contract_violation');
      return answer;
    },
  };
}

module.exports = {
  MAX_BATCH, VERIFY_BATCH_BYTES, withCurrentCandidate, coalesce, createBatcher, SourceError, askSource, toCurrentFingerprint, toPackageAnswer, toSignatureAndSchema, toStatus, toCandidate, toLifecycleOrigin,
  createRegistrySource, createPackageSource, createVerificationSource, createLifecycleSource,
};
