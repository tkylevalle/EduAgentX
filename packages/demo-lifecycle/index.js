'use strict';

// Drives one Agent Learner through the whole EduAgentX lifecycle using only
// public, authenticated routes: the Gateway for operators and the Synthetic
// Agent Learner's own HTTP API for the agent. Nothing here grades, finalizes
// or issues anything itself; each step only asks the service that owns it and
// records what that service answered.
//
// Used by scripts/poc-lifecycle.js (CLI evidence run) and by the web app's
// server (live demonstration). Operator credentials stay server-side. It
// never reviews a package: activation waits for two people's reviews,
// submitted in the governance console (assurance audit C3).

const { randomUUID } = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 20_000;
const CERTIFICATION_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;
const MAX_TRAINING_ROUNDS = 5;
// The live learner asks a real model for every item, so its calls take longer.
const LIVE_SCENARIO = 'live-model';
const LIVE_TRAINING_TIMEOUT_MS = 240_000;
const LIVE_EXAM_TIMEOUT_MS = 420_000;
const isLive = (scenario) => scenario === LIVE_SCENARIO;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STEPS = Object.freeze([
  { id: 'package', title: 'Activate Domain Assurance Package', owner: 'curriculum-engine · validation-activation' },
  { id: 'register', title: 'Register Agent Learner', owner: 'api-gateway · agent-registry' },
  { id: 'train', title: 'Complete Training Session', owner: 'training-service' },
  { id: 'examine', title: 'Sit standard Examination', owner: 'examination-engine · grading-service' },
  { id: 'certify', title: 'Certification Decision and credential', owner: 'certification-service' },
  { id: 'verify', title: 'Verify Competency Credential', owner: 'credential-verification' },
  { id: 'status', title: 'Suspend, re-verify and reinstate', owner: 'credential-verification' },
  { id: 'monitor', title: 'Monitoring and marketplace projection', owner: 'monitoring-service · marketplace-service' },
]);

