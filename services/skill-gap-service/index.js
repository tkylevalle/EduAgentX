'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const telemetry = require('../../packages/telemetry');
const { createPgStore } = require('./store');
const { createSources } = require('./clients');
const { identifier, digest, fail, command, normalizeExamination, normalizeMarketplace, recommend, trainingRequest } = require('./model');
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PERMANENT = new Set(['invalid_request','not_registered','unknown_objectives','no_targeted_content',
  'remediation_request_conflict','package_mismatch','package_not_pinnable','package_not_deliverable','insufficient_practice']);
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

function createApp({ store, sources, internalKey, clock = () => new Date().toISOString() } = {}) {
  if (!store || !sources) throw new Error('store and sources required');
  const app = express();
  app.use((req,res,next) => { req.correlationId = req.header('x-correlation-id') || randomUUID(); res.setHeader('x-correlation-id',req.correlationId); next(); });
  app.use(telemetry.middleware('skill-gap-service'));
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', async (_req,res) => {
    try { if (!internalKey) throw new Error(); await store.health(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unhealthy' }); }
  });
  app.use('/internal', (req,res,next) => {
    if (!internalKey) return res.status(503).json({ error: 'skill_gap_unavailable' });
    if (!same(req.header('x-internal-service-key'),internalKey) || !identifier(req.header('x-actor-subject')))
      return res.status(401).json({ error: 'unauthorized' });
    // Same admin authority as the existing targeted Training command.
    if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  });
  const route = (work) => async (req,res) => {
    try { const { status = 200, ...body } = await work(req); res.status(status).json({ apiVersion: 'v1', ...body, correlationId: req.correlationId }); }
    catch (error) {
      const known = [400,404,409,422,503].includes(error.status);
      res.status(known ? error.status : 503).json({ apiVersion: 'v1', error: known ? error.code : 'skill_gap_unavailable', correlationId: req.correlationId });
    }
  };
  app.post('/internal/recommendations', route(async (req) => {
    let input;
    try { input = command(req.body); } catch { throw fail('invalid_request',400); }
    const fingerprint = digest(input), actor = req.header('x-actor-subject');
    const prior = await store.byCommand(actor,req.body.idempotencyKey);
    if (prior) {
      if (prior.digest !== fingerprint) throw fail('idempotency_conflict',409);
      return { outcome: 'replay', recommendation: prior.document };
    }
    const raw = await sources[input.source.type](input.source.id,req.correlationId);
    const normalized = input.source.type === 'examination' ? normalizeExamination(raw,input) : normalizeMarketplace(raw,input);
    const pkg = await sources.package(input.source.type === 'examination' ? normalized.package : null,req.correlationId);
    const r = recommend(input,normalized,pkg,clock());
    const saved = await store.create(r,actor,req.body.idempotencyKey,fingerprint);
    return { status: saved.replay ? 200 : 201, outcome: saved.replay ? 'replay' : 'created', recommendation: saved.recommendation };
  }));
  app.get('/internal/recommendations/:id', route(async (req) => {
    const r = UUID.test(req.params.id) ? await store.get(req.params.id) : null;
    if (!r) throw fail('recommendation_not_found',404);
    return { recommendation: r, delivery: await store.delivery(r.recommendationId) };
  }));
  app.post('/internal/recommendations/:id/training-handoff', route(async (req) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw fail('invalid_request',400);
    if (!UUID.test(req.params.id)) throw fail('recommendation_not_found',404);
    const deliver = async (r) => {
      if (r.trainingOwner === 'examination-engine') {
        const trace = await sources.examination(r.source.id,req.correlationId);
        const fresh = normalizeExamination(trace,{ source: r.source, agentLearnerKey: r.agentLearnerKey });
        if (fresh.source.digest !== r.source.digest) throw fail('source_conflict',409);
        const d = trace.remediation.delivery;
        if (!d) return { outcome: 'pending', owner: r.trainingOwner };
        if (d.eventId !== r.source.eventId || !['delivered','refused'].includes(d.outcome) ||
          (d.outcome === 'delivered' && !identifier(d.trainingSessionId))) throw fail('invalid_source');
        return { outcome: d.outcome, owner: r.trainingOwner, trainingSessionId: d.trainingSessionId ?? null };
      }
      if (!r.trainingScope.objectiveIds.length) return { outcome: 'refused', reason: 'no_targeted_training' };
      // Validate pinned content remains unchanged before assigning. Training rechecks active state itself.
      const pkg = await sources.package(r.trainingScope.package,req.correlationId);
      if (pkg?.digest !== r.trainingScope.package.digest || pkg?.state !== 'Active' || pkg.certificationBlocked !== false || pkg.quarantinedScopes?.length !== 0)
        return { outcome: 'pending', reason: 'package_unavailable' };
      let reply;
      try { reply = await sources.training(trainingRequest(r),req.correlationId); }
      catch { return { outcome: 'pending', reason: 'training_unavailable' }; }
      if ([200,201].includes(reply.status) && identifier(reply.body?.sessionId))
        return { outcome: 'delivered', owner: r.trainingOwner, trainingSessionId: reply.body.sessionId };
      if (reply.status >= 400 && reply.status < 500 && PERMANENT.has(reply.body?.error))
        return { outcome: 'refused', reason: reply.body.error };
      return { outcome: 'pending', reason: 'training_unavailable' };
    };
    const delivery = await store.handoff(req.params.id, async (r) => ({ ...await deliver(r),
      requestedBy: req.header('x-actor-subject'), checkedAt: clock() }));
    return { status: delivery.outcome === 'pending' ? 202 : 200, delivery };
  }));
  app.use((error,_req,res,_next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_request' }));
  return app;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  const sources = createSources({ examinationUrl: process.env.EXAMINATION_ENGINE_URL, examinationKey: process.env.EXAMINATION_INTERNAL_KEY,
    marketplaceUrl: process.env.MARKETPLACE_SERVICE_URL, marketplaceKey: process.env.MARKETPLACE_INTERNAL_KEY,
    packageUrl: process.env.VALIDATION_ACTIVATION_URL, packageKey: process.env.CURRICULUM_INTERNAL_KEY,
    trainingUrl: process.env.TRAINING_SERVICE_URL, trainingKey: process.env.TRAINING_INTERNAL_KEY });
  createApp({ store: createPgStore(pool), sources, internalKey: process.env.SKILL_GAP_INTERNAL_KEY }).listen(process.env.PORT || 4013);
}
if (require.main === module) main().catch(() => { console.error('skill-gap-service startup failed'); process.exitCode = 1; });
module.exports = { createApp };
