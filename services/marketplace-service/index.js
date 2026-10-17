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
    try { await store.health(); res.json({ status: 'ok', service: SERVICE_NAME }); }
    catch { res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME }); }
  });

  app.use('/internal', (req, res, next) => {
    // No configured key means no caller can be trusted: refuse everything rather than run open.
    if (!internalKey) return res.status(503).json({ apiVersion: API_VERSION, error: 'marketplace_not_configured', correlationId: req.correlationId });
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

  // One authoritative answer, bounded in time. A throw or a timeout becomes null
  // so only this candidate's gate is uncheckable; the check itself carries on.
  async function ask(name, call, correlationId) {
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(call),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), sourceTimeoutMs); }),
      ]);
      return { value: value ?? null, outcome: 'answered' };
    } catch {
      telemetry.log(SERVICE_NAME, 'source_unavailable', { correlationId, dependency: name, outcome: 'uncheckable' });
      return { value: null, outcome: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function evaluate(record, version, discoverable, now, correlationId) {
    const candidate = record.candidate || {};
    const options = { correlationId };
    const [verification, fingerprint, pkg, lifecycle] = await Promise.all([
      ask('verification', () => sources.verification.verify(candidate, options), correlationId),
      ask('registry', () => sources.registry.getCurrentFingerprint(record.agentLearnerKey, options), correlationId),
      ask('package', () => sources.package.getPackage(candidate.package?.id, candidate.package?.version, options), correlationId),
      ask('lifecycleOrigin', () => sources.lifecycle.isLifecycleOrigin(candidate, options), correlationId),
    ]);
    const authoritative = {
      lifecycleOrigin: lifecycle.value,
      discoverable,
      verification: verification.value,
      registry: fingerprint.value === null ? null : { currentFingerprint: fingerprint.value },
      package: pkg.value,
    };
    const { eligible, reasons } = checkEligibility(version.content, candidate, authoritative, now);
    return { agentLearnerKey: record.agentLearnerKey, credentialId: record.credentialId, eligible, reasons,
      sources: { verification: verification.outcome, registry: fingerprint.outcome, package: pkg.outcome,
        lifecycleOrigin: lifecycle.outcome, listing: 'marketplace' } };
  }

  app.post('/internal/capability-requests/:id/eligibility-checks', handle(async (req) => {
    const id = requestId(req);
    const { idempotencyKey } = readBody(req, ['idempotencyKey']);
    // The request lock is held for the whole check, so a close cannot slip in
    // between "is it open?" and saving the results. Sources are time-bounded.
    return withRetry(store, `request:${id}`, async (tx) => {
      const prior = await tx.findCheckByKey(req.actor, idempotencyKey);
      if (prior) {
        if (prior.check.requestId !== id) throw new HttpError(409, 'idempotency_conflict');
        return { status: 200, body: { outcome: 'replay', ...checkView(prior) } };
      }
      const found = await readRequestIn(tx, id);
      if (!found) throw new HttpError(404, 'request_not_found');
      const state = deriveRequestState(found.events);
      if (state.status !== 'open') throw new HttpError(409, 'request_not_open');
      const version = found.versions.find((v) => v.version === state.openVersion);
      const now = clock();
      const records = await tx.listProjection();
      const discoverable = new Map();
      for (const key of new Set(records.map((record) => record.agentLearnerKey))) {
        discoverable.set(key, (await tx.getListingEvents(key)).at(-1)?.eventType === 'published');
      }
      const results = (await Promise.all(records.map((record) =>
        evaluate(record, version, discoverable.get(record.agentLearnerKey), now, req.correlationId))))
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

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Idle clients emit 'error' when Postgres restarts; an unhandled event would stop the process.
  pool.on('error', () => telemetry.log(SERVICE_NAME, 'postgres_connection_error'));
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  // Real sources are not wired yet (blockers 1-3); refusing to start is safer than guessing.
  await pool.end();
  throw new Error('marketplace sources are not configured');
}
if (require.main === module) start().catch((error) => {
  console.error('marketplace-service startup failed', error.code || error.message);
  process.exitCode = 1;
});
module.exports = { createApp };
