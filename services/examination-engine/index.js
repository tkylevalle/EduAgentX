'use strict';

const fs = require('node:fs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const { GenerationError, generateStandardForm, publicForm } = require('./generation');
const { createStandardItems } = require('./standard-generator');
const { createPgStore } = require('./store');
const { createSources, DependencyError } = require('./sources');
const { fail, validateCommand } = require('./lifecycle');
const { sha256 } = require('../curriculum-engine/model');
const { buildFallbackForm, publicFallbackForm, mapFallbackResult } = require('./fallback-form');
const { createFallbackSelect, createFallbackScore } = require('./fallback-sources');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[\x20-\x7e]{1,256}$/;
const matchesSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function createApp({ store, sources, internalKey = process.env.EXAMINATION_INTERNAL_KEY,
  gradingKey = process.env.EXAMINATION_GRADING_KEY,
  clock = () => new Date().toISOString(), durationMinutes = Number(process.env.EXAM_DURATION_MINUTES || 60),
  generateItems = createStandardItems, selectFallback, scoreFallback } = {}) {
  if (!store || !sources || !internalKey || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)
    throw new Error('store, sources, internal key and valid duration required');
  const app = express();
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });
  app.use(telemetry.middleware('examination-engine'));
  app.use(express.json({ limit: '128kb' }));
  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: 'examination-engine' }); }
    catch { res.status(503).json({ status: 'unhealthy', service: 'examination-engine' }); }
  });
  app.use('/internal', (req, res, next) => {
    if (!matchesSecret(req.header('x-internal-service-key'), internalKey)) return res.status(403).json({ error: 'forbidden' });
    if (!req.header('x-actor-subject')) return res.status(400).json({ error: 'actor_required' });
    next();
  });
  const active = async (correlationId) => {
    const pkg = await sources.activePackage(correlationId);
    if (!pkg || pkg.state !== 'Active' || pkg.certificationBlocked || !Array.isArray(pkg.quarantinedScopes) ||
      pkg.quarantinedScopes.length) throw fail('active_package_required');
    return pkg;
  };
  const governance = async (attempt, correlationId) => {
    const pkg = await active(correlationId);
    const registration = await sources.registration(attempt.agentLearnerKey, correlationId);
    if (pkg.packageId !== attempt.package.id || pkg.version !== attempt.package.version || pkg.digest !== attempt.package.digest ||
      registration?.configurationFingerprint !== attempt.configurationFingerprint) throw fail('attempt_governance_changed');
  };
  const abortOnGovernance = async (attempt, correlationId) => {
    if (attempt.status !== 'in_progress') return;
    try { await governance(attempt, correlationId); }
    catch (error) {
      const result = await store.command(attempt.attemptId, { type: 'system_abort',
        reason: error.status === 409 ? 'governance_changed' : 'infrastructure_failure', now: clock(), correlationId }, { clock });
      error.attempt = result.attempt;
      throw error;
    }
  };
  const load = async (req, owner) => {
    const attempt = UUID.test(req.params.id) ? await store.get(req.params.id) : null;
    if (!attempt) throw fail('attempt_not_found', 404);
    if (owner && attempt.agentLearnerKey !== req.header('x-actor-subject')) throw fail('identity_mismatch', 403);
    return attempt;
  };
  const reconcile = (attempt, req) => store.get(attempt.attemptId, { clock, correlationId: req.correlationId });
  const trusted = (req, res, next) => {
    if (!gradingKey) return res.status(503).json({ error: 'grading_not_configured' });
    if (req.header('x-actor-role') !== 'examiner' || !matchesSecret(req.header('x-internal-grading-key'), gradingKey))
      return res.status(403).json({ error: 'forbidden' });
    next();
  };
  app.post('/internal/attempts', async (req, res) => {
    try {
      const actor = req.header('x-actor-subject');
      if (req.header('x-actor-role') !== 'agent') throw fail('forbidden', 403);
      if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.idempotencyKey !== 'string' ||
        !KEY.test(req.body.idempotencyKey)) throw fail('invalid_request', 400);
      const existing = await store.findByKey(actor, req.body.idempotencyKey);
      if (existing) {
        await abortOnGovernance(existing, req.correlationId);
        const attempt = await reconcile(existing, req);
        return res.json({ apiVersion: 'v1', outcome: 'replay', attempt: learnerView(attempt, clock()), correlationId: req.correlationId });
      }
      const pkg = await active(req.correlationId);
      const registration = await sources.registration(actor, req.correlationId);
      const completion = await sources.completion(actor, pkg, req.correlationId);
      const form = await generateStandardForm({ pkg, registration, completion, generateItems });
      const now = clock();
      const deadlineAt = new Date(Date.parse(now) + durationMinutes * 60000).toISOString();
      const admitted = await store.admit({ actor, key: req.body.idempotencyKey, form, now, deadlineAt, correlationId: req.correlationId });
      // Re-fetch both governance inputs after durable admission. Failure records an observable abort.
      await abortOnGovernance(admitted.attempt, req.correlationId);
      const attempt = await reconcile(admitted.attempt, req);
      res.status(admitted.replay ? 200 : 201).json({ apiVersion: 'v1', outcome: admitted.replay ? 'replay' : 'started',
        attempt: learnerView(attempt, clock()), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });
  // Issue #20: a Deterministic Fallback Examination starts only through this
  // trusted operator route, never automatically, and always as a new attempt.
  // Reasons are validation-activation's selection vocabulary, not the Engine's
  // own abort REASONS.
  const FALLBACK_REASONS = ['standard_grading_unavailable', 'standard_generation_unavailable'];
  const FALLBACK_FIELDS = ['idempotencyKey', 'agentLearnerKey', 'reason', 'causeAttemptId'];
  app.post('/internal/attempts/fallback', trusted, async (req, res) => {
    if (!selectFallback) return res.status(503).json({ apiVersion: 'v1', error: 'fallback_not_configured', correlationId: req.correlationId });
    try {
      const body = req.body;
      const { idempotencyKey, agentLearnerKey, reason } = body || {};
      const causeAttemptId = body?.causeAttemptId ?? null;
      // A grading outage must name the aborted attempt it replaces; a generation
      // outage never produced one.
      if (!body || Array.isArray(body) || Object.keys(body).some((name) => !FALLBACK_FIELDS.includes(name)) ||
        typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey) ||
        typeof agentLearnerKey !== 'string' || !agentLearnerKey.trim() || !FALLBACK_REASONS.includes(reason) ||
        (reason === 'standard_grading_unavailable' ? typeof causeAttemptId !== 'string' || !UUID.test(causeAttemptId)
          : causeAttemptId !== null)) throw fail('invalid_request', 400);
      // Replay before any dependency call, so a retry never selects a second bank.
      const existing = await store.findByKey(agentLearnerKey, idempotencyKey);
      if (existing) {
        if (existing.mode !== 'fallback' || existing.fallbackReason !== reason ||
          existing.fallbackCauseAttemptId !== causeAttemptId) throw fail('idempotency_conflict');
        await abortOnGovernance(existing, req.correlationId);
        const attempt = await reconcile(existing, req);
        return res.json({ apiVersion: 'v1', outcome: 'replay', attempt: learnerView(attempt, clock()), correlationId: req.correlationId });
      }
      let cause = null;
      if (causeAttemptId) {
        cause = await store.get(causeAttemptId);
        if (!cause) throw fail('fallback_cause_not_found', 404);
        // Checked first so another learner's attempt state is never disclosed.
        if (cause.agentLearnerKey !== agentLearnerKey) throw fail('fallback_cause_wrong_learner');
        if (cause.mode !== 'standard') throw fail('fallback_cause_not_standard');
        if (cause.status !== 'system_aborted') throw fail('fallback_cause_not_aborted');
        // derive() takes terminalReason from the system_aborted event's payload.reason.
        if (cause.terminalReason !== 'grading_unavailable') throw fail('fallback_cause_reason_mismatch');
      }
      const pkg = await active(req.correlationId);
      const registration = await sources.registration(agentLearnerKey, req.correlationId);
      if (!registration?.configurationFingerprint) throw fail('registration_required');
      // A changed configuration is a different Agent Learner state; it never carries over.
      if (cause && cause.configurationFingerprint !== registration.configurationFingerprint)
        throw fail('fallback_cause_fingerprint_changed');
      const selected = await selectFallback({ pkg, reason, correlationId: req.correlationId });
      // /fallback/select returns no version or digest, so confirm governance did not move during the call.
      const confirmed = await active(req.correlationId);
      if (confirmed.packageId !== pkg.packageId || confirmed.version !== selected.packageVersion ||
        confirmed.digest !== selected.packageDigest) throw fail('fallback_governance_changed');
      const form = buildFallbackForm({ selection: selected.selection, packageId: confirmed.packageId,
        packageVersion: confirmed.version, packageDigest: confirmed.digest, agentLearnerKey,
        configurationFingerprint: registration.configurationFingerprint, causeAttemptId, reason });
      const { selection } = selected;
      const now = clock();
      const admitted = await store.admitFallback({ actor: agentLearnerKey, key: idempotencyKey, form, now,
        deadlineAt: new Date(Date.parse(now) + durationMinutes * 60000).toISOString(), correlationId: req.correlationId,
        causeAttemptId, reason, bankId: selection.bankId, bankVersion: selection.bankVersion,
        // Select returns no bank digest: this pins exactly what was served (no
        // answers). It is not the manifest's fallbackBankPin, which the Engine cannot see.
        bankDigest: sha256({ bankId: selection.bankId, bankVersion: selection.bankVersion,
          scoringPolicy: selection.scoringPolicy, items: selection.items }) });
      // Same post-admission governance re-check as standard admission.
      await abortOnGovernance(admitted.attempt, req.correlationId);
      const attempt = await reconcile(admitted.attempt, req);
      res.status(admitted.replay ? 200 : 201).json({ apiVersion: 'v1', outcome: admitted.replay ? 'replay' : 'started',
        attempt: learnerView(attempt, clock()), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });
  app.get('/internal/attempts/:id', async (req, res) => {
    try {
      if (req.header('x-actor-role') !== 'agent') throw fail('forbidden', 403);
      const attempt = await load(req, true);
      await abortOnGovernance(attempt, req.correlationId);
      res.json({ apiVersion: 'v1', attempt: learnerView(await reconcile(attempt, req), clock()), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });
  app.get('/internal/admin/attempts/:id', async (req, res) => {
    try {
      if (req.header('x-actor-role') !== 'admin') throw fail('forbidden', 403);
      const attempt = await reconcile(await load(req, false), req);
      res.json({ apiVersion: 'v1', attempt: consoleView(attempt), correlationId: req.correlationId });
    } catch (error) { sendError(req, res, error); }
  });
  function commandRoute(type, fields, owner) {
    return async (req, res) => {
      try {
        if (owner && req.header('x-actor-role') !== 'agent') throw fail('forbidden', 403);
        if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== fields.length ||
          fields.some((field) => !Object.hasOwn(req.body, field))) throw fail('invalid_request', 400);
        const command = { ...req.body, type, now: clock(), correlationId: req.correlationId };
        validateCommand(command);
        const attempt = await load(req, owner);
        const result = await store.command(attempt.attemptId, command, { clock,
          ...(type !== 'abort' ? { guard: (current) => governance(current, req.correlationId) } : {}) });
        res.json({ apiVersion: 'v1', outcome: result.replay ? 'replay' : 'accepted',
          attempt: lifecycleView(result.attempt), receipt: result.receipt, correlationId: req.correlationId });
      } catch (error) { sendError(req, res, error); }
    };
  }
  app.post('/internal/attempts/:id/responses', commandRoute('response', ['idempotencyKey','expectedSequence','itemId','response'], true));
  app.post('/internal/attempts/:id/finalize', trusted, commandRoute('finalize',
    ['idempotencyKey','expectedSequence','eventId','formDigest','rubricDigest','responseSetDigest','result'], false));
  app.post('/internal/attempts/:id/abort', trusted, commandRoute('abort', ['idempotencyKey','expectedSequence','eventId','reason'], false));
  app.get('/internal/attempts/:id/grading-input', trusted, async (req, res) => {
    try {
      const attempt = await reconcile(await load(req, false), req);
      if (attempt.status !== 'in_progress' || !attempt.responseCollectionComplete) throw fail('grading_input_unavailable');
      await abortOnGovernance(attempt, req.correlationId);
      res.json(gradingInput(attempt));
    } catch (error) { sendError(req, res, error); }
  });
  // Issue #20: deterministic fallback grading. validation-activation scores the
  // pinned bank (it alone holds the answers); the Engine only records the
  // outcome through the same finalize/abort commands as standard grading.
  // Scoring happens at most once per attempt upstream, so the store commands
  // use fixed per-attempt identities: a retry replays rather than re-scores.
  app.post('/internal/attempts/:id/fallback-finalize', trusted, async (req, res) => {
    if (!scoreFallback) return res.status(503).json({ apiVersion: 'v1', error: 'fallback_not_configured', correlationId: req.correlationId });
    try {
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 1 ||
        typeof req.body.idempotencyKey !== 'string' || !KEY.test(req.body.idempotencyKey)) throw fail('invalid_request', 400);
      let attempt = await reconcile(await load(req, false), req);
      if (attempt.mode !== 'fallback') throw fail('fallback_attempt_required');
      const reply = (outcome, current) => res.json({ apiVersion: 'v1', outcome, attempt: lifecycleView(current),
        correlationId: req.correlationId });
      if (attempt.status !== 'in_progress') return reply('replay', attempt);
      // Same refusal the store's finalize command gives an incomplete attempt.
      if (!attempt.responseCollectionComplete) throw fail('responses_incomplete');
      const id = attempt.attemptId;
      const record = async (command, options = {}) => {
        try {
          return (await store.command(id, { idempotencyKey: `fallback-finalize:${id}`, expectedSequence: attempt.sequence,
            now: clock(), correlationId: req.correlationId, ...command }, { clock, ...options })).attempt;
        } catch (error) {
          // A concurrent call may already have recorded the single terminal outcome.
          const current = error.status === 409 && await store.get(id);
          if (current && current.status !== 'in_progress') return current;
          throw error;
        }
      };
      const abort = (reason) => record({ type: 'abort', eventId: `fallback-abort:${id}`, reason });
      // A quarantine or replacement since admission ends the attempt before scoring.
      // An unreachable dependency propagates and leaves it in progress, safe to retry.
      let pkg;
      try { pkg = await active(req.correlationId); }
      catch (error) {
        if (error.status !== 409) throw error;
        return reply('accepted', await abort('governance_changed'));
      }
      if (pkg.packageId !== attempt.package.id || pkg.version !== attempt.package.version || pkg.digest !== attempt.package.digest)
        return reply('accepted', await abort('governance_changed'));
      const input = gradingInput(attempt);
      // Responses are stored as canonical JSON (encodeFallbackAnswer). One that does
      // not decode cannot be judged, so the system aborts rather than guess an answer.
      let responses;
      try { responses = input.responses.map(({ itemId, response }) => ({ itemId, answer: JSON.parse(response) })); }
      catch { return reply('accepted', await abort('grading_unavailable')); }
      let scored;
      try {
        scored = await scoreFallback({ pkg, vaSelectionId: attempt.form.vaSelectionId, responses, correlationId: req.correlationId });
      } catch (error) {
        if (error instanceof DependencyError || error.status !== 409) throw error;
        // Refused (quarantined, not selected, incomplete, or already scored with no result to recover).
        return reply('accepted', await abort('grading_unavailable'));
      }
      // Only valid/passed cross this boundary; per-item results are never kept or returned.
      const result = mapFallbackResult(scored);
      if (!result.valid) return reply('accepted', await abort('grading_unavailable'));
      attempt = await record({ type: 'finalize', eventId: `fallback-grade:${id}`, formDigest: input.formDigest,
        rubricDigest: input.rubricDigest, responseSetDigest: input.responseSetDigest, result },
      { guard: (current) => governance(current, req.correlationId) });
      reply('accepted', attempt);
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

// The trusted grading view of a complete attempt. Shared by grading-input and
// fallback-finalize so both bind to exactly the same digests.
function gradingInput(attempt) {
  return { attemptId: attempt.attemptId, sequence: attempt.sequence, form: attempt.form, formDigest: attempt.formDigest,
    rubricDigest: attempt.form.rubric.digest, responseSetDigest: attempt.responseSetDigest,
    responses: attempt.responses.map(({ itemId, response, responseDigest, acceptedAt }) => ({ itemId, response, responseDigest, acceptedAt })) };
}
function lifecycleView(attempt) {
  const result = {};
  for (const field of ['attemptId','status','sequence','responsesReceived','responseCollectionComplete','terminalReason',
    'completedAt','failedAt','abortedAt','mode','startedAt','deadlineAt']) result[field] = attempt[field];
  return result;
}
function learnerView(attempt, now = attempt.startedAt) {
  const deliver = attempt.status === 'in_progress' && Date.parse(now) < Date.parse(attempt.deadlineAt);
  // Each mode has its own projection; the standard one would drop answerType/choices.
  const project = attempt.mode === 'fallback' ? publicFallbackForm : publicForm;
  return { ...lifecycleView(attempt), ...(deliver ? { form: project(attempt.form) } : {}) };
}
function consoleView(attempt) {
  // A fallback attempt has no template, generation policy or Training event, and its
  // validation-activation selection id is internal; it gets its own identifier-only view.
  if (attempt.mode === 'fallback') return { ...lifecycleView(attempt), agentLearnerKey: attempt.agentLearnerKey,
    configurationFingerprint: attempt.configurationFingerprint, package: attempt.package, rubric: attempt.form.rubric,
    causeAttemptId: attempt.form.causeAttemptId, reason: attempt.form.reason,
    bank: { id: attempt.form.bankId, version: attempt.form.bankVersion }, formDigest: attempt.formDigest,
    itemReferences: attempt.form.items.map((item) => ({ id: item.id, tier: item.tier, answerType: item.answerType,
      objectiveIds: item.objectiveIds })) };
  return { ...lifecycleView(attempt), agentLearnerKey: attempt.agentLearnerKey, configurationFingerprint: attempt.configurationFingerprint,
    package: attempt.package, template: attempt.form.template, rubric: attempt.form.rubric,
    generationPolicySha256: attempt.form.generationPolicySha256, trainingEventId: attempt.form.training.eventId, formDigest: attempt.formDigest,
    itemReferences: attempt.form.items.map((item) => ({ id: item.id, slotId: item.slotId,
      promptSha256: item.promptSha256, tier: item.tier, moduleIds: item.moduleIds, objectiveIds: item.objectiveIds })) };
}
function sendError(req, res, error) {
  const extra = error.attempt ? { attempt: lifecycleView(error.attempt) } : {};
  if (error instanceof DependencyError) return res.status(error.status).json({ apiVersion: 'v1',
    error: 'dependency_unavailable', dependency: error.source, correlationId: req.correlationId, ...extra });
  if (error instanceof GenerationError) return res.status(409).json({ apiVersion: 'v1', error: error.code, correlationId: req.correlationId });
  if ([400,403,404,409].includes(error.status)) return res.status(error.status).json({ apiVersion: 'v1',
    error: error.code || error.message, correlationId: req.correlationId, ...extra });
  telemetry.log('examination-engine', 'request_failed', { correlationId: req.correlationId });
  return res.status(500).json({ apiVersion: 'v1', error: 'internal_error', correlationId: req.correlationId, ...extra });
}
async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => telemetry.log('examination-engine', 'postgres_connection_error'));
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  const store = createPgStore(pool);
  const sweep = () => store.sweepExpired(new Date().toISOString());
  await sweep();
  let sweeping = false;
  const timer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try { await sweep(); } catch { telemetry.log('examination-engine', 'deadline_reconciliation_failed'); }
    finally { sweeping = false; }
  }, 30000);
  timer.unref();
  const server = createApp({ store, sources: createSources(), selectFallback: createFallbackSelect(),
    scoreFallback: createFallbackScore() }).listen(process.env.PORT || 4005);
  server.on('close', () => { clearInterval(timer); void pool.end(); });
}
if (require.main === module) start().catch((error) => {
  console.error('examination-engine startup failed', error.code || error.name);
  process.exitCode = 1;
});
module.exports = { createApp, learnerView, consoleView };
