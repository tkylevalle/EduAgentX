'use strict';

// marketplace-service (Sprint 5, issue #30)
//
// Structured, simulated Capability Requests and hard Marketplace Eligibility.
// Decides WHO IS ELIGIBLE only: no scores, ranking or Near Matches (#31).
// Reached only through the Gateway, which passes the internal key and the
// authenticated subject. Every external answer comes from an injected source.

const fs = require('node:fs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const { validateRequestVersion, deriveRequestState } = require('./capability-request');
const { checkEligibility } = require('./eligibility');
const { createPgStore, withRetry, isUniqueViolation } = require('./store');
const { askSource, createRegistrySource, createPackageSource, createVerificationSource,
  createLifecycleSource } = require('./clients');
const { DEFAULT_STREAM, createCredentialConsumer, createRedisClient } = require('./stream-consumer');

const SERVICE_NAME = 'marketplace-service';
const API_VERSION = 'v1';
const IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUESTS_LISTED = 100;
const SOURCE_NAMES = ['verification', 'registry', 'package', 'lifecycle'];

class HttpError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

const matchesSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function createApp({
  pool, store = pool ? createPgStore(pool) : undefined, internalKey = process.env.MARKETPLACE_INTERNAL_KEY,
  sources, clock = () => new Date().toISOString(), newId = randomUUID, sourceTimeoutMs = 2000,
  // Startup problems (missing config, schema not applied yet). Any problem means 503, never a guess.
  readiness = () => [], healthDetails = () => ({}),
} = {}) {
  if (!store || !sources || SOURCE_NAMES.some((name) => !sources[name])) throw new Error('store and all four sources required');
  const app = express();
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });
  app.use(telemetry.middleware(SERVICE_NAME));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (_req, res) => {
    const problems = readiness();
    try {
      if (problems.length) throw new Error('not ready');
      await store.health();
      res.json({ status: 'ok', service: SERVICE_NAME, ...healthDetails() });
    } catch { res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, problems, ...healthDetails() }); }
  });

  app.use('/internal', (req, res, next) => {
    // No configured key means no caller can be trusted: refuse everything rather than run open.
    if (!internalKey || readiness().length)
      return res.status(503).json({ apiVersion: API_VERSION, error: 'marketplace_not_configured', correlationId: req.correlationId });
    if (!matchesSecret(req.header('x-internal-service-key'), internalKey) || !IDENTIFIER.test(req.header('x-actor-subject') || ''))
      return res.status(401).json({ apiVersion: API_VERSION, error: 'unauthorized', correlationId: req.correlationId });
    req.actor = req.header('x-actor-subject');
    next();
  });

  // --- Capability Requests

  app.post('/internal/capability-requests', handle(async (req) => {
    const { idempotencyKey, request } = readBody(req, ['idempotencyKey', 'request']);
    const validated = validRequest(request);
    return withRetry(store, `create:${req.actor}`, async (tx) => {
      const prior = await tx.findRequestByKey(req.actor, idempotencyKey);
      if (prior) {
        if (prior.requestFingerprint !== validated.digest) throw new HttpError(409, 'idempotency_conflict');
        return { status: 200, body: { outcome: 'replay', request: requestView(await readRequestIn(tx, prior.id)) } };
      }
      const id = newId();
      const at = clock();
      await tx.insertRequest({ id, createdBy: req.actor, createdAt: at, idempotencyKey, requestFingerprint: validated.digest });
      await tx.insertVersion({ requestId: id, version: 1, content: validated.value, digest: validated.digest,
        createdBy: req.actor, createdAt: at, idempotencyKey });
      return { status: 201, body: { outcome: 'created', request: requestView(await readRequestIn(tx, id)) } };
    });
  }));

  app.post('/internal/capability-requests/:id/versions', handle(async (req) => {
    const id = requestId(req);
    const { idempotencyKey, request } = readBody(req, ['idempotencyKey', 'request']);
    const validated = validRequest(request);
    return withRetry(store, `request:${id}`, async (tx) => {
      const found = await readRequestIn(tx, id);
      if (!found) throw new HttpError(404, 'request_not_found');
      const prior = await tx.findVersionByKey(id, req.actor, idempotencyKey);
      if (prior) {
        if (prior.digest !== validated.digest) throw new HttpError(409, 'idempotency_conflict');
        return { status: 200, body: { outcome: 'replay', request: requestView(found) } };
      }
      if (deriveRequestState(found.events).status === 'closed') throw new HttpError(409, 'request_closed');
      // The next number after the highest; earlier versions are only ever read.
      const version = Math.max(0, ...found.versions.map((v) => v.version)) + 1;
      await tx.insertVersion({ requestId: id, version, content: validated.value, digest: validated.digest,
        createdBy: req.actor, createdAt: clock(), idempotencyKey });
      return { status: 201, body: { outcome: 'created', request: requestView(await readRequestIn(tx, id)) } };
    });
  }));

  app.post('/internal/capability-requests/:id/open', handle(async (req) => {
    const id = requestId(req);
    const { version } = readBody(req, ['version'], ['version']);
    if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'invalid_request', { details: ['version'] });
    return withRetry(store, `request:${id}`, async (tx) => {
      const found = await readRequestIn(tx, id);
      if (!found) throw new HttpError(404, 'request_not_found');
      const state = deriveRequestState(found.events);
      if (state.status === 'closed') throw new HttpError(409, 'request_closed');
      if (!found.versions.some((v) => v.version === version)) throw new HttpError(404, 'version_not_found');
      if (state.status === 'open' && state.openVersion === version)
        return { status: 200, body: { outcome: 'unchanged', request: requestView(found) } };
      await tx.insertEvent({ requestId: id, eventType: 'opened', version, actor: req.actor, at: clock() });
      return { status: 200, body: { outcome: 'opened', request: requestView(await readRequestIn(tx, id)) } };
    });
  }));

  app.post('/internal/capability-requests/:id/close', handle(async (req) => {
    const id = requestId(req);
    readBody(req, [], []);
    return withRetry(store, `request:${id}`, async (tx) => {
      const found = await readRequestIn(tx, id);
      if (!found) throw new HttpError(404, 'request_not_found');
      if (deriveRequestState(found.events).status === 'closed')
        return { status: 200, body: { outcome: 'unchanged', request: requestView(found) } };
      await tx.insertEvent({ requestId: id, eventType: 'closed', version: null, actor: req.actor, at: clock() });
      return { status: 200, body: { outcome: 'closed', request: requestView(await readRequestIn(tx, id)) } };
    });
  }));

  app.get('/internal/capability-requests', handle(async () => {
    const page = await store.listRequests({ limit: MAX_REQUESTS_LISTED });
    return { status: 200, body: { requests: page.map(requestView) } };
  }));

  app.get('/internal/capability-requests/:id', handle(async (req) => {
    const found = await store.readRequest(requestId(req));
    if (!found) throw new HttpError(404, 'request_not_found');
    return { status: 200, body: { outcome: 'found', request: requestView(found) } };
  }));

  // --- listings (decision A): the learner is always the authenticated actor

  const listingStep = (eventType) => handle(async (req) => {
    const { idempotencyKey } = readBody(req, ['idempotencyKey']);
    const agentLearnerKey = req.actor;
    return withRetry(store, `listing:${agentLearnerKey}`, async (tx) => {
      const prior = await tx.findListingByKey(agentLearnerKey, idempotencyKey);
      if (prior) {
        if (prior.eventType !== eventType) throw new HttpError(409, 'idempotency_conflict');
        return { status: 200, body: { outcome: 'replay', listing: listingView(agentLearnerKey, await tx.getListingEvents(agentLearnerKey)) } };
      }
      await tx.insertListingEvent({ agentLearnerKey, eventType, actor: req.actor, at: clock(), idempotencyKey });
      return { status: 201, body: { outcome: eventType, listing: listingView(agentLearnerKey, await tx.getListingEvents(agentLearnerKey)) } };
    });
  });
  app.post('/internal/listings/publish', listingStep('published'));
  app.post('/internal/listings/withdraw', listingStep('withdrawn'));

  app.get('/internal/listings/:agentLearnerKey', handle(async (req) => {
    const key = req.params.agentLearnerKey;
    if (!IDENTIFIER.test(key)) throw new HttpError(400, 'invalid_request', { details: ['agentLearnerKey'] });
    return { status: 200, body: { outcome: 'found', listing: listingView(key, await store.readListing(key)) } };
  }));

  // --- eligibility checks

  // Every authoritative answer for one credential, each bounded in time. A throw,
  // a timeout or a contract mismatch becomes null for that answer only, so the
  // candidate gets UNCHECKABLE reasons while the rest of the check carries on.
  async function gatherAnswers(record, correlationId) {
    const candidate = record.candidate || {};
    const options = { correlationId };
    const ask = (name, call) => askSource(name, call, { timeoutMs: sourceTimeoutMs, correlationId });
    const [verification, fingerprint, pkg, lifecycle] = await Promise.all([
      ask('verification', () => sources.verification.verify(candidate, options)),
      ask('registry', () => sources.registry.getCurrentFingerprint(record.agentLearnerKey, options)),
      ask('package', () => sources.package.getPackage(candidate.package?.id, candidate.package?.version, options)),
      ask('lifecycleOrigin', () => sources.lifecycle.isLifecycleOrigin(candidate, options)),
    ]);
    return { record, verification, fingerprint, pkg, lifecycle };
  }

  function evaluate({ record, verification, fingerprint, pkg, lifecycle }, version, discoverable, now) {
    const authoritative = {
      lifecycleOrigin: lifecycle.value,
      discoverable,
      verification: verification.value,
      registry: fingerprint.value === null ? null : { currentFingerprint: fingerprint.value },
      package: pkg.value,
    };
    const { eligible, reasons } = checkEligibility(version.content, record.candidate || {}, authoritative, now);
    return { agentLearnerKey: record.agentLearnerKey, credentialId: record.credentialId, eligible, reasons,
      sources: { verification: verification.outcome, registry: fingerprint.outcome, package: pkg.outcome,
        lifecycleOrigin: lifecycle.outcome, listing: 'marketplace' } };
  }

  app.post('/internal/capability-requests/:id/eligibility-checks', handle(async (req) => {
    const id = requestId(req);
    const { idempotencyKey } = readBody(req, ['idempotencyKey']);
    const replayOf = (prior) => {
      if (prior.check.requestId !== id) throw new HttpError(409, 'idempotency_conflict');
      return { status: 200, body: { outcome: 'replay', ...checkView(prior) } };
    };

    // 1. Read without a lock: the request, its open version and the projected credentials.
    const prior = await store.readCheckByKey(req.actor, idempotencyKey);
    if (prior) return replayOf(prior);
    const found = await store.readRequest(id);
    if (!found) throw new HttpError(404, 'request_not_found');
    const state = deriveRequestState(found.events);
    if (state.status !== 'open') throw new HttpError(409, 'request_not_open');
    const version = found.versions.find((v) => v.version === state.openVersion);
    const records = await store.listProjection();

    // 2. Ask the owning services with no transaction or lock held, so slow
    // sources never block a close, a new version or another check.
    const answers = await Promise.all(records.map((record) => gatherAnswers(record, req.correlationId)));

    // 3. One short transaction under the request lock: confirm the request is
    // still open on the same version, read listings fresh, then store the evidence.
    return withRetry(store, `request:${id}`, async (tx) => {
      const again = await tx.findCheckByKey(req.actor, idempotencyKey);
      if (again) return replayOf(again);
      const current = deriveRequestState(await tx.getEvents(id));
      if (current.status !== 'open') throw new HttpError(409, 'request_not_open');
      if (current.openVersion !== version.version) throw new HttpError(409, 'request_version_changed');
      const now = clock();
      const discoverable = new Map();
      for (const key of new Set(records.map((record) => record.agentLearnerKey))) {
        discoverable.set(key, (await tx.getListingEvents(key)).at(-1)?.eventType === 'published');
      }
      const results = answers.map((answer) => evaluate(answer, version, discoverable.get(answer.record.agentLearnerKey), now))
        // Stable order for evidence only: by learner key, then credential. Not a ranking.
        .sort((a, b) => a.agentLearnerKey.localeCompare(b.agentLearnerKey) || a.credentialId.localeCompare(b.credentialId));
      const eligibleCount = results.filter((r) => r.eligible).length;
      const check = { checkId: newId(), requestId: id, version: version.version, requestDigest: version.digest,
        actor: req.actor, at: now, idempotencyKey,
        summary: { candidates: results.length, eligible: eligibleCount, excluded: results.length - eligibleCount,
          marketplace: marketplaceLabel(version.content), ordering: 'agentLearnerKey, not a ranking' } };
      await tx.insertCheck(check, results);
      return { status: 201, body: { outcome: 'created', ...checkView({ check, results }) } };
    });
  }));


  app.get('/internal/eligibility-checks/:checkId', handle(async (req) => {
    const found = UUID.test(req.params.checkId) ? await store.readCheck(req.params.checkId) : null;
    if (!found) throw new HttpError(404, 'check_not_found');
    return { status: 200, body: { outcome: 'found', ...checkView(found) } };
  }));

  // --- helpers

  function readBody(req, allowed, required = allowed) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const details = [
      ...Object.keys(body).filter((key) => !allowed.includes(key)).map((key) => `unexpected:${key}`),
      ...required.filter((key) => body[key] === undefined),
    ];
    if (allowed.includes('idempotencyKey') && body.idempotencyKey !== undefined && !IDENTIFIER.test(String(body.idempotencyKey)))
      details.push('idempotencyKey');
    if (details.length) throw new HttpError(400, 'invalid_request', { details });
    return body;
  }

  function validRequest(request) {
    const result = validateRequestVersion(request);
    if (!result.ok) throw new HttpError(400, 'invalid_request', { details: result.errors });
    return result;
  }

  function requestId(req) {
    if (!UUID.test(req.params.id)) throw new HttpError(404, 'request_not_found');
    return req.params.id;
  }

  function handle(work) {
    return async (req, res) => {
      try {
        const { status, body } = await work(req);
        res.status(status).json({ apiVersion: API_VERSION, ...body, correlationId: req.correlationId });
      } catch (error) {
        sendError(req, res, error);
      }
    };
  }

  function sendError(req, res, error) {
    const correlationId = req.correlationId;
    if (error instanceof HttpError) return res.status(error.status).json({ apiVersion: API_VERSION, ...error.body, correlationId });
    // A second collision after the retry: safe for the caller to retry with the same key.
    if (isUniqueViolation(error)) return res.status(409).json({ apiVersion: API_VERSION, error: 'concurrent_update', correlationId });
    telemetry.log(SERVICE_NAME, 'request_failed', { correlationId });
    return res.status(503).json({ apiVersion: API_VERSION, error: 'marketplace_unavailable', correlationId });
  }

  return app;
}

