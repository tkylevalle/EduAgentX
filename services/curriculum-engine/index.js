'use strict';

const fs = require('node:fs');
const express = require('express');
const { Pool } = require('pg');
const { sha256, validatePackage } = require('./model');

function createApp({ pool, internalKey = process.env.CURRICULUM_INTERNAL_KEY } = {}) {
  if (!pool || !internalKey) throw new Error('database and internal key required');
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'curriculum-engine' }); }
    catch { res.status(503).json({ status: 'unhealthy', service: 'curriculum-engine' }); }
  });
  app.use('/internal/packages', (req, res, next) => {
    if (req.header('x-internal-service-key') !== internalKey) return res.status(403).json({ error: 'forbidden' });
    if (!req.header('x-actor-subject')) return res.status(400).json({ error: 'actor_required' });
    next();
  });
  app.post('/internal/packages', async (req, res) => {
    const errors = validatePackage(req.body);
    if (errors.length) return res.status(422).json({ error: 'invalid_candidate', details: errors });
    const pkg = req.body, { packageId, version, domain } = pkg.manifest;
    const digest = sha256(pkg);
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO curriculum_engine.packages (package_id, version, domain, payload, digest, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING package_id`,
        [packageId, version, domain, pkg, digest, req.header('x-actor-subject')]
      );
      if (!inserted.rowCount) {
        const previous = await client.query('SELECT digest FROM curriculum_engine.packages WHERE package_id=$1 AND version=$2', [packageId, version]);
        await client.query('ROLLBACK');
        return previous.rows[0]?.digest === digest
          ? res.status(200).json({ packageId, version, state: 'Candidate', digest, replay: true })
          : res.status(409).json({ error: 'immutable_version_conflict' });
      }
      await client.query(
        `INSERT INTO curriculum_engine.package_lifecycle_events (package_id, version, state, actor, reason)
         VALUES ($1, $2, 'Candidate', $3, 'candidate_ingested')`,
        [packageId, version, req.header('x-actor-subject')]
      );
      await client.query('COMMIT');
      return res.status(201).json({ packageId, version, state: 'Candidate', digest });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return res.status(503).json({ error: 'package_store_unavailable' });
    } finally { client?.release(); }
  });
  app.get('/internal/packages/:packageId/:version', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.payload, p.digest, p.created_by, p.created_at,
          (SELECT e.state FROM curriculum_engine.package_lifecycle_events e
           WHERE e.package_id=p.package_id AND e.version=p.version ORDER BY e.event_id DESC LIMIT 1) AS state
         FROM curriculum_engine.packages p WHERE p.package_id=$1 AND p.version=$2`,
        [req.params.packageId, req.params.version]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'package_not_found' });
      return res.json({ ...result.rows[0], packageId: req.params.packageId, version: req.params.version });
    } catch { return res.status(503).json({ error: 'package_store_unavailable' }); }
  });
  app.get('/internal/packages/:packageId/:version/events', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT event_id, state, actor, recorded_at, reason FROM curriculum_engine.package_lifecycle_events
         WHERE package_id=$1 AND version=$2 ORDER BY event_id`,
        [req.params.packageId, req.params.version]
      );
      return res.json({ events: result.rows });
    } catch { return res.status(503).json({ error: 'package_store_unavailable' }); }
  });
  return app;
}

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(`${__dirname}/schema.sql`, 'utf8'));
  createApp({ pool }).listen(process.env.PORT || 4002);
}
if (require.main === module) start().catch((error) => {
  console.error('curriculum-engine startup failed', error.code || error.name);
  process.exitCode = 1;
});
module.exports = { createApp };
