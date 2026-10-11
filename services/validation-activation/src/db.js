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
const _freshness = new Map();
const _scopeEvents = new Map();
let _activePointer = null;

const db = {
  async getPackage(id) {
    if (!pool) return _packages.get(id) || null;
    const r = await pool.query(
      `SELECT package_id AS id, version, domain,
              payload, digest,
               (SELECT state FROM curriculum_engine.package_lifecycle_events
               WHERE package_id=p.package_id AND version=p.version ORDER BY event_id DESC LIMIT 1) AS state
       FROM curriculum_engine.packages p WHERE p.package_id=$1 ORDER BY p.created_at DESC LIMIT 1`, [id]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { ...row.payload, id: row.id, version: row.version, digest: row.digest, state: row.state || 'Candidate' };
  },

  async listPackages() {
    if (!pool) return Array.from(_packages.values());
    const r = await pool.query(
      `SELECT p.package_id AS id, p.version, p.digest, latest.state
       FROM curriculum_engine.packages p
       LEFT JOIN LATERAL (
         SELECT state FROM curriculum_engine.package_lifecycle_events e
         WHERE e.package_id=p.package_id AND e.version=p.version ORDER BY e.event_id DESC LIMIT 1
       ) latest ON true
       ORDER BY p.created_at DESC`);
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
       FROM curriculum_engine.packages WHERE package_id=$1 ORDER BY created_at DESC LIMIT 1`,
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
       JOIN LATERAL (
         SELECT state FROM curriculum_engine.package_lifecycle_events e
         WHERE e.package_id=p.package_id AND e.version=p.version ORDER BY e.event_id DESC LIMIT 1
       ) e ON e.state='Active'
       ORDER BY p.created_at DESC LIMIT 1`);
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
      `INSERT INTO curriculum_engine.package_evidence (package_id, version, event, payload, actor, occurred_at)
       SELECT package_id, version, $2, $3, $4, COALESCE(($3::jsonb->>'ts')::timestamptz, now())
       FROM curriculum_engine.packages WHERE package_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [package_id, entry.event || 'evidence', entry, entry.actor || 'validation-activation']);
  },

  async getEvidence(package_id) {
    if (!pool) return _evidence.get(package_id) || [];
    const r = await pool.query(
      `SELECT event, payload, actor, occurred_at AS "occurredAt"
       FROM curriculum_engine.package_evidence
       WHERE package_id=$1 ORDER BY evidence_id ASC`, [package_id]);
    return r.rows.map((row) => ({ ...row.payload, event: row.event, actor: row.actor, occurredAt: row.occurredAt }));
  },

  async appendFreshnessCheck(packageId, version, record) {
    if (!pool) {
      const key = `${packageId}@${version}`;
      if (!_freshness.has(key)) _freshness.set(key, []);
      _freshness.get(key).push(structuredClone(record));
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.freshness_checks
         (package_id, version, source_id, classification, evidence, actor, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [packageId, version, record.sourceId, record.classification, record.evidence, record.actor, record.checkedAt]);
  },

  async getFreshnessChecks(packageId, version) {
    if (!pool) return structuredClone(_freshness.get(`${packageId}@${version}`) || []);
    const result = await pool.query(
      `SELECT source_id AS "sourceId", classification, evidence, actor, checked_at AS "checkedAt"
       FROM curriculum_engine.freshness_checks WHERE package_id=$1 AND version=$2 ORDER BY check_id`,
      [packageId, version]);
    return result.rows;
  },

  async appendScopeEvent(packageId, version, scopeEvent) {
    if (!pool) {
      const key = `${packageId}@${version}`;
      if (!_scopeEvents.has(key)) _scopeEvents.set(key, []);
      _scopeEvents.get(key).push(structuredClone(scopeEvent));
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.package_scope_events
         (package_id, version, scope_type, scope_id, event, evidence, actor, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [packageId, version, scopeEvent.scopeType, scopeEvent.scopeId, scopeEvent.event, scopeEvent.evidence, scopeEvent.actor, scopeEvent.occurredAt]);
  },

  async getScopedQuarantines(packageId, version) {
    if (!pool) {
      const events = _scopeEvents.get(`${packageId}@${version}`) || [];
      const latest = new Map();
      for (const event of events) latest.set(`${event.scopeType}:${event.scopeId}`, event);
      return [...latest.values()].filter((event) => event.event === 'quarantined').map((event) => ({
        scopeType: event.scopeType, scopeId: event.scopeId, evidence: event.evidence,
      }));
    }
    const result = await pool.query(
      `SELECT DISTINCT ON (scope_type, scope_id) scope_type AS "scopeType", scope_id AS "scopeId", event, evidence
       FROM curriculum_engine.package_scope_events WHERE package_id=$1 AND version=$2
       ORDER BY scope_type, scope_id, event_id DESC`, [packageId, version]);
    return result.rows.filter((row) => row.event === 'quarantined').map(({ scopeType, scopeId, evidence }) => ({ scopeType, scopeId, evidence }));
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
