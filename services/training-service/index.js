'use strict';

// training-service (Sprint 2, issue #12)
//
// Delivers an ordered Training Session to a registered Agent Learner against
// one pinned Domain Assurance Package. Reached only through the Gateway, which
// passes the internal key and the authenticated subject. Training never
// grades, certifies or changes model weights.

const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const { EVIDENCE_ENVIRONMENTS } = require('../../packages/external-agent-protocol');
const { decideContinue, decideStart, decideSubmit, deriveSessionState } = require('./session');
const { createPgStore, decideAndAppend, isUniqueViolation } = require('./store');
const { ContractError, SourceUnavailableError, createPackageSource, createRegistrySource } = require('./clients');

const SERVICE_NAME = 'training-service';
const API_VERSION = 'v1';
const IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

function createApp({
  pool, internalKey = process.env.TRAINING_INTERNAL_KEY, packageSource, registrySource,
  store = pool ? createPgStore(pool) : undefined, clock = () => new Date().toISOString(),
} = {}) {
  if (!store || !internalKey || !packageSource || !registrySource) {
    throw new Error('store, internal key, package source and registry source required');
  }
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
    const pkg = await packageSource.getById(session.packageId, options);
    if (!pkg) throw new HttpError(503, 'governing_package_unavailable');
    return pkg;
  }

  app.post('/internal/sessions/start', handle(async (req) => {
    const actor = req.header('x-actor-subject');
    const input = requestInput(req, 'start');
    const options = { correlationId: req.correlationId };
    return decideAndAppend(store, actor, async (tx) => {
      const open = await tx.findOpenSession(actor);
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
    // Only a digest of the learner's answer is kept as evidence, not the text.
    return { deliveryItemId: body.deliveryItemId, responseDigest: `sha256:${sha256(body.response)}` };
  }));

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
    const { idempotencyKey, evidence } = req.body || {};
    if (!IDENTIFIER.test(idempotencyKey || '')) throw new HttpError(400, 'invalid_request', { details: ['idempotencyKey'] });
    // The DB also enforces this; checking here gives a 400 instead of a 500.
    if (!evidence || !Object.hasOwn(EVIDENCE_ENVIRONMENTS, evidence.mode) ||
      EVIDENCE_ENVIRONMENTS[evidence.mode] !== evidence.environment) {
      throw new HttpError(400, 'invalid_request', { details: ['evidence'] });
    }
    const mode = evidence.mode;
    // Training fingerprints the request's meaning itself, so reusing a key for
    // different content is caught whatever the caller sends.
    const requestFingerprint = sha256(JSON.stringify({
      action, sessionId: req.params.id || null, evidence: { mode, environment: evidence.environment }, ...extra,
    }));
    return {
      ...extra, now: clock(), evidence: { mode, environment: evidence.environment }, correlationId: req.correlationId,
      actor: req.header('x-actor-subject'), idempotencyKey, requestFingerprint,
    };
  }

  function handle(work) {
    return async (req, res) => {
      try {
        const decision = await work(req);
        const body = { apiVersion: API_VERSION, outcome: decision.outcome };
        if (decision.outcome === 'ok' || decision.outcome === 'replay') {
          const created = decision.events.some((event) => event.eventType === 'session_started');
          return res.status(created ? 201 : 200).json({ ...body, ...decision.response, correlationId: req.correlationId });
        }
        if (decision.outcome === 'blocked') {
          return res.status(409).json({ ...body, error: 'training_blocked', safeState: 'training_blocked',
            ...decision.response, correlationId: req.correlationId });
        }
        const status = decision.reason === 'not_registered' ? 403 : 409;
        return res.status(status).json({ ...body, error: decision.reason, correlationId: req.correlationId });
      } catch (error) {
        return sendError(req, res, error);
      }
    };
  }

  function sendError(req, res, error) {
    const correlationId = req.correlationId;
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
// derived from its events. Nothing here is persisted.
function summarise({ session, events }) {
  const state = deriveSessionState(events);
  return {
    ...session,
    status: state.status,
    blockReason: state.blockReason,
    completedItems: state.completedItemIds.length,
    lastEventAt: events.at(-1)?.occurredAt ?? session.startedAt,
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  createApp({ pool, packageSource: createPackageSource(), registrySource: createRegistrySource() })
    .listen(process.env.PORT || 4004);
}
if (require.main === module) start().catch((error) => {
  console.error('training-service startup failed', error.code || error.name);
  process.exitCode = 1;
});
module.exports = { createApp };