async function readRequestIn(tx, id) {
  const request = await tx.getRequest(id);
  return request ? { request, versions: await tx.getVersions(id), events: await tx.getEvents(id) } : null;
}

// Test credentials may only appear in a visibly labelled simulation marketplace.
const marketplaceLabel = (content) => (content?.requiredEnvironment === 'live' ? 'live' : 'simulation');

function requestView({ request, versions, events }) {
  const state = deriveRequestState(events);
  const shown = versions.find((v) => v.version === state.openVersion) || versions.at(-1);
  return {
    id: request.id, createdBy: request.createdBy, createdAt: request.createdAt, state,
    marketplace: marketplaceLabel(shown?.content),
    versions: versions.map(({ version, content, digest, createdBy, createdAt }) => ({ version, content, digest, createdBy, createdAt })),
    events: events.map(({ eventType, version, actor, at }) => ({ eventType, version, actor, at })),
  };
}

function listingView(agentLearnerKey, events) {
  return { agentLearnerKey, discoverable: events.at(-1)?.eventType === 'published',
    events: events.map(({ eventType, actor, at }) => ({ eventType, actor, at })) };
}

function checkView({ check, results }) {
  const item = ({ agentLearnerKey, credentialId, reasons, sources }) => ({ agentLearnerKey, credentialId, reasons, sources });
  return {
    check: { checkId: check.checkId, requestId: check.requestId, version: check.version, requestDigest: check.requestDigest,
      actor: check.actor, at: check.at, marketplace: check.summary.marketplace, summary: check.summary },
    eligible: results.filter((r) => r.eligible).map(item),
    excluded: results.filter((r) => !r.eligible).map(item),
  };
}