class LifecycleError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function createLifecycleDriver({ gatewayUrl, syntheticUrl, validationUrl, curriculumInternalKey,
  admin, candidate, examScenario = 'safe-escalation', fetchImpl = fetch } = {}) {
  if (!gatewayUrl || !syntheticUrl || !admin?.clientId || !admin?.clientSecret) {
    throw new TypeError('gatewayUrl, syntheticUrl and admin credentials are required');
  }
  const tokens = new Map();
  // Training and the examination run in the candidate's domain, so a stack with
  // several Active domains never has to guess which one is meant.
  const inDomain = candidate?.manifest?.domainId ? { domainId: candidate.manifest.domainId } : {};

  async function http(url, { method = 'GET', token, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const response = await fetchImpl(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: 'invalid_json' }; }
    return { status: response.status, data };
  }

  async function token({ clientId, clientSecret }) {
    const cached = tokens.get(clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const reply = await http(`${gatewayUrl}/v1/auth/tokens`, { method: 'POST', body: { clientId, clientSecret } });
    if (reply.status !== 200) throw new LifecycleError('authentication_failed', { status: reply.status });
    tokens.set(clientId, { value: reply.data.accessToken, expiresAt: Date.now() + Math.max(0, (reply.data.expiresIn - 60) * 1000) });
    return reply.data.accessToken;
  }
  const adminToken = () => token(admin);

  // The Active package of the candidate's domain (or the only Active one).
  async function activePackage() {
    if (!validationUrl || !curriculumInternalKey) return null;
    const domain = candidate?.manifest?.domainId;
    const reply = await http(`${validationUrl}/packages/active${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`, {
      headers: { 'x-internal-service-key': curriculumInternalKey, 'x-actor-subject': 'demo-lifecycle' } });
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new LifecycleError('active_package_unavailable', { status: reply.status });
    return reply.data;
  }

  // Reuses the Active package of the candidate's domain. Otherwise it ingests
  // the candidate under its own id and version (idempotent), runs the six
  // gates once, and activates it only when two people have already approved
  // that exact version in the governance console. Until then the run stops at
  // this step with the package's review state, so nobody mistakes an
  // unreviewed package for an approved one.
  async function ensurePackage() {
    const existing = await activePackage();
    if (existing) {
      // Who approved the package the run will use, so a reused package is never taken on trust.
      const detail = await http(`${gatewayUrl}/v1/admin/curriculum/packages/${encodeURIComponent(existing.packageId)}/${encodeURIComponent(existing.version)}`,
        { token: await adminToken() });
      return { reused: true, packageId: existing.packageId, version: existing.version, digest: existing.digest,
        domain: existing.manifest?.domain || existing.domain || null, moduleCount: existing.modules?.length ?? null,
        reviews: detail.status === 200 ? (detail.data.reviews || []).map((review) => ({ reviewer: review.reviewer_id, score: review.score, approved: review.approved })) : null };
    }
    if (!candidate) throw new LifecycleError('no_candidate_package');
    const auth = await adminToken();
    const id = candidate.manifest.packageId, version = candidate.manifest.version;
    const read = () => http(`${gatewayUrl}/v1/admin/curriculum/packages/${encodeURIComponent(id)}/${encodeURIComponent(version)}`, { token: auth });
    let stored = await read();
    if (stored.status === 404) {
      const ingested = await http(`${gatewayUrl}/v1/admin/curriculum/packages`, { method: 'POST', token: auth, body: candidate });
      if (![200, 201].includes(ingested.status)) throw new LifecycleError('ingestion_failed', { status: ingested.status, error: ingested.data.error });
      stored = await read();
    }
    if (stored.status !== 200) throw new LifecycleError('package_unavailable', { status: stored.status });
    let gates = null;
    if (stored.data.state === 'Candidate') {
      const validated = await http(`${gatewayUrl}/v1/admin/curriculum/validate`, { method: 'POST', token: auth, body: { package_id: id, version } });
      if (validated.status !== 200 || !validated.data.passed) throw new LifecycleError('validation_failed', { status: validated.status, gates: validated.data.gates });
      gates = validated.data.gates.map((gate) => gate.name);
      stored = await read();
    }
    const reviews = (stored.data.reviews || []).map((review) => ({ reviewer: review.reviewer_id, score: review.score, approved: review.approved }));
    const activated = await http(`${gatewayUrl}/v1/admin/curriculum/activate`, { method: 'POST', token: auth, body: { package_id: id, version } });
    if (activated.status !== 200) {
      throw new LifecycleError('package_awaiting_review', { packageId: id, version, state: stored.data.state, reviews,
        openDisagreements: stored.data.openDisagreements || [], reason: activated.data.error });
    }
    return { reused: false, packageId: id, version, digest: stored.data.digest, domain: candidate.manifest.domain, gates, reviews,
      moduleCount: candidate.modules?.length ?? null };
  }

  async function register(scenario = examScenario) {
    const reply = await http(`${syntheticUrl}/v1/runs`, { method: 'POST',
      body: { profileId: 'competent', ...(isLive(scenario) ? { learner: 'live' } : {}) } });
    if (reply.status !== 200 || !reply.data.registration) {
      throw new LifecycleError('registration_failed', { status: reply.status, reason: reply.data.reason });
    }
    const registration = reply.data.registration;
    return { agentLearnerKey: registration.agentLearnerKey, agentLearnerId: registration.agentLearnerId,
      configurationVersion: registration.configurationVersion, configurationFingerprint: registration.configurationFingerprint,
      model: reply.data.live?.model || null, outcome: reply.data.outcome, evidence: reply.data.evidence?.label };
  }

  async function train(scenario = examScenario) {
    const live = isLive(scenario);
    let resumeSessionId, completed = [];
    const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
    for (let round = 0; round < MAX_TRAINING_ROUNDS; round += 1) {
      const reply = await http(`${syntheticUrl}/v1/training-runs`, { method: 'POST',
        body: { maxItems: 20, ...(resumeSessionId ? { resumeSessionId } : {}), ...(live ? { learner: 'live' } : {}), ...inDomain },
        ...(live ? { timeoutMs: LIVE_TRAINING_TIMEOUT_MS } : {}) });
      if (reply.status !== 200) throw new LifecycleError('training_failed', { status: reply.status, reason: reply.data.reason });
      completed = completed.concat(reply.data.completedItems || []);
      for (const key of Object.keys(usage)) usage[key] += reply.data.live?.[key] || 0;
      resumeSessionId = reply.data.sessionId;
      if (reply.data.outcome === 'completed') {
        // Training starts an assigned remediation session in place of a
        // standard one; the admin view says which kind this was.
        const view = await http(`${gatewayUrl}/v1/admin/training-sessions/${resumeSessionId}`, { token: await adminToken() });
        const session = view.data?.session || {};
        return { sessionId: resumeSessionId, kind: session.kind || 'standard',
          remediationObjectiveIds: session.remediation?.objectiveIds || [], itemsDelivered: completed.length,
          modules: [...new Set(completed.map((item) => item.moduleId))], modelWeightsModified: false,
          ...(live ? { live: { ...usage, model: reply.data.live?.model || null } } : {}) };
      }
      if (reply.data.outcome !== 'open') throw new LifecycleError('training_failed', { reason: reply.data.reason });
    }
    throw new LifecycleError('training_incomplete', { sessionId: resumeSessionId });
  }

  async function examine(scenario = examScenario) {
    const reply = await http(`${syntheticUrl}/v1/exam-runs`, { method: 'POST', body: { scenarioId: scenario, ...inDomain },
      timeoutMs: isLive(scenario) ? LIVE_EXAM_TIMEOUT_MS : 120_000 });
    if (reply.status !== 200 || !reply.data.attempt) {
      throw new LifecycleError('examination_failed', { status: reply.status, outcome: reply.data.outcome, reason: reply.data.reason });
    }
    const auth = await adminToken();
    const view = await http(`${gatewayUrl}/v1/admin/examinations/${reply.data.attempt.attemptId}`, { token: auth });
    const assessment = view.data.attempt?.assessment || null;
    return { attemptId: reply.data.attempt.attemptId, status: reply.data.attempt.status,
      terminalReason: reply.data.attempt.terminalReason || null, itemsAnswered: reply.data.answered.length,
      scenario, overallPercent: assessment?.overallPercent ?? null,
      tierPercents: assessment?.tierPercents ?? null, criticalViolationRuleIds: assessment?.criticalViolationRuleIds ?? [],
      failureReasons: assessment?.failureReasons ?? [],
      passed: reply.data.attempt.status === 'complete', evidence: reply.data.evidence?.label || null,
      ...(reply.data.live ? { live: reply.data.live } : {}) };
  }

  // How many credentials Certification holds for one examination, from its
  // own store (Gateway reconciliation route): 0 or 1 when issuance is correct.
  async function credentialCount(examinationId) {
    const reply = await http(`${gatewayUrl}/v1/admin/reconciliation/credentials?examinationId=${encodeURIComponent(examinationId)}`,
      { token: await adminToken() });
    if (reply.status !== 200 || !Number.isInteger(reply.data.count)) {
      throw new LifecycleError('reconciliation_unavailable', { status: reply.status });
    }
    return reply.data.count;
  }

  async function certify(attemptId) {
    const auth = await adminToken();
    const deadline = Date.now() + CERTIFICATION_WAIT_MS;
    while (Date.now() < deadline) {
      const reply = await http(`${gatewayUrl}/v1/admin/certifications/by-examination/${attemptId}`, { token: auth });
      if (reply.status === 200) {
        const credential = reply.data.credential;
        return { decision: reply.data.decision.outcome, decidedAt: reply.data.decision.decidedAt,
          credentialId: credential.credentialId, issuedAt: credential.issuedAt, keyId: credential.keyId,
          issuer: credential.credential.issuer, validUntil: credential.credential.validUntil, compactJws: credential.compactJws };
      }
      if (reply.status !== 404) throw new LifecycleError('certification_unavailable', { status: reply.status });
      await sleep(POLL_INTERVAL_MS);
    }
    throw new LifecycleError('certification_timeout', { attemptId });
  }

  async function verify(compactJws) {
    const auth = await adminToken();
    // Status registration is delivered by the certification outbox; give it a moment.
    let status = null;
    for (let tries = 0; tries < 10; tries += 1) {
      const reply = await http(`${gatewayUrl}/v1/credentials/verify`, { method: 'POST', token: auth, body: { jws: compactJws } });
      if (reply.data.overall === 'VALID' || reply.data.overall === 'INVALID') return reply.data;
      // A refused request will not succeed on retry; INDETERMINATE (200) may.
      if (reply.status >= 400 && reply.status < 500 && reply.status !== 422) {
        throw new LifecycleError('verification_refused', { status: reply.status, error: reply.data.error });
      }
      status = reply.status;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new LifecycleError('verification_indeterminate', { status });
  }

  async function changeStatus(credentialId, action, reason, agentLearnerKey) {
    const reply = await http(`${gatewayUrl}/v1/admin/credentials/${credentialId}/${action}`, { method: 'POST',
      token: await adminToken(), body: { reason, agentLearnerKey } });
    if (reply.status !== 200) throw new LifecycleError(`${action}_failed`, { status: reply.status, error: reply.data.error });
    return reply.data;
  }

  // The step proves both directions: a suspended credential must verify as
  // INVALID and a reinstated one as VALID again. If anything fails while the
  // credential is suspended, it is reinstated so the run leaves no trace.
  async function statusCycle(credential, agentLearnerKey) {
    const id = credential.credentialId;
    await changeStatus(id, 'suspend', 'PoC demonstration: reversible suspension', agentLearnerKey);
    let reinstated;
    let whileSuspended;
    try {
      whileSuspended = await verify(credential.compactJws);
      if (whileSuspended.overall !== 'INVALID') {
        throw new LifecycleError('suspension_not_enforced', { overall: whileSuspended.overall });
      }
      reinstated = await changeStatus(id, 'reinstate', 'PoC demonstration: suspension cleared', agentLearnerKey);
    } catch (error) {
      // Restore the credential before reporting the failure; if that also
      // fails, the error says so instead of hiding it.
      await changeStatus(id, 'reinstate', 'PoC demonstration: restored after a failed check', agentLearnerKey)
        .catch((restore) => { error.detail = { ...(error.detail || {}), restoreFailed: restore.code || restore.name }; });
      throw error;
    }
    const afterReinstate = await verify(credential.compactJws);
    if (afterReinstate.overall !== 'VALID') {
      throw new LifecycleError('reinstatement_not_enforced', { overall: afterReinstate.overall });
    }
    return { whileSuspended: { overall: whileSuspended.overall, reasonCodes: whileSuspended.reasonCodes },
      afterReinstate: { overall: afterReinstate.overall, reasonCodes: afterReinstate.reasonCodes },
      history: reinstated.history };
  }

  // Monitoring is fed by best-effort events, so the projection may trail the
  // last status change by a moment; wait briefly for the expected posture.
  async function monitor(agentLearnerKey, expectedPosture = 'VERIFIED') {
    const auth = await adminToken();
    let posture = null;
    for (let tries = 0; tries < 5; tries += 1) {
      const snapshot = await http(`${gatewayUrl}/v1/admin/monitoring/snapshot`, { token: auth });
      posture = snapshot.data.assurancePosture?.[agentLearnerKey] || null;
      if (posture?.assurancePosture === expectedPosture) break;
      await sleep(POLL_INTERVAL_MS / 2);
    }
    const listing = await http(`${gatewayUrl}/v1/marketplace/listings/${encodeURIComponent(agentLearnerKey)}`, { token: auth });
    return { assurancePosture: posture?.assurancePosture || 'INDETERMINATE', lastEvent: posture?.lastEvent?.type || null,
      marketplaceListing: listing.status === 200 ? listing.data : { status: listing.status, error: listing.data.error } };
  }

  // Runs every step in order. onStep receives a record when a step starts and
  // when it ends, so a UI can show progress live.
  async function run({ onStep = () => {}, statusDemo = true, scenario = examScenario } = {}) {
    const results = {};
    const report = { runId: randomUUID(), startedAt: new Date().toISOString(), status: 'running', steps: [] };
    const step = async (id, action) => {
      const meta = STEPS.find((entry) => entry.id === id);
      const started = Date.now();
      onStep({ ...meta, status: 'running', startedAt: new Date(started).toISOString() });
      try {
        const detail = await action();
        const record = { ...meta, status: 'passed', durationMs: Date.now() - started, detail };
        report.steps.push(record); onStep(record);
        return detail;
      } catch (error) {
        // Only lifecycle errors carry a code and detail meant for display; any
        // other failure is reported by its kind alone (ECONNREFUSED,
        // TimeoutError), never by a message that may name internal hosts.
        const known = error instanceof LifecycleError;
        const record = { ...meta, status: 'failed', durationMs: Date.now() - started,
          error: known ? error.code : 'step_failed', detail: known ? error.detail : { kind: error.cause?.code || error.name || 'Error' } };
        report.steps.push(record); onStep(record);
        throw error;
      }
    };
    try {
      results.package = await step('package', ensurePackage);
      results.register = await step('register', () => register(scenario));
      results.train = await step('train', () => train(scenario));
      results.examine = await step('examine', async () => {
        const exam = await examine(scenario);
        if (!exam.passed) throw new LifecycleError('agent_failed_examination', exam);
        return exam;
      });
      results.certify = await step('certify', () => certify(results.examine.attemptId));
      results.verify = await step('verify', async () => {
        const report = await verify(results.certify.compactJws);
        if (report.overall !== 'VALID') throw new LifecycleError('credential_not_valid', report);
        return report;
      });
      if (statusDemo) results.status = await step('status', () => statusCycle(results.certify, results.register.agentLearnerKey));
      results.monitor = await step('monitor', () => monitor(results.register.agentLearnerKey));
      report.status = 'passed';
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof LifecycleError ? error.code : 'step_failed';
    }
    report.completedAt = new Date().toISOString();
    report.results = results;
    return report;
  }

  return { run, ensurePackage, register, train, examine, certify, credentialCount, verify, changeStatus, statusCycle, monitor, activePackage };
}

module.exports = { createLifecycleDriver, LifecycleError, STEPS, LIVE_SCENARIO };
