'use strict';

// Drives one Agent Learner through the whole EduAgentX lifecycle using only
// public, authenticated routes: the Gateway for operators and the Synthetic
// Agent Learner's own HTTP API for the agent. Nothing here grades, finalizes
// or issues anything itself; each step only asks the service that owns it and
// records what that service answered.
//
// Used by scripts/poc-lifecycle.js (CLI evidence run) and by the web app's
// server (live demonstration). Operator credentials stay server-side.

const { randomUUID } = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 20_000;
const CERTIFICATION_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;
const MAX_TRAINING_ROUNDS = 5;

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
  admin, reviewers = [], candidate, examScenario = 'safe-escalation', fetchImpl = fetch } = {}) {
  if (!gatewayUrl || !syntheticUrl || !admin?.clientId || !admin?.clientSecret) {
    throw new TypeError('gatewayUrl, syntheticUrl and admin credentials are required');
  }
  const tokens = new Map();

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
    if (reply.status !== 200) throw new LifecycleError('authentication_failed', { clientId, status: reply.status });
    tokens.set(clientId, { value: reply.data.accessToken, expiresAt: Date.now() + Math.max(0, (reply.data.expiresIn - 60) * 1000) });
    return reply.data.accessToken;
  }
  const adminToken = () => token(admin);

  async function activePackage() {
    if (!validationUrl || !curriculumInternalKey) return null;
    const reply = await http(`${validationUrl}/packages/active`, {
      headers: { 'x-internal-service-key': curriculumInternalKey, 'x-actor-subject': 'demo-lifecycle' } });
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new LifecycleError('active_package_unavailable', { status: reply.status });
    return reply.data;
  }

  // Reuses the active package when one exists; otherwise ingests the
  // reference candidate and takes it through six gates, two distinct
  // reviews and activation.
  async function ensurePackage() {
    const existing = await activePackage();
    if (existing) {
      return { reused: true, packageId: existing.packageId, version: existing.version, digest: existing.digest,
        domain: existing.manifest?.domain || existing.domain || null, moduleCount: existing.modules?.length ?? null };
    }
    if (!candidate) throw new LifecycleError('no_candidate_package');
    if (reviewers.length < 2) throw new LifecycleError('two_reviewers_required');
    const auth = await adminToken();
    const pkg = structuredClone(candidate);
    pkg.manifest.packageId = `ai-safety-demo-${randomUUID().slice(0, 8)}`;
    const id = pkg.manifest.packageId, version = pkg.manifest.version;
    const ingested = await http(`${gatewayUrl}/v1/admin/curriculum/packages`, { method: 'POST', token: auth, body: pkg });
    if (ingested.status !== 201) throw new LifecycleError('ingestion_failed', { status: ingested.status, error: ingested.data.error });
    const validated = await http(`${gatewayUrl}/v1/admin/curriculum/validate`, { method: 'POST', token: auth,
      body: { package_id: id, version } });
    if (validated.status !== 200 || !validated.data.passed) {
      throw new LifecycleError('validation_failed', { status: validated.status, gates: validated.data.gates });
    }
    const reviews = [];
    for (const [index, reviewer] of reviewers.slice(0, 2).entries()) {
      const reviewed = await http(`${gatewayUrl}/v1/curriculum/review`, { method: 'POST', token: await token(reviewer),
        body: { package_id: id, version, reviewer_id: reviewer.clientId, score: index ? 4.5 : 4, approved: true } });
      if (reviewed.status !== 200) throw new LifecycleError('review_failed', { status: reviewed.status, error: reviewed.data.error });
      reviews.push({ reviewer: reviewer.clientId, approvals: reviewed.data.approvals });
    }
    const activated = await http(`${gatewayUrl}/v1/admin/curriculum/activate`, { method: 'POST', token: auth,
      body: { package_id: id, version } });
    if (activated.status !== 200) throw new LifecycleError('activation_failed', { status: activated.status, error: activated.data.error });
    return { reused: false, packageId: id, version, digest: ingested.data.digest, domain: pkg.manifest.domain,
      gates: validated.data.gates.map((gate) => gate.name), reviews, moduleCount: pkg.modules?.length ?? null };
  }

  async function register() {
    const reply = await http(`${syntheticUrl}/v1/runs`, { method: 'POST', body: { profileId: 'competent' } });
    if (reply.status !== 200 || !reply.data.registration) {
      throw new LifecycleError('registration_failed', { status: reply.status, reason: reply.data.reason });
    }
    const registration = reply.data.registration;
    return { agentLearnerKey: registration.agentLearnerKey, agentLearnerId: registration.agentLearnerId,
      configurationVersion: registration.configurationVersion, configurationFingerprint: registration.configurationFingerprint,
      outcome: reply.data.outcome, evidence: reply.data.evidence?.label };
  }

  async function train() {
    let resumeSessionId, completed = [];
    for (let round = 0; round < MAX_TRAINING_ROUNDS; round += 1) {
      const reply = await http(`${syntheticUrl}/v1/training-runs`, { method: 'POST',
        body: { maxItems: 20, ...(resumeSessionId ? { resumeSessionId } : {}) } });
      if (reply.status !== 200) throw new LifecycleError('training_failed', { status: reply.status, reason: reply.data.reason });
      completed = completed.concat(reply.data.completedItems || []);
      resumeSessionId = reply.data.sessionId;
      if (reply.data.outcome === 'completed') {
        return { sessionId: resumeSessionId, itemsDelivered: completed.length,
          modules: [...new Set(completed.map((item) => item.moduleId))], modelWeightsModified: false };
      }
      if (reply.data.outcome !== 'open') throw new LifecycleError('training_failed', { reason: reply.data.reason });
    }
    throw new LifecycleError('training_incomplete', { sessionId: resumeSessionId });
  }

  async function examine() {
    const reply = await http(`${syntheticUrl}/v1/exam-runs`, { method: 'POST', body: { scenarioId: examScenario },
      timeoutMs: 120_000 });
    if (reply.status !== 200 || !reply.data.attempt) {
      throw new LifecycleError('examination_failed', { status: reply.status, outcome: reply.data.outcome, reason: reply.data.reason });
    }
    const auth = await adminToken();
    const view = await http(`${gatewayUrl}/v1/admin/examinations/${reply.data.attempt.attemptId}`, { token: auth });
    const assessment = view.data.attempt?.assessment || null;
    return { attemptId: reply.data.attempt.attemptId, status: reply.data.attempt.status,
      terminalReason: reply.data.attempt.terminalReason || null, itemsAnswered: reply.data.answered.length,
      scenario: examScenario, overallPercent: assessment?.overallPercent ?? null,
      tierPercents: assessment?.tierPercents ?? null, criticalViolationRuleIds: assessment?.criticalViolationRuleIds ?? [],
      passed: reply.data.attempt.status === 'complete' };
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
    for (let tries = 0; tries < 10; tries += 1) {
      const reply = await http(`${gatewayUrl}/v1/credentials/verify`, { method: 'POST', token: auth, body: { jws: compactJws } });
      if (reply.data.overall === 'VALID' || reply.data.overall === 'INVALID') return reply.data;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new LifecycleError('verification_indeterminate');
  }

  async function changeStatus(credentialId, action, reason, agentLearnerKey) {
    const reply = await http(`${gatewayUrl}/v1/admin/credentials/${credentialId}/${action}`, { method: 'POST',
      token: await adminToken(), body: { reason, agentLearnerKey } });
    if (reply.status !== 200) throw new LifecycleError(`${action}_failed`, { status: reply.status, error: reply.data.error });
    return reply.data;
  }

  async function statusCycle(credential, agentLearnerKey) {
    await changeStatus(credential.credentialId, 'suspend', 'PoC demonstration: reversible suspension', agentLearnerKey);
    const whileSuspended = await verify(credential.compactJws);
    const reinstated = await changeStatus(credential.credentialId, 'reinstate', 'PoC demonstration: suspension cleared', agentLearnerKey);
    const afterReinstate = await verify(credential.compactJws);
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
  async function run({ onStep = () => {}, statusDemo = true } = {}) {
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
        const record = { ...meta, status: 'failed', durationMs: Date.now() - started,
          error: error.code || error.message, detail: error.detail || null };
        report.steps.push(record); onStep(record);
        throw error;
      }
    };
    try {
      results.package = await step('package', ensurePackage);
      results.register = await step('register', register);
      results.train = await step('train', train);
      results.examine = await step('examine', async () => {
        const exam = await examine();
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
      report.error = error.code || error.message;
    }
    report.completedAt = new Date().toISOString();
    report.results = results;
    return report;
  }

  return { run, ensurePackage, register, train, examine, certify, verify, changeStatus, monitor, activePackage };
}

module.exports = { createLifecycleDriver, LifecycleError, STEPS };
