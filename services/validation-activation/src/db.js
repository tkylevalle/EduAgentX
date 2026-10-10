'use strict';
/**
 * Persistent store — uses PostgreSQL via curriculum_engine schema.
 * Falls back to in-memory if DATABASE_URL is not set (test/dev).
 */
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

// In-memory fallback
const _packages = new Map();
const _evidence = new Map();
let _activePointer = null;

const db = {
  async getPackage(id) {
    if (!pool) return _packages.get(id) || null;
    const r = await pool.query(
      `SELECT package_id AS id, version, domain,
              payload, digest,
              (SELECT state FROM curriculum_engine.package_lifecycle_events
               WHERE package_id=$1 ORDER BY recorded_at DESC LIMIT 1) AS state
       FROM curriculum_engine.packages WHERE package_id=$1`, [id]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { ...row.payload, id: row.id, version: row.version, digest: row.digest, state: row.state || 'Candidate' };
  },

  async listPackages() {
    if (!pool) return Array.from(_packages.values());
    const r = await pool.query(
      `SELECT DISTINCT ON (p.package_id) p.package_id AS id, p.version, p.digest,
              e.state
       FROM curriculum_engine.packages p
       LEFT JOIN curriculum_engine.package_lifecycle_events e ON e.package_id = p.package_id
       ORDER BY p.package_id, e.recorded_at DESC`);
    return r.rows;
  },

  async setPackageState(id, state) {
    if (!pool) {
      const pkg = _packages.get(id);
      if (pkg) { pkg.state = state; _packages.set(id, pkg); }
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.package_lifecycle_events
         (package_id, version, state, actor, reason)
       SELECT package_id, version, $2, 'validation-activation', $3
       FROM curriculum_engine.packages WHERE package_id=$1`,
      [id, state, `State set to ${state} by validation-activation`]);
  },

  async getActivePackage() {
    if (!pool) {
      if (!_activePointer) return null;
      return _packages.get(_activePointer) || null;
    }
    const r = await pool.query(
      `SELECT p.package_id AS id, p.version, p.domain, p.payload, p.digest
       FROM curriculum_engine.packages p
       JOIN curriculum_engine.package_lifecycle_events e ON e.package_id = p.package_id
       WHERE e.state = 'Active'
       ORDER BY e.recorded_at DESC LIMIT 1`);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { ...row.payload, id: row.id, version: row.version, digest: row.digest, state: 'Active' };
  },

  async setActivePointer(id) {
    if (!pool) { _activePointer = id; return; }
    // State already written by setPackageState — nothing extra needed
  },

  async appendEvidence(package_id, entry) {
    if (!pool) {
      if (!_evidence.has(package_id)) _evidence.set(package_id, []);
      _evidence.get(package_id).push(entry);
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.package_lifecycle_events
         (package_id, version, state, actor, reason)
       SELECT package_id, version, $2, 'validation-activation', $3
       FROM curriculum_engine.packages WHERE package_id=$1`,
      [package_id, entry.event || 'evidence', JSON.stringify(entry)]);
  },

  async getEvidence(package_id) {
    if (!pool) return _evidence.get(package_id) || [];
    const r = await pool.query(
      `SELECT state, actor, reason, recorded_at
       FROM curriculum_engine.package_lifecycle_events
       WHERE package_id=$1 ORDER BY recorded_at ASC`, [package_id]);
    return r.rows;
  },

  async seedPackage(pkg) {
    // Resolve id from manifest.packageId or pkg.id
    const id = pkg.id || pkg.manifest?.packageId;
    if (!id) throw new Error('seedPackage: no id or manifest.packageId');
    if (!pool) {
      _packages.set(id, { ...pkg, id, state: pkg.state || 'Candidate' });
      return;
    }
    const version = pkg.version || pkg.manifest?.version || '0.0.0';
    const domain = pkg.domain || pkg.manifest?.domain || 'unknown';
    const digest = require('node:crypto').createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
    await pool.query(
      `INSERT INTO curriculum_engine.packages (package_id, version, domain, payload, digest, created_by)
       VALUES ($1,$2,$3,$4,$5,'validation-activation') ON CONFLICT DO NOTHING`,
      [id, version, domain, pkg, digest]);
  }
};

module.exports = { db };
