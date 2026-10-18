'use strict';

// EduAgentX web app server. It serves the built client and a small read/act
// API over the platform's public Gateway. Every credential (admin, reviewers,
// curriculum key) stays here; the browser only ever sees answer-free,
// operator-level projections.

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { createLifecycleDriver, STEPS } = require('../../packages/demo-lifecycle');

const PORT = Number(process.env.PORT || 4300);
const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';
const SYNTHETIC_URL = process.env.SYNTHETIC_AGENT_URL || 'http://synthetic-agent-learner:4200';
const VALIDATION_URL = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010';
const REQUEST_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 1500;
const REMEDIATION_WAIT_MS = 15_000;
const REMEDIATION_POLL_MS = 500;
const HEARTBEAT_MS = 10_000;
const STATUS_ACTIONS = ['suspend', 'reinstate', 'revoke'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The platform's services, in lifecycle order, with the issue that built each.
const SERVICES = [
  { id: 'api-gateway', name: 'API Gateway', url: 'http://api-gateway:4000', layer: 'edge', issue: 3 },
  { id: 'agent-registry', name: 'Agent Registry', url: 'http://agent-registry:4001', layer: 'identity', issue: 4 },
  { id: 'synthetic-agent-learner', name: 'Synthetic Agent Learner', url: 'http://synthetic-agent-learner:4200', layer: 'learner', issue: 5 },
  { id: 'curriculum-engine', name: 'Curriculum Engine', url: 'http://curriculum-engine:4002', layer: 'curriculum', issue: 9 },
  { id: 'validation-activation', name: 'Validation & Activation', url: 'http://validation-activation:4010', layer: 'curriculum', issue: 10 },
  { id: 'curriculum-index', name: 'Curriculum Index', url: 'http://curriculum-index:4003', layer: 'curriculum', issue: 11 },
  { id: 'training-service', name: 'Training Service', url: 'http://training-service:4004', layer: 'training', issue: 12 },
  { id: 'examination-engine', name: 'Examination Engine', url: 'http://examination-engine:4005', layer: 'assessment', issue: 16 },
  { id: 'grading-service', name: 'Grading Service', url: 'http://grading-service:4020', layer: 'assessment', issue: 18 },
  { id: 'certification-service', name: 'Certification Service', url: 'http://certification-service:4011', layer: 'trust', issue: 23 },
  { id: 'credential-verification', name: 'Credential Verification', url: 'http://credential-verification:4030', layer: 'trust', issue: 24 },
  { id: 'monitoring-service', name: 'Monitoring Service', url: 'http://monitoring-service:4040', layer: 'operations', issue: 25 },
  { id: 'evidence-bundle', name: 'Evidence Bundle', url: 'http://evidence-bundle:4050', layer: 'operations', issue: 28 },
  { id: 'marketplace-service', name: 'Marketplace Service', url: 'http://marketplace-service:4012', layer: 'marketplace', issue: 30 },
];

// The reference candidate package, used only when no package is active yet.
function loadCandidate() {
  const file = path.join(__dirname, '..', 'curriculum-engine', 'examples', 'ai-safety-candidate.js');
  return fs.existsSync(file) ? require(file) : null;
}

function createServer({ env = process.env, fetchImpl = fetch, driver } = {}) {
  const admin = { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET };
  const reviewers = [1, 2].map((index) => ({ clientId: env[`REVIEWER_${index}_CLIENT_ID`], clientSecret: env[`REVIEWER_${index}_CLIENT_SECRET`] }))
    .filter((reviewer) => reviewer.clientId && reviewer.clientSecret);
  const lifecycle = driver || createLifecycleDriver({ gatewayUrl: GATEWAY_URL, syntheticUrl: SYNTHETIC_URL,
    validationUrl: VALIDATION_URL, curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY, admin, reviewers,
    candidate: loadCandidate(), fetchImpl });
  let token = null;
  let tokenExpiresAt = 0;
  let runInProgress = false;

  async function call(url, { method = 'GET', body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const response = await fetchImpl(url, { method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    return { status: response.status, data };
  }

  async function adminToken() {
    if (token && Date.now() < tokenExpiresAt) return token;
    const reply = await call(`${GATEWAY_URL}/v1/auth/tokens`, { method: 'POST', body: admin });
    if (reply.status !== 200) throw Object.assign(new Error('gateway_authentication_failed'), { status: 503 });
    token = reply.data.accessToken;
    tokenExpiresAt = Date.now() + Math.max(0, (reply.data.expiresIn - 60) * 1000);
    return token;
  }

  const gateway = async (route, options = {}) => call(`${GATEWAY_URL}${route}`,
    { ...options, headers: { authorization: `Bearer ${await adminToken()}`, ...(options.headers || {}) } });

  // Reads tolerate one failing source: each section reports its own availability.
  const settle = async (promise) => {
    try { const reply = await promise; return reply.status === 200 ? reply.data : { unavailable: true, status: reply.status }; }
    catch { return { unavailable: true }; }
  };

  // The examination outbox delivers the remediation to Training a moment
  // after the failure. Holding the run lock until then means the next run
  // always finds the assigned remediation session.
  async function awaitRemediationDelivery(attemptId) {
    const deadline = Date.now() + REMEDIATION_WAIT_MS;
    for (;;) {
      const reply = await settle(gateway(`/v1/admin/examinations/${attemptId}/remediation`));
      const delivered = !reply.unavailable && reply.trace?.remediation?.delivery;
      if (delivered || Date.now() >= deadline) return reply.unavailable ? null : reply;
      await new Promise((resolve) => setTimeout(resolve, REMEDIATION_POLL_MS));
    }
  }

  async function healthMap() {
    return Promise.all(SERVICES.map(async (service) => {
      const started = Date.now();
      try {
        const reply = await call(`${service.url}/health`, { timeoutMs: HEALTH_TIMEOUT_MS });
        return { ...service, url: undefined, healthy: reply.status === 200, latencyMs: Date.now() - started };
      } catch {
        return { ...service, url: undefined, healthy: false, latencyMs: null };
      }
    }));
  }

  async function activePackage() {
    const pkg = await lifecycle.activePackage();
    if (!pkg) return null;
    return {
      packageId: pkg.packageId, version: pkg.version, digest: pkg.digest, state: pkg.state,
      certificationBlocked: pkg.certificationBlocked, quarantinedScopes: pkg.quarantinedScopes,
      track: pkg.curriculumTrack,
      modules: (pkg.modules || []).map((module) => ({ id: module.id, title: module.title,
        sources: [...new Set((module.claims || []).map((claim) => claim.sourceId))] })),
      objectives: (pkg.objectives || []).map((objective) => ({ id: objective.id, statement: objective.statement,
        safetyCritical: objective.safetyCritical, moduleIds: objective.moduleIds })),
      sources: (pkg.sources || []).map((source) => ({ id: source.id, title: source.title, issuer: source.issuer,
        edition: source.edition, canonicalUrl: source.canonicalUrl })),
      exam: { id: pkg.examTemplate?.id, slots: (pkg.examTemplate?.slots || []).map((slot) => ({ id: slot.id, tier: slot.tier })),
        overallPassPercent: pkg.examTemplate?.overallPassPercent, adversarialPassPercent: pkg.examTemplate?.adversarialPassPercent },
      rubric: { id: pkg.rubric?.id, version: pkg.rubric?.version,
        criteria: (pkg.rubric?.criteria || []).map((criterion) => ({ id: criterion.id, weight: criterion.weight })) },
      gates: (pkg.evidence || []).filter((entry) => entry.event === 'validation_run').slice(-1)[0]?.result?.gates || [],
    };
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '80kb' }));

  app.get('/api/health', async (req, res) => res.json({ services: await healthMap(), checkedAt: new Date().toISOString() }));

  app.get('/api/overview', async (req, res) => {
    const [services, certifications, kpi, training, monitoring, pkg] = await Promise.all([
      healthMap(),
      settle(gateway('/v1/admin/certifications?limit=50')),
      settle(gateway('/v1/admin/certifications/kpi')),
      settle(gateway('/v1/admin/training-metrics')),
      settle(gateway('/v1/admin/monitoring/snapshot')),
      activePackage().catch(() => ({ unavailable: true })),
    ]);
    res.json({
      services,
      certifications: certifications.unavailable ? certifications : (certifications.credentials || []).map(({ compactJws, ...rest }) => rest),
      issuanceKpi: kpi,
      training: training.unavailable ? training : { sessions: training.sessions, counts: training.counts,
        completionRate: training.completionRate, byKind: training.byKind },
      posture: monitoring.unavailable ? monitoring : Object.values(monitoring.assurancePosture || {}),
      events: monitoring.unavailable ? [] : (monitoring.recentEvents || []),
      package: pkg,
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/package', async (req, res) => {
    try { res.json({ package: await activePackage() }); }
    catch { res.status(503).json({ error: 'package_unavailable' }); }
  });

  app.get('/api/credentials', async (req, res) => {
    try {
      const reply = await gateway('/v1/admin/certifications?limit=100');
      if (reply.status !== 200) return res.status(reply.status).json({ error: reply.data.error || 'certification_unavailable' });
      const credentials = await Promise.all((reply.data.credentials || []).map(async (credential) => {
        const status = await settle(gateway(`/v1/credentials/${credential.credentialId}/status`));
        return { ...credential, status: status.unavailable ? 'indeterminate' : status.status, history: status.history || [] };
      }));
      res.json({ credentials });
    } catch { res.status(503).json({ error: 'certification_unavailable' }); }
  });

  app.post('/api/verify', async (req, res) => {
    const jws = req.body?.jws;
    if (typeof jws !== 'string' || !jws.trim() || jws.length > 60000) return res.status(400).json({ error: 'jws_required' });
    try {
      const reply = await gateway('/v1/credentials/verify', { method: 'POST', body: { jws: jws.trim() } });
      let credential = null;
      try { credential = JSON.parse(Buffer.from(jws.trim().split('.')[1] || '', 'base64url').toString('utf8')); } catch { credential = null; }
      res.status(reply.status === 422 ? 200 : reply.status).json({ report: reply.data, credential });
    } catch { res.status(503).json({ error: 'verification_unavailable' }); }
  });

  app.post('/api/credentials/:credentialId/:action', async (req, res) => {
    const { credentialId, action } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!UUID.test(credentialId) || !STATUS_ACTIONS.includes(action) || !reason) return res.status(400).json({ error: 'invalid_request' });
    try {
      const reply = await gateway(`/v1/admin/credentials/${credentialId}/${action}`, { method: 'POST',
        body: { reason: reason.slice(0, 400), ...(req.body.agentLearnerKey ? { agentLearnerKey: String(req.body.agentLearnerKey) } : {}) } });
      res.status(reply.status).json(reply.data);
    } catch { res.status(503).json({ error: 'verification_unavailable' }); }
  });

  app.get('/api/examinations/:attemptId', async (req, res) => {
    if (!UUID.test(req.params.attemptId)) return res.status(400).json({ error: 'invalid_request' });
    const [attempt, remediation] = await Promise.all([
      settle(gateway(`/v1/admin/examinations/${req.params.attemptId}`)),
      settle(gateway(`/v1/admin/examinations/${req.params.attemptId}/remediation`)),
    ]);
    res.json({ attempt: attempt.attempt || null, remediation: remediation.unavailable ? null : remediation });
  });

  app.get('/api/scenarios', async (req, res) => {
    try {
      const reply = await call(`${SYNTHETIC_URL}/v1/exam-scenarios`);
      res.status(reply.status).json(reply.data);
    } catch { res.status(503).json({ error: 'learner_unavailable' }); }
  });

  // Whether the learner has a live model configured (name only, never the key).
  app.get('/api/live-model', async (req, res) => {
    try {
      const reply = await call(`${SYNTHETIC_URL}/v1/live-model`);
      if (reply.status !== 200) return res.json({ available: false });
      res.json({ available: reply.data.available === true, provider: reply.data.provider, model: reply.data.model,
        reason: reply.data.reason || null });
    } catch { res.json({ available: false }); }
  });

  // One run at a time: every run uses the same Agent Learner identity.
  // Progress streams as newline-delimited JSON so the page shows each step live.
  app.post('/api/lifecycle/run', async (req, res) => {
    const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario : 'safe-escalation';
    if (!/^[a-z-]{1,40}$/.test(scenario)) return res.status(400).json({ error: 'invalid_scenario' });
    if (runInProgress) return res.status(409).json({ error: 'run_in_progress' });
    runInProgress = true;
    res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    const send = (message) => res.write(`${JSON.stringify(message)}\n`);
    send({ type: 'plan', steps: STEPS, scenario });
    // A live model can take minutes per stage; a heartbeat keeps the stream open.
    const heartbeat = setInterval(() => send({ type: 'heartbeat', at: new Date().toISOString() }), HEARTBEAT_MS);
    try {
      const report = await lifecycle.run({ scenario, onStep: (step) => send({ type: 'step', step }) });
      if (report.status === 'failed') {
        const failed = report.steps.find((step) => step.status === 'failed');
        if (failed?.id === 'examine' && failed.detail?.attemptId) {
          const remediation = await awaitRemediationDelivery(failed.detail.attemptId);
          send({ type: 'remediation', remediation });
        }
      }
      send({ type: 'done', report: { runId: report.runId, status: report.status, error: report.error || null,
        startedAt: report.startedAt, completedAt: report.completedAt } });
    } catch (error) {
      send({ type: 'done', report: { status: 'failed', error: error.code || 'run_failed' } });
    } finally {
      clearInterval(heartbeat);
      runInProgress = false;
      res.end();
    }
  });

  const dist = path.join(__dirname, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // The shell is never cached, so a rebuild reaches the browser at once;
    // hashed assets keep their long cache.
    app.get(/^(?!\/api\/).*/, (req, res) => res.set('cache-control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`[web] listening on ${PORT}`));
}

module.exports = { createServer, SERVICES };
