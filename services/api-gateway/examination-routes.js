'use strict';

// Issue #16: public Exam delivery is possible only after the Examination
// Engine has committed an immutable attempt. No caller-supplied package,
// completion event, learner key, or generated questions cross this boundary.
// Also knowledge.lookup, the agent's open-book tool during the exam, and the
// admin reads of an attempt and its remediation trace.

const telemetry = require('../../packages/telemetry');
const execution = require('../../packages/execution-provenance');
const { TRAINING_IDENTIFIER, isIdentifier, isPlainObject, unavailable } = require('./route-helpers');

// One recorded sandbox action: the Engine's own limit (behaviour.js MAX_ACTION_CHARS).
const EPISODE_MAX_ACTION_CHARS = 4000;
// knowledge.lookup: a query of a few words to a short paragraph, and at most
// five lessons back, which is every module of the current package.
const KNOWLEDGE_MIN_QUERY_CHARS = 3;
const KNOWLEDGE_MAX_QUERY_CHARS = 500;
const KNOWLEDGE_DEFAULT_RESULTS = 3;
const KNOWLEDGE_MAX_RESULTS = 5;
// The Engine's limit on one written answer.
const RESPONSE_MAX_CHARS = 16000;
const START_FIELDS = Object.freeze(['idempotencyKey', 'trainingSessionId', 'executionProfile', 'domainId']);
const RESPONSE_FIELDS = Object.freeze(['idempotencyKey', 'expectedSequence', 'itemId', 'response', 'executionEvidence', 'executionProfile']);
const STEP_FIELDS = Object.freeze(['idempotencyKey', 'expectedSequence', 'action']);

const invalidRequest = (req, res) => res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', correlationId: req.correlationId });

function startRoute(app, { requireRole, proxyJson, enrolledExecutors, examinationEngineUrl, examinationInternalKey, examinationHeaders, examinationUnavailable }) {
  app.post('/v1/examinations', requireRole('agent'), async (req, res) => {
    // A domain is an identifier string; any other type is refused, never coerced.
    if (!isPlainObject(req.body) || Object.keys(req.body).some((name) => !START_FIELDS.includes(name)) ||
      !TRAINING_IDENTIFIER.test(req.body.idempotencyKey || '') ||
      (req.body.domainId !== undefined && !isIdentifier(req.body.domainId)))
      return invalidRequest(req, res);
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    let trustedExecution;
    try { trustedExecution = execution.authority(enrolledExecutors, req.auth, req.body.executionProfile); }
    catch (e) { return res.status(e.status || 403).json({ error: e.code }); }
    if (trustedExecution && !execution.UUID.test(req.body.trainingSessionId || ''))
      return res.status(400).json({ error: 'training_run_required' });
    const body = { idempotencyKey: req.body.idempotencyKey,
      ...(req.body.trainingSessionId ? { trainingSessionId: req.body.trainingSessionId } : {}),
      // The domain to be examined in, when more than one is Active; never a package version.
      ...(req.body.domainId !== undefined ? { domainId: req.body.domainId } : {}),
      ...(trustedExecution ? { trustedExecution } : {}) };
    await proxyJson(req, res, `${examinationEngineUrl}/internal/attempts`, { method: 'POST', body,
      headers: examinationHeaders(req) });
  });
}

// The Engine owns durable replay and state checks; the Gateway never caches
// an answer receipt or accepts a grading/finalization command publicly.
function responseRoute(app, { requireRole, proxyJson, enrolledExecutors, examinationEngineUrl, examinationInternalKey, examinationHeaders, examinationUnavailable }) {
  app.post('/v1/examinations/:attemptId/responses', requireRole('agent'), async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body) || Object.keys(body).some((name) => !RESPONSE_FIELDS.includes(name)) ||
      typeof body.idempotencyKey !== 'string' || !TRAINING_IDENTIFIER.test(body.idempotencyKey) ||
      !Number.isSafeInteger(body.expectedSequence) || body.expectedSequence < 1 ||
      typeof body.itemId !== 'string' || !TRAINING_IDENTIFIER.test(body.itemId) ||
      typeof body.response !== 'string' || !body.response.trim() || body.response.length > RESPONSE_MAX_CHARS)
      return invalidRequest(req, res);
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    let forwarded;
    try { forwarded = responseBody(); } catch (e) { return res.status(e.status || 403).json({ error: e.code }); }
    await proxyJson(req, res,
      `${examinationEngineUrl}/internal/attempts/${encodeURIComponent(req.params.attemptId)}/responses`,
      { method: 'POST', body: forwarded, headers: examinationHeaders(req) });
    function responseBody() {
      const trustedExecution = execution.authority(enrolledExecutors, req.auth, body.executionProfile);
      if (body.executionEvidence && !trustedExecution) throw execution.fail('executor_not_authorized', 403);
      return { idempotencyKey: body.idempotencyKey, expectedSequence: body.expectedSequence, itemId: body.itemId, response: body.response,
        ...(body.executionEvidence ? { executionEvidence: body.executionEvidence } : {}),
        ...(trustedExecution ? { trustedExecution } : {}) };
    }
  });
}

