'use strict';

// training-service (Sprint 2, issues #12 and #13)
//
// Delivers an ordered Training Session to a registered Agent Learner against
// one pinned Domain Assurance Package, with bounded practice, targeted
// remediation, objective-level progress and one completion event per session.
// Reached only through the Gateway, which passes the internal key and the
// authenticated subject. Training never grades, certifies or changes model
// weights.

const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const execution = require('../../packages/execution-provenance');
const { EVIDENCE_ENVIRONMENTS } = require('../../packages/external-agent-protocol');
const { decideContinue, decideRemediation, decideStart, decideSubmit, deriveSessionState } = require('./session');
const { objectiveProgress, policyFromEnv } = require('./plan');
const { summariseTraining } = require('./metrics');
const { parseRemediationRequest } = require('./remediation-request');
const { createPgStore, decideAndAppend, isUniqueViolation } = require('./store');
const { idleCutoff, sessionTimeoutFromEnv, startExpirySweep } = require('./expiry');
const { DEFAULT_STREAM, createRelayClient, startCompletionRelay } = require('./relay');
const { ContractError, SourceUnavailableError, createPackageSource, createRegistrySource } = require('./clients');

const SERVICE_NAME = 'training-service';
const API_VERSION = 'v1';
const IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The only body fields each interaction accepts; anything else is refused.
const BODY_FIELDS = {
  start: ['idempotencyKey', 'evidence', 'trustedExecution'],
  continue: ['idempotencyKey', 'evidence', 'trustedExecution'],
  submit: ['idempotencyKey', 'evidence', 'deliveryItemId', 'response', 'trustedExecution', 'executionEvidence'],
};
const REJECTION_STATUS = {
  not_registered: 403, response_too_long: 422, unknown_objectives: 422, no_targeted_content: 422,
};
const MAX_COMPLETION_EVENTS = 100;

class HttpError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

