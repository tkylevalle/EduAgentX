'use strict';

// Real authoritative sources over HTTP. Marketplace never reads another
// service's tables. One mapping function per source: any missing or unexpected
// field maps to null, so the matching gate becomes UNCHECKABLE. Never guess.
// A transport failure (refused, 5xx, timeout, not JSON) throws a SourceError,
// which askSource turns into null for that one candidate.

const telemetry = require('../../packages/telemetry');
const { SUPPORTED_DOMAIN, ASSESSMENT_MODES } = require('./capability-request');

const SERVICE_NAME = 'marketplace-service';
const DEFAULT_TIMEOUT_MS = 2000;

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

// The manifest's display name is the only domain text we accept; anything else is unknown.
const DOMAIN_NAMES = Object.freeze({ 'AI Agent Safety and Secure Tool Use': SUPPORTED_DOMAIN });

// GET /packages/:id?version= on validation-activation (the read training-service uses).
function toPackageAnswer(body, packageId, version) {
  if (!object(body) || body.packageId !== packageId || body.version !== version) return null;
  // A quarantined package cannot support a marketplace claim, so it is not an answer we can use.
  if (body.certificationBlocked !== false || !Array.isArray(body.quarantinedScopes) || body.quarantinedScopes.length) return null;
  // The domain may appear on the manifest, at the top level, or both; every copy present must agree.
  const names = [body.manifest?.domain, body.domain].filter((name) => name !== undefined);
  const domain = names.length && names.every((name) => name === names[0]) ? DOMAIN_NAMES[names[0]] ?? null : null;
  const ids = Array.isArray(body.objectives) ? body.objectives.map((objective) => objective?.id) : null;
  const objectiveIds = ids && ids.length && ids.every(text) && new Set(ids).size === ids.length ? ids : null;
  return { digest: text(body.digest) ? body.digest : null, domain, objectiveIds };
}

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
  // expected. INVALID while both parts look fine means a check we do not map failed (time).
  if (report.overall === 'INVALID' && signature === 'valid' && schema === 'valid') schema = 'invalid';
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
    // Decision C: credentials do not record their evidence environment yet.
    environment: null,
    validFrom: instant(vc.validFrom),
    validUntil: instant(vc.validUntil),
    compactJws: text(record.compactJws) && record.compactJws.split('.').length === 3 ? record.compactJws : null,
  };
}

// --- HTTP

// Returns the parsed body for an accepted status, null on 404, and throws otherwise.
async function requestJson(source, url, { method = 'GET', body, headers = {}, accept = [200], correlationId,
  timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SourceError(source, error?.name === 'TimeoutError' ? 'timeout' : 'source_unavailable');
  }
  if (response.status === 404) return null;
  if (!accept.includes(response.status)) throw new SourceError(source, 'source_unavailable');
  try { return await response.json(); } catch { throw new SourceError(source, 'contract_violation'); }
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

function createPackageSource({ baseUrl, internalKey, timeoutMs } = {}) {
  return {
    async getPackage(packageId, version, options = {}) {
      if (!internalKey) throw new SourceError('validation-activation', 'source_not_available');
      if (!text(packageId) || !text(version)) throw new SourceError('validation-activation', 'contract_violation');
      const body = await requestJson('validation-activation',
        `${baseUrl}/packages/${encodeURIComponent(packageId)}?version=${encodeURIComponent(version)}`, { ...options, timeoutMs,
          headers: { 'x-internal-service-key': internalKey, 'x-actor-subject': SERVICE_NAME } });
      return body === null ? null : toPackageAnswer(body, packageId, version);
    },
  };
}

// Blocker 2 (owner Luis): POST /verify registers any credentialId it is given as
// "active", and status lives in memory. So /verify is called with the jws only
// (never a credentialId) and is trusted for signature and schema only; status
// comes from the read-only GET /status/:credentialId. Today that store is empty
// after any restart, so status is indeterminate and the candidate is excluded.
function createVerificationSource({ baseUrl, timeoutMs } = {}) {
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

// TODO(blocker 1, owner Timurmalik): certification-service has no route Marketplace
// may call to confirm a credential came from a real Certification Decision, so
// lifecycle origin is always uncheckable and every candidate is excluded for now.
function createLifecycleSource() {
  return {
    async isLifecycleOrigin() { throw new SourceError('certification-service', 'source_not_available'); },
  };
}

module.exports = {
  SourceError, askSource, toCurrentFingerprint, toPackageAnswer, toSignatureAndSchema, toStatus, toCandidate,
  createRegistrySource, createPackageSource, createVerificationSource, createLifecycleSource,
};
