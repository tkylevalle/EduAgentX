'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const { GenerationError, generateStandardForm, publicForm } = require('./generation');
const { createStandardItems } = require('./standard-generator');
const { createPgStore } = require('./store');
const { createSources, DependencyError } = require('./sources');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[\x20-\x7e]{1,256}$/;

function createApp({ store, sources, internalKey = process.env.EXAMINATION_INTERNAL_KEY,
  clock = () => new Date().toISOString(), durationMinutes = Number(process.env.EXAM_DURATION_MINUTES || 60),
  generateItems = createStandardItems } = {}) {
  if (!store || !sources || !internalKey || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)
    throw new Error('store, sources, internal key and valid duration required');
  const app = express();
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });
  app.use(telemetry.middleware('examination-engine'));
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: 'examination-engine' }); }
    catch { res.status(503).json({ status: 'unhealthy', service: 'examination-engine' }); }
  });
  app.use('/internal', (req, res, next) => {
    if (req.header('x-internal-service-key') !== internalKey) return res.status(403).json({ error: 'forbidden' });
    if (!req.header('x-actor-subject')) return res.status(400).json({ error: 'actor_required' });
    next();
  });

  const active = async (correlationId) => {
    const pkg = await sources.activePackage(correlationId);
    if (!pkg || pkg.state !== 'Active' || pkg.certificationBlocked || !Array.isArray(pkg.quarantinedScopes) ||
      pkg.quarantinedScopes.length) throw Object.assign(new Error('active_package_required'), { status: 409 });
    return pkg;
  };
  const samePackage = (pkg, attempt) =>
    pkg.packageId === attempt.package.id && pkg.version === attempt.package.version && pkg.digest === attempt.package.digest;
  const expired = (attempt) => new Date(clock()).getTime() >= new Date(attempt.deadlineAt).getTime();

  app.post('/internal/attempts', async (req, res) => {
    try {
      const actor = req.header('x-actor-subject');
      if (req.header('x-actor-role') !== 'agent') return res.status(403).json({ error: 'forbidden' });
      if (!req.body || Object.keys(req.body).some((name) => name !== 'idempotencyKey') ||
        !KEY.test(req.body.idempotencyKey || '')) return res.status(400).json({ error: 'invalid_request' });
      const pkg = await active(req.correlationId);
      const registration = await sources.registration(actor, req.correlationId);
      const existing = await store.findByKey(actor, req.body.idempotencyKey);
      if (existing) {
        if (!samePackage(pkg, existing) || registration?.configurationFingerprint !== existing.configurationFingerprint)
          return res.status(409).json({ error: 'attempt_governance_changed', correlationId: req.correlationId });
        if (expired(existing)) return res.status(409).json({ error: 'attempt_deadline_elapsed', correlationId: req.correlationId });
        return res.json({ apiVersion: 'v1', outcome: 'replay', attempt: learnerView(existing), correlationId: req.correlationId });
      }
      const completion = await sources.completion(actor, pkg, req.correlationId);
      const form = await generateStandardForm({ pkg, registration, completion, generateItems });
      const now = clock();
      const deadlineAt = new Date(new Date(now).getTime() + durationMinutes * 60000).toISOString();
      const admitted = await store.admit({ actor, key: req.body.idempotencyKey, form, now, deadlineAt,
        correlationId: req.correlationId });
      // A quarantine or supersession during generation cannot be delivered.
      const current = await active(req.correlationId);
      if (!samePackage(current, admitted.attempt) ||
        registration.configurationFingerprint !== admitted.attempt.configurationFingerprint)
        return res.status(409).json({ error: 'attempt_governance_changed', correlationId: req.correlationId });
      if (expired(admitted.attempt)) return res.status(409).json({ error: 'attempt_deadline_elapsed', correlationId: req.correlationId });
      res.status(admitted.replay ? 200 : 201).json({ apiVersion: 'v1', outcome: admitted.replay ? 'replay' : 'started',
        attempt: learnerView(admitted.attempt), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  app.get('/internal/attempts/:id', async (req, res) => {
    try {
      if (req.header('x-actor-role') !== 'agent') return res.status(403).json({ error: 'forbidden' });
      const attempt = UUID.test(req.params.id) ? await store.get(req.params.id) : null;
      if (!attempt) return res.status(404).json({ error: 'attempt_not_found' });
      if (attempt.agentLearnerKey !== req.header('x-actor-subject')) return res.status(403).json({ error: 'identity_mismatch' });
      const pkg = await active(req.correlationId);
      const registration = await sources.registration(attempt.agentLearnerKey, req.correlationId);
      if (!samePackage(pkg, attempt) || registration?.configurationFingerprint !== attempt.configurationFingerprint)
        return res.status(409).json({ error: 'attempt_governance_changed', correlationId: req.correlationId });
      if (expired(attempt)) return res.status(409).json({ error: 'attempt_deadline_elapsed', correlationId: req.correlationId });
      res.json({ apiVersion: 'v1', attempt: learnerView(attempt), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  app.get('/internal/admin/attempts/:id', async (req, res) => {
    try {
      if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'forbidden' });
      const attempt = UUID.test(req.params.id) ? await store.get(req.params.id) : null;
      if (!attempt) return res.status(404).json({ error: 'attempt_not_found' });
      res.json({ apiVersion: 'v1', attempt: consoleView(attempt), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'invalid_request' });
    sendError(req, res, error);
  });
  return app;
}

function learnerView(attempt) {
  return { attemptId: attempt.attemptId, status: 'in_progress', mode: attempt.mode,
    startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, form: publicForm(attempt.form) };
}

function consoleView(attempt) {
  return { attemptId: attempt.attemptId, status: 'in_progress', mode: attempt.mode,
    agentLearnerKey: attempt.agentLearnerKey, configurationFingerprint: attempt.configurationFingerprint,
    package: attempt.package, template: attempt.form.template, rubric: attempt.form.rubric,
    generationPolicySha256: attempt.form.generationPolicySha256,
    trainingEventId: attempt.form.training.eventId, formDigest: attempt.formDigest,
    startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt,
    itemReferences: attempt.form.items.map((item) => ({ id: item.id, slotId: item.slotId,
      promptSha256: item.promptSha256, tier: item.tier, moduleIds: item.moduleIds,
      objectiveIds: item.objectiveIds })),
  };
}

function sendError(req, res, error) {
  if (error instanceof DependencyError) return res.status(error.status).json({ apiVersion: 'v1',
    error: 'dependency_unavailable', dependency: error.source, correlationId: req.correlationId });
  if (error instanceof GenerationError) return res.status(409).json({ apiVersion: 'v1',
    error: error.code, correlationId: req.correlationId });
  if (error.status === 409) return res.status(409).json({ apiVersion: 'v1',
    error: error.message, correlationId: req.correlationId });
  telemetry.log('examination-engine', 'request_failed', { correlationId: req.correlationId });
  return res.status(500).json({ apiVersion: 'v1', error: 'internal_error', correlationId: req.correlationId });
}

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => telemetry.log('examination-engine', 'postgres_connection_error'));
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  createApp({ store: createPgStore(pool), sources: createSources() })
    .listen(process.env.PORT || 4005);
}
if (require.main === module) start().catch((error) => {
  console.error('examination-engine startup failed', error.code || error.name);
  process.exitCode = 1;
});

module.exports = { createApp, learnerView, consoleView };