// knowledge.lookup (assurance audit B3, B4): read-only retrieval over the
// Active package's lessons, ranked by the curriculum index. It is the tool
// the agent's manifest declares; the exam is open book. packageId and
// version, when given, pin the lookup to one package version (the exam's).
function knowledgeRoute(app, { requireRole, forwardJson, serviceName, curriculumIndexUrl, curriculumInternalKey }) {
  app.get('/v1/knowledge', requireRole('agent'), async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const limit = req.query.limit === undefined ? KNOWLEDGE_DEFAULT_RESULTS : Number(req.query.limit);
    const pin = ['packageId', 'version'].filter((name) => req.query[name] !== undefined);
    if (query.length < KNOWLEDGE_MIN_QUERY_CHARS || query.length > KNOWLEDGE_MAX_QUERY_CHARS ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > KNOWLEDGE_MAX_RESULTS ||
      pin.some((name) => typeof req.query[name] !== 'string' || !TRAINING_IDENTIFIER.test(req.query[name])))
      return invalidRequest(req, res);
    const knowledgeUnavailable = (reason) => {
      if (reason) telemetry.log(serviceName, 'upstream_failed', { correlationId: req.correlationId, dependency: 'curriculum-index', outcome: reason });
      return unavailable(req, res, 'knowledge_unavailable');
    };
    if (!curriculumIndexUrl || !curriculumInternalKey) return knowledgeUnavailable();
    const pinned = pin.map((name) => `&${name}=${encodeURIComponent(req.query[name])}`).join('');
    try {
      const upstream = await forwardJson(req, `${curriculumIndexUrl}/internal/index/query?text=${encodeURIComponent(query)}&limit=${limit}${pinned}`,
        { headers: { 'x-internal-service-key': curriculumInternalKey } });
      if (upstream.status !== 200 || !Array.isArray(upstream.body?.results)) return knowledgeUnavailable(`status_${upstream.status}`);
      return res.status(200).json({ apiVersion: 'v1', mode: upstream.body.mode === 'live' ? 'live' : 'cached-stale',
        results: upstream.body.results.slice(0, limit).map((chunk) => ({ moduleId: chunk.moduleId, objectiveIds: chunk.objectiveIds,
          packageId: chunk.packageId, version: chunk.version, text: chunk.text, digest: chunk.digest })),
        correlationId: req.correlationId });
    } catch (error) { return knowledgeUnavailable(error?.name || 'request_failed'); }
  });
}

// A behaviour item's sandbox episode: the agent reads where it is, then
// records one action at a time; the Engine runs and records each one.
function episodeRoutes(app, { requireRole, proxyJson, examinationEngineUrl, examinationInternalKey, examinationHeaders, examinationUnavailable }) {
  const episodeUrl = (req) =>
    `${examinationEngineUrl}/internal/attempts/${encodeURIComponent(req.params.attemptId)}/episodes/${encodeURIComponent(req.params.itemId)}`;
  app.get('/v1/examinations/:attemptId/episodes/:itemId', requireRole('agent'), async (req, res) => {
    if (!TRAINING_IDENTIFIER.test(req.params.itemId)) return invalidRequest(req, res);
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, episodeUrl(req), { headers: examinationHeaders(req) });
  });
  app.post('/v1/examinations/:attemptId/episodes/:itemId/steps', requireRole('agent'), async (req, res) => {
    const body = req.body;
    if (!isPlainObject(body) || Object.keys(body).some((name) => !STEP_FIELDS.includes(name)) ||
      typeof body.idempotencyKey !== 'string' || !TRAINING_IDENTIFIER.test(body.idempotencyKey) ||
      !Number.isSafeInteger(body.expectedSequence) || body.expectedSequence < 1 ||
      !isPlainObject(body.action) ||
      JSON.stringify(body.action).length > EPISODE_MAX_ACTION_CHARS || !TRAINING_IDENTIFIER.test(req.params.itemId))
      return invalidRequest(req, res);
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, `${episodeUrl(req)}/steps`, { method: 'POST',
      body: { idempotencyKey: body.idempotencyKey, expectedSequence: body.expectedSequence, action: body.action }, headers: examinationHeaders(req) });
  });
}

// The learner's read of its own attempt, and the admin reads of any attempt.
function readRoutes(app, { requireRole, proxyJson, examinationEngineUrl, examinationInternalKey, examinationHeaders, examinationUnavailable }) {
  const attemptRead = (role, path) => app.get(path.route, requireRole(role), async (req, res) => {
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, `${examinationEngineUrl}${path.upstream(encodeURIComponent(req.params.attemptId))}`,
      { headers: examinationHeaders(req) });
  });
  attemptRead('agent', { route: '/v1/examinations/:attemptId', upstream: (id) => `/internal/attempts/${id}` });
  attemptRead('admin', { route: '/v1/admin/examinations/:attemptId', upstream: (id) => `/internal/admin/attempts/${id}` });
  // Issue #21: failure, gap, remediation delivery and re-examinations of one attempt.
  attemptRead('admin', { route: '/v1/admin/examinations/:attemptId/remediation', upstream: (id) => `/internal/admin/attempts/${id}/remediation` });
}

/**
 * Registers the examination, knowledge.lookup and episode routes, in the order the Gateway has always had them.
 * @param {import('express').Express} app
 * @param {{ requireRole: Function, proxyJson: Function, forwardJson: Function, serviceName: string, enrolledExecutors: object,
 *   examinationEngineUrl: string, examinationInternalKey?: string, curriculumIndexUrl?: string, curriculumInternalKey?: string }} deps
 */
function registerExaminationRoutes(app, deps) {
  const context = {
    ...deps,
    examinationHeaders: (req) => ({ 'x-internal-service-key': deps.examinationInternalKey,
      'x-actor-subject': req.auth.subject, 'x-actor-role': req.auth.role }),
    examinationUnavailable: (req, res) => unavailable(req, res, 'examination_unavailable'),
  };
  startRoute(app, context);
  responseRoute(app, context);
  knowledgeRoute(app, context);
  episodeRoutes(app, context);
  readRoutes(app, context);
}

module.exports = { registerExaminationRoutes };