function createApp({
  pool, internalKey = process.env.TRAINING_INTERNAL_KEY, packageSource, registrySource,
  store = pool ? createPgStore(pool) : undefined, clock = () => new Date().toISOString(), policy = policyFromEnv(),
  sessionTimeoutMs = sessionTimeoutFromEnv(), executionPrincipals = execution.enrollments(),
} = {}) {
  if (!store || !internalKey || !packageSource || !registrySource) {
    throw new Error('store, internal key, package source and registry source required');
  }
  const enrolledExecutors = execution.enrollments(executionPrincipals);
  const app = express();
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });
  app.use(telemetry.middleware(SERVICE_NAME));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: SERVICE_NAME }); }
    catch { res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME }); }
  });

  app.use('/internal', (req, res, next) => {
    if (req.header('x-internal-service-key') !== internalKey) return res.status(403).json({ error: 'forbidden' });
    if (!req.header('x-actor-subject')) return res.status(400).json({ error: 'actor_required' });
    next();
  });

  // The pinned package is always fetched by its own id, never "whatever is
  // Active now", so a newer activation cannot change a running session.
  // Not found is treated as unavailable, not as a block: the validation
  // service is still in-memory, and a restart there must not permanently
  // block every running session.
  async function governingPackage(session, options) {
    const pkg = await packageSource.getById(session.packageId, session.packageVersion, options);
    if (!pkg) throw new HttpError(503, 'governing_package_unavailable');
    return pkg;
  }

  app.post('/internal/sessions/start', handle(async (req) => {
    const actor = req.header('x-actor-subject');
    const input = requestInput(req, 'start');
    const options = { correlationId: req.correlationId };
    return decideAndAppend(store, actor, async (tx) => {
      const open = await tx.findStart?.(actor, input.idempotencyKey) || await tx.findOpenSession(actor);
      if (!open) {
        const [pkg, registration] = await Promise.all([
          packageSource.getActive(options), registrySource.getRegistration(actor, options)]);
        return decideStart(pkg, registration, null, { ...input, sessionId: randomUUID(), agentLearnerKey: actor });
      }
      const events = await tx.getEvents(open.sessionId);
      const [pkg, registration] = await Promise.all([
        governingPackage(open, options), registrySource.getRegistration(actor, options)]);
      return decideStart(pkg, registration, { session: open, state: deriveSessionState(events) },
        { ...input, agentLearnerKey: actor });
    });
  }));

  const sessionStep = (action, decide, readExtra = () => ({})) => handle(async (req) => {
    const actor = req.header('x-actor-subject');
    if (!UUID.test(req.params.id)) throw new HttpError(404, 'session_not_found');
    const input = requestInput(req, action, readExtra(req.body || {}));
    const options = { correlationId: req.correlationId };
    return decideAndAppend(store, actor, async (tx) => {
      const session = await tx.getSession(req.params.id);
      if (!session) throw new HttpError(404, 'session_not_found');
      // One Agent Learner can never drive another learner's session.
      if (session.agentLearnerKey !== actor) throw new HttpError(403, 'identity_mismatch');
      const events = await tx.getEvents(session.sessionId);
      // Package state and the learner's fingerprint are re-checked on every call.
      const [pkg, registration] = await Promise.all([
        governingPackage(session, options), registrySource.getRegistration(actor, options)]);
      return decide(pkg, deriveSessionState(events), { ...input, session, registration });
    });
  });

  app.post('/internal/sessions/:id/continue', sessionStep('continue', decideContinue));
  app.post('/internal/sessions/:id/submit', sessionStep('submit', decideSubmit, (body) => {
    if (!IDENTIFIER.test(body.deliveryItemId || '')) throw new HttpError(400, 'invalid_request', { details: ['deliveryItemId'] });
    if (typeof body.response !== 'string' || !body.response.length) {
      throw new HttpError(400, 'invalid_request', { details: ['response'] });
    }
    // Only a digest and the length of the learner's answer are kept, not the text.
    return {
      submittedResponse: body.response, deliveryItemId: body.deliveryItemId, responseDigest: `sha256:${sha256(body.response)}`,
      responseLength: body.response.length,
    };
  }));

  // A structured remediation request from an operator (admin-only at the
  // Gateway). The actor is recorded as requestedBy; the learner is named in the body.
  app.post('/internal/remediations', handle(async (req) => {
    const { trustedExecution: providedAuthority, ...remediationBody } = req.body || {};
    const parsed = parseRemediationRequest(remediationBody);
    if (parsed.details) throw new HttpError(400, 'invalid_request', { details: parsed.details });
    const request = parsed.value;
    // A domain relay assigns work, not execution evidence. The planned run
    // authority comes from server enrollment, never the relay's evidence label.
    const trustedExecution = providedAuthority || execution.authority(enrolledExecutors, { subject: request.agentLearnerKey, role: 'agent' });
    if (providedAuthority && (req.header('x-actor-role') !== 'gateway' || !execution.validAuthority(trustedExecution) ||
      trustedExecution.executorId !== request.agentLearnerKey)) throw new HttpError(403, 'executor_not_authorized');
    if (trustedExecution && (trustedExecution.evidenceMode !== request.evidence.mode ||
      trustedExecution.environment !== request.evidence.environment)) throw new HttpError(409, 'provenance_conflict');
    const input = { trustedExecution,
      ...request, ...(trustedExecution ? { requestDigest: execution.hash({ requestDigest: request.requestDigest, trustedExecution }) } : {}), sessionId: randomUUID(), now: clock(), policy, correlationId: req.correlationId,
      actor: req.header('x-actor-subject'),
    };
    const options = { correlationId: req.correlationId };
    return decideAndAppend(store, request.agentLearnerKey, async (tx) => {
      const existingRequest = await tx.findRemediation(request.agentLearnerKey, request.requestId);
      const openSession = existingRequest ? null : await tx.findOpenSession(request.agentLearnerKey);
      if (existingRequest || openSession) return decideRemediation(null, null, { existingRequest, openSession }, input);
      const [pkg, registration] = await Promise.all([
        packageSource.getActive(options), registrySource.getRegistration(request.agentLearnerKey, options)]);
      return decideRemediation(pkg, registration, {}, input);
    });
  }));

  // Monitoring signals for every session, each traceable to session ids.
  app.get('/internal/metrics', async (req, res) => {
    try {
      const [sessions, completionEvents] = await Promise.all([store.metricsInput(), store.completionPublicationCounts()]);
      res.json({ apiVersion: API_VERSION, ...summariseTraining(sessions), completionEvents, correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  // The completion outbox, newest first. relay.js publishes it to a Redis Stream.
  app.get('/internal/completion-events', async (req, res) => {
    try {
      const events = await store.listCompletionEvents({ limit: MAX_COMPLETION_EVENTS });
      res.json({ apiVersion: API_VERSION, events, correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  // Exact authoritative lookup for Examination. The caller never supplies a
  // completion envelope; this reads Training's committed completion outbox.
  app.get('/internal/completions/latest', async (req, res) => {
    try {
      const names = ['agentLearnerKey', 'packageId', 'packageVersion', 'packageDigest'];
      if (req.query.sessionId && !UUID.test(req.query.sessionId)) throw new HttpError(400, 'invalid_request');
      if (names.some((name) => !IDENTIFIER.test(req.query[name] || '')) ||
        Object.keys(req.query).some((name) => ![...names, 'sessionId'].includes(name)))
        throw new HttpError(400, 'invalid_request');
      const completion = await store.findCompletion(req.query);
      if (!completion) throw new HttpError(404, 'completion_not_found');
      res.json({ apiVersion: API_VERSION, completion, correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  app.get('/internal/completion-incidents', async (req, res) => {
    try {
      const incidents = await store.listCompletionIncidents();
      res.json({ apiVersion: API_VERSION, incidents, correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  // Read-only views for the Assurance Console (admin-only at the Gateway).
  app.get('/internal/sessions', async (req, res) => {
    try {
      const key = typeof req.query.agentLearnerKey === 'string' && req.query.agentLearnerKey ? req.query.agentLearnerKey : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const sessions = (await store.listSessions({ agentLearnerKey: key })).map(summarise)
        .filter((session) => !status || session.status === status);
      res.json({ apiVersion: API_VERSION, sessions, correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  app.get('/internal/sessions/:id', async (req, res) => {
    try {
      const found = UUID.test(req.params.id) ? await store.readSession(req.params.id) : null;
      if (!found) throw new HttpError(404, 'session_not_found');
      res.json({
        apiVersion: API_VERSION,
        session: summarise(found),
        // Stored responses repeat full lesson text, so the history omits them.
        events: found.events.map(({ storedResponse, ...event }) => event),
        correlationId: req.correlationId,
      });
    } catch (error) { sendError(req, res, error); }
  });

  function requestInput(req, action, extra = {}) {
    const body = req.body || {};
    const unexpected = Object.keys(body).filter((key) => !BODY_FIELDS[action].includes(key));
    if (unexpected.length) throw new HttpError(400, 'invalid_request', { details: unexpected.map((key) => `unexpected:${key}`) });
    const { idempotencyKey, evidence } = body;
    if (!IDENTIFIER.test(idempotencyKey || '')) throw new HttpError(400, 'invalid_request', { details: ['idempotencyKey'] });
    // The DB also enforces this; checking here gives a 400 instead of a 500.
    if (!evidence || !Object.hasOwn(EVIDENCE_ENVIRONMENTS, evidence.mode) ||
      EVIDENCE_ENVIRONMENTS[evidence.mode] !== evidence.environment) {
      throw new HttpError(400, 'invalid_request', { details: ['evidence'] });
    }
    const mode = evidence.mode;
    const trustedExecution = body.trustedExecution || null;
    if (trustedExecution && (req.header('x-actor-role') !== 'gateway' || !execution.validAuthority(trustedExecution) ||
      trustedExecution.executorId !== req.header('x-actor-subject'))) throw new HttpError(403, 'executor_not_authorized');
    if (body.executionEvidence && !trustedExecution) throw new HttpError(403, 'executor_not_authorized');
    if (trustedExecution && (trustedExecution.evidenceMode !== mode || trustedExecution.environment !== evidence.environment))
      throw new HttpError(409, 'provenance_conflict');
    // Training fingerprints the request's meaning itself, so reusing a key for
    // different content is caught whatever the caller sends.
    const { submittedResponse, ...fingerprintExtra } = extra;
    const requestFingerprint = sha256(JSON.stringify({
      action, sessionId: req.params.id || null, evidence: { mode, environment: evidence.environment }, ...fingerprintExtra,
      ...(trustedExecution ? { trustedExecution, executionEvidence: body.executionEvidence || null } : {}),
    }));
    const now = clock();
    return {
      ...extra, trustedExecution, executionEvidence: body.executionEvidence || null, now, idleCutoff: idleCutoff(now, sessionTimeoutMs), evidence: { mode, environment: evidence.environment }, correlationId: req.correlationId,
      actor: req.header('x-actor-subject'), idempotencyKey, requestFingerprint, policy,
    };
  }

  function handle(work) {
    return async (req, res) => {
      try {
        const decision = await work(req);
        const body = { apiVersion: API_VERSION, outcome: decision.outcome };
        if (decision.outcome === 'ok' || decision.outcome === 'replay') {
          const created = decision.events.some((event) =>
            event.eventType === 'session_started' || event.eventType === 'remediation_assigned');
          return res.status(created ? 201 : 200).json({ ...body, ...decision.response, correlationId: req.correlationId });
        }
        if (decision.outcome === 'blocked') {
          return res.status(409).json({ ...body, error: 'training_blocked', safeState: 'training_blocked',
            ...decision.response, correlationId: req.correlationId });
        }
        const status = REJECTION_STATUS[decision.reason] || 409;
        return res.status(status).json({ ...body, error: decision.reason, correlationId: req.correlationId });
      } catch (error) {
        return sendError(req, res, error);
      }
    };
  }

  function sendError(req, res, error) {
    const correlationId = req.correlationId;
    if (error.code === 'provenance_conflict') return res.status(409).json({ error: error.code, correlationId });
    if (error instanceof HttpError) return res.status(error.status).json({ apiVersion: API_VERSION, ...error.body, correlationId });
    if (error instanceof SourceUnavailableError) {
      telemetry.log(SERVICE_NAME, 'dependency_failed', { correlationId, dependency: error.source, outcome: error.code });
      return res.status(503).json({ apiVersion: API_VERSION, error: 'dependency_unavailable', dependency: error.source, correlationId });
    }
    if (error instanceof ContractError) {
      telemetry.log(SERVICE_NAME, 'dependency_failed', { correlationId, dependency: error.source, outcome: error.code });
      return res.status(502).json({ apiVersion: API_VERSION, error: 'dependency_contract_violation',
        dependency: error.source, details: error.details, correlationId });
    }
    // A second collision after the retry: safe for the caller to retry with the same key.
    if (isUniqueViolation(error)) return res.status(409).json({ apiVersion: API_VERSION, error: 'concurrent_update', correlationId });
    telemetry.log(SERVICE_NAME, 'request_failed', { correlationId });
    return res.status(500).json({ apiVersion: API_VERSION, error: 'internal_error', correlationId });
  }

  return app;
}

// A read-friendly summary for the Console: the stored session plus the state
// derived from its events. Nothing here is persisted. The stored plan is
// replaced by objective-level progress, which is what a reader needs.
function summarise({ session, events }) {
  const state = deriveSessionState(events);
  const { deliveryPlan, ...rest } = session;
  return {
    ...rest,
    kind: session.kind || 'standard',
    status: state.status,
    blockReason: state.blockReason,
    completedItems: state.completedItemIds.length,
    plannedItems: deliveryPlan?.length ?? null,
    resumeCount: state.resumeCount,
    objectiveProgress: objectiveProgress(deliveryPlan, state.completedItemIds),
    lastEventAt: events.at(-1)?.occurredAt ?? session.startedAt,
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Idle clients emit 'error' when Postgres restarts; an unhandled event would stop the process.
  pool.on('error', () => telemetry.log(SERVICE_NAME, 'postgres_connection_error'));
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  const store = createPgStore(pool);
  const sessionTimeoutMs = sessionTimeoutFromEnv();
  createApp({
    pool, store, packageSource: createPackageSource(), registrySource: createRegistrySource(), policy: policyFromEnv(),
    sessionTimeoutMs,
  }).listen(process.env.PORT || 4004);
  startExpirySweep({ store, timeoutMs: sessionTimeoutMs });
  // Without REDIS_URL the outbox is kept and read through the admin API only.
  if (process.env.REDIS_URL) {
    startCompletionRelay({
      store, redis: createRelayClient(process.env.REDIS_URL),
      stream: process.env.TRAINING_COMPLETION_STREAM || DEFAULT_STREAM,
    });
  }
}
if (require.main === module) start().catch((error) => {
  console.error('training-service startup failed', error.code || error.name);
  process.exitCode = 1;
});
module.exports = { createApp };