// Secrets have no fallback (architecture rule 5); service URLs default to their compose names.
const REQUIRED_CONFIG = ['DATABASE_URL', 'MARKETPLACE_INTERNAL_KEY', 'CURRICULUM_INTERNAL_KEY'];
const SCHEMA_RETRY_MS = 5000;

const configProblems = (env) => REQUIRED_CONFIG.filter((name) => !env[name]).map((name) => `missing:${name}`);

// Stands in when DATABASE_URL is missing: every call fails, so nothing can pass as healthy.
const unavailableStore = () => new Proxy({}, { get: () => async () => { throw new Error('database_not_configured'); } });

// Missing config or an unreachable database gives /health 503 and keeps the
// process up, instead of a crash loop that hides the reason.
function start(env = process.env) {
  const state = { problems: configProblems(env), schemaReady: false, eventFeed: 'disabled' };
  const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL }) : null;
  // Idle clients emit 'error' when Postgres restarts; an unhandled event would stop the process.
  pool?.on('error', () => telemetry.log(SERVICE_NAME, 'postgres_connection_error'));
  const store = pool ? createPgStore(pool) : unavailableStore();
  const sources = {
    registry: createRegistrySource({ baseUrl: env.AGENT_REGISTRY_URL || 'http://agent-registry:4001' }),
    package: createPackageSource({ baseUrl: env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
      internalKey: env.CURRICULUM_INTERNAL_KEY }),
    verification: createVerificationSource({ baseUrl: env.CREDENTIAL_VERIFICATION_URL || 'http://credential-verification:4030' }),
    lifecycle: createLifecycleSource(),
  };
  const server = createApp({ store, sources, internalKey: env.MARKETPLACE_INTERNAL_KEY,
    readiness: () => [...state.problems, ...(state.schemaReady ? [] : ['schema_not_applied'])],
    healthDetails: () => ({ eventFeed: state.eventFeed }) }).listen(env.PORT || 4012);

  let consumer = null;
  let retry = null;
  const applySchema = async () => {
    try {
      await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
      state.schemaReady = true;
      // Without REDIS_URL the projection simply stays empty, so every check finds no candidates.
      if (env.REDIS_URL) {
        consumer = createCredentialConsumer({ store, redis: createRedisClient(env.REDIS_URL),
          stream: env.CREDENTIAL_EVENT_STREAM || DEFAULT_STREAM });
        consumer.start();
        state.eventFeed = 'running';
      }
    } catch {
      telemetry.log(SERVICE_NAME, 'schema_apply_failed', { dependency: 'postgres', outcome: 'retrying' });
      retry = setTimeout(applySchema, SCHEMA_RETRY_MS);
      retry.unref();
    }
  };
  if (pool) void applySchema();
  server.on('close', () => { clearTimeout(retry); consumer?.stop(); void pool?.end(); });
  return server;
}
if (require.main === module) start();
module.exports = { createApp, configProblems, start };
