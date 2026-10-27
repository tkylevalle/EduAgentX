'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const telemetry = require('../../packages/telemetry');
const { fail, digest, validatedEvidence, issueCredential } = require('./evidence');
const { createPgStore } = require('./store');
const { createCredentialPublisher } = require('./publisher');

const matchesSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function createApp({ store, examinationEvidence, internalKey = process.env.CERTIFICATION_INTERNAL_KEY,
  packageTrust = async () => true,
  privateKey = null, keyId = process.env.CERTIFICATION_KEY_ID,
  issuer = process.env.CERTIFICATION_ISSUER, credentialBase = process.env.CREDENTIAL_BASE_URL,
  clock = () => new Date().toISOString() } = {}) {
  if (!store || typeof examinationEvidence !== 'function' || !internalKey) throw new Error('store, evidence source and internal key required');
  const app = express();
  app.use((req, res, next) => { req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId); next(); });
  app.use(telemetry.middleware('certification-service'));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', async (_req, res) => {
    try { await store.health(); res.json({ status: 'ok', service: 'certification-service' }); }
    catch { res.status(503).json({ status: 'unhealthy', service: 'certification-service' }); }
  });
  app.use('/internal', (req, res, next) => {
    if (!matchesSecret(req.header('x-internal-service-key'), internalKey)) return res.status(403).json({ error: 'forbidden' });
    // The Gateway may only read; decisions are commanded by the Examination Engine.
    const role = req.header('x-actor-role');
    const allowed = role === 'examination-engine' || (role === 'gateway' && req.method === 'GET');
    if (!allowed || !req.header('x-actor-subject')) return res.status(403).json({ error: 'forbidden' });
    next();
  });
  const issueOne = async (examinationId, idempotencyKey, correlationId) => {
    const replay = await store.findByAttempt(examinationId);
    if (replay) return replay;
    const latencyStartedAt = process.hrtime.bigint();
    const source = await examinationEvidence(examinationId, correlationId);
    const pending = validatedEvidence(source);
    const trustedPackage = await packageTrust(pending.packageId, pending.packageVersion, correlationId);
    if (!trustedPackage) throw fail('package_quarantined');
    const evidence = validatedEvidence(source, trustedPackage);
    return store.issue({ evidence, commandKey: idempotencyKey,
      commandDigest: digest({ examinationId, idempotencyKey }),
      latencyStartedAt,
      createCredential: () => issueCredential(evidence, { privateKey, keyId, issuer, credentialBase, now: clock }) });
  };
  app.post('/internal/decisions', async (req, res) => {
    try {
      const { examinationId, idempotencyKey } = req.body || {};
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 2 ||
          typeof examinationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(examinationId) ||
          typeof idempotencyKey !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(idempotencyKey))
        throw fail('invalid_request', 400);
      // A durable replay is returned even while Examination is unavailable.
      const row = await issueOne(examinationId, idempotencyKey, req.correlationId);
      res.status(row.replay ? 200 : 201).json({ apiVersion: 'v1', outcome: row.replay ? 'replay' : 'issued',
        decision: row.decision, credential: row.credential, correlationId: req.correlationId });
    } catch (error) {
      if ([400, 403, 404, 409, 503].includes(error.status)) return res.status(error.status).json({
        apiVersion: 'v1', error: error.code || 'certification_rejected', correlationId: req.correlationId });
      telemetry.log('certification-service', 'decision_failed', { correlationId: req.correlationId });
      res.status(503).json({ apiVersion: 'v1', error: 'certification_unavailable', correlationId: req.correlationId });
    }
  });
  app.get('/internal/decisions/by-examination/:id', async (req, res) => {
    try {
      const row = await store.findByAttempt(req.params.id);
      if (!row) return res.status(404).json({ apiVersion: 'v1', error: 'decision_not_found', correlationId: req.correlationId });
      res.json({ apiVersion: 'v1', outcome: 'found', decision: row.decision, credential: row.credential,
        correlationId: req.correlationId });
    } catch { res.status(503).json({ apiVersion: 'v1', error: 'certification_unavailable', correlationId: req.correlationId }); }
  });
  app.get('/internal/credentials', async (req, res) => {
    const limit = Number(req.query.limit || 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', correlationId: req.correlationId });
    try {
      res.json({ apiVersion: 'v1', credentials: await store.listCredentials(limit), correlationId: req.correlationId });
    } catch { res.status(503).json({ apiVersion: 'v1', error: 'certification_unavailable', correlationId: req.correlationId }); }
  });
  app.get('/internal/kpi/issuance', async (_req, res) => {
    try {
      const result = await store.issuanceKpi();
      res.json({ apiVersion: 'v1', metric: 'credential_issuance_latency_ms', sampleCount: result.sampleCount,
        p95Ms: result.p95Ms, processingP95Ms: result.processingP95Ms,
        targetMs: 5000, acceptanceMaximumMs: 8000,
        targetMet: result.sampleCount > 0 ? result.p95Ms <= 5000 : null,
        acceptanceMet: result.sampleCount > 0 ? result.p95Ms <= 8000 : null });
    } catch { res.status(503).json({ apiVersion: 'v1', error: 'certification_unavailable' }); }
  });
  return app;
}

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => telemetry.log('certification-service', 'postgres_connection_error'));
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const privateKey = process.env.CERTIFICATION_PRIVATE_KEY_PATH
    ? fs.readFileSync(process.env.CERTIFICATION_PRIVATE_KEY_PATH, 'utf8') : null;
  const evidenceUrl = process.env.EXAMINATION_ENGINE_URL || 'http://examination-engine:4005';
  const internalKey = process.env.EXAMINATION_INTERNAL_KEY;
  const examinationEvidence = async (id, correlationId) => {
    const response = await fetch(`${evidenceUrl}/internal/certification-evidence/${encodeURIComponent(id)}`, {
      headers: { 'x-internal-service-key': internalKey, 'x-actor-subject': 'certification-service',
        'x-actor-role': 'certification', 'x-correlation-id': correlationId }, signal: AbortSignal.timeout(3000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || 'examination_evidence_unavailable'),
      { code: body.error || 'examination_evidence_unavailable', status: response.status === 404 ? 404 : 503 });
    return body.attempt;
  };
  const packageTrust = async (packageId, version, correlationId) => {
    const url = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010';
    const response = await fetch(`${url}/packages/${encodeURIComponent(packageId)}?version=${encodeURIComponent(version)}`, {
      headers: { 'x-internal-service-key': process.env.CURRICULUM_INTERNAL_KEY,
        'x-actor-subject': 'certification-service', 'x-correlation-id': correlationId || '' },
      signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      if (response.status === 404) throw fail('package_evidence_unavailable');
      throw fail('package_trust_unavailable', 503);
    }
    const pkg = await response.json().catch(() => null);
    if (!pkg || pkg.certificationBlocked || (Array.isArray(pkg.quarantinedScopes) && pkg.quarantinedScopes.length)) return false;
    return pkg;
  };
  const store = createPgStore(pool);
  const redis = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
    socket: { connectTimeout: 2000 } }) : null;
  if (redis) {
    redis.on('error', () => telemetry.log('certification-service', 'redis_connection_error'));
    redis.connect().catch(() => telemetry.log('certification-service', 'redis_connect_failed'));
  }
  const publisher = createCredentialPublisher({ pool, redis,
    stream: process.env.CREDENTIAL_EVENT_STREAM || 'certification.credentials',
    verificationUrl: process.env.CREDENTIAL_VERIFICATION_URL || null,
    verificationKey: process.env.CREDENTIAL_INTERNAL_KEY || null,
    monitoringUrl: process.env.MONITORING_URL || null });
  const server = createApp({ store, examinationEvidence,
    internalKey: process.env.CERTIFICATION_INTERNAL_KEY, privateKey, packageTrust }).listen(process.env.PORT || 4011);
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const cursor = await store.getCursor();
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) { query.set('afterCompletedAt', cursor.completedAt); query.set('afterAttemptId', cursor.examinationId); }
      const response = await fetch(`${evidenceUrl}/internal/certification-candidates?${query}`, {
        headers: { 'x-internal-service-key': internalKey, 'x-actor-subject': 'certification-service',
          'x-actor-role': 'certification' }, signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('candidate_source_unavailable');
      const { candidates = [] } = await response.json();
      for (const candidate of candidates) {
        const existing = await store.findByAttempt(candidate.examinationId);
        if (!existing) {
          const latencyStartedAt = process.hrtime.bigint();
          try {
            const source = await examinationEvidence(candidate.examinationId);
            const pending = validatedEvidence(source);
            const trustedPackage = await packageTrust(pending.packageId, pending.packageVersion);
            if (!trustedPackage) throw fail('package_quarantined');
            const evidence = validatedEvidence(source, trustedPackage);
            await store.issue({ evidence, commandKey: `examination:${candidate.examinationId}`,
              commandDigest: digest({ examinationId: candidate.examinationId, event: 'attempt_completed' }),
              latencyStartedAt,
              createCredential: () => issueCredential(evidence, { privateKey, keyId: process.env.CERTIFICATION_KEY_ID,
                issuer: process.env.CERTIFICATION_ISSUER, credentialBase: process.env.CREDENTIAL_BASE_URL }) });
          } catch (error) {
            // Permanently invalid evidence must never receive a decision, but it
            // also must not block later passing examinations in the cursor.
            if (![400, 404, 409].includes(error.status) || error.code === 'package_quarantined') throw error;
            telemetry.log('certification-service', 'issuance_candidate_rejected', { outcome: error.code || 'invalid_evidence' });
          }
        }
        await store.advanceCursor(candidate);
      }
    } catch { telemetry.log('certification-service', 'issuance_sweep_unavailable'); }
    try { await publisher.publishPending(); }
    catch { telemetry.log('certification-service', 'credential_publication_unavailable'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void sweep(), Number(process.env.CERTIFICATION_SWEEP_INTERVAL_MS || 1000));
  timer.unref();
  void sweep();
  server.on('close', () => { clearInterval(timer); void pool.end(); if (redis?.isOpen) void redis.quit(); });
  return server;
}

if (require.main === module) start();
module.exports = { createApp, start };
