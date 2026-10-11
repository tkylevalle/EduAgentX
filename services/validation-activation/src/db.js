'use strict';
/**
 * Persistent store — uses PostgreSQL via curriculum_engine schema.
 * Falls back to in-memory if DATABASE_URL is not set (test/dev).
 */
const { Pool } = require('pg');
const { sha256 } = require('../../curriculum-engine/model');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
if (pool) pool.on('error', () => { /* idle client errors must not crash the process */ });

// In-memory fallback
const _packages = new Map();
const _evidence = new Map();
const _freshness = new Map();
const _scopeEvents = new Map();
const _reviews = new Map();
const _fallbackScores = new Set();
let _activePointer = null;
let activationQueue = Promise.resolve();
const keyOf = (id, version) => `${id}@${version}`;

const db = {
  async getPackage(id, version) {
    if (!pool) {
      const values = [..._packages.values()].filter(pkg => pkg.id === id && (!version || pkg.version === version));
      return values.at(-1) || null;
    }
    const r = await pool.query(
      `SELECT package_id AS id, version, domain,
              payload, digest, created_by AS "createdBy",
               (SELECT state FROM curriculum_engine.package_lifecycle_events
               WHERE package_id=p.package_id AND version=p.version ORDER BY event_id DESC LIMIT 1) AS state
       FROM curriculum_engine.packages p WHERE p.package_id=$1 AND ($2::text IS NULL OR p.version=$2)
       ORDER BY p.created_at DESC LIMIT 1`, [id, version || null]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { ...row.payload, id: row.id, version: row.version, digest: row.digest,
      createdBy: row.createdBy, state: row.state || 'Candidate' };
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

  async setPackageState(id, state, version) {
    if (!pool) {
      const pkg = await this.getPackage(id, version);
      if (pkg) { pkg.state = state; _packages.set(keyOf(pkg.id, pkg.version), pkg); }
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.package_lifecycle_events
         (package_id, version, state, actor, reason)
       SELECT package_id, version, $2, 'validation-activation', $3
       FROM curriculum_engine.packages WHERE package_id=$1 AND ($4::text IS NULL OR version=$4)
       ORDER BY created_at DESC LIMIT 1`,
      [id, state, `State set to ${state} by validation-activation`, version || null]);
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

  async setActivePointer(id, version) {
    if (!pool) { _activePointer = keyOf(id, version || (await this.getPackage(id))?.version); return; }
    // State already written by setPackageState — nothing extra needed
  },

  async appendEvidence(package_id, entry, version) {
    if (!pool) {
      const pkg = await this.getPackage(package_id, version);
      const key = keyOf(package_id, pkg?.version || version);
      if (!_evidence.has(key)) _evidence.set(key, []);
      _evidence.get(key).push(entry);
      return;
    }
    await pool.query(
      `INSERT INTO curriculum_engine.package_evidence (package_id, version, event, payload, actor, occurred_at)
       SELECT package_id, version, $2, $3, $4, COALESCE(($3::jsonb->>'ts')::timestamptz, now())
       FROM curriculum_engine.packages WHERE package_id=$1 AND ($5::text IS NULL OR version=$5)
       ORDER BY created_at DESC LIMIT 1`,
      [package_id, entry.event || 'evidence', entry, entry.actor || 'validation-activation', version || null]);
  },

  async getEvidence(package_id, version) {
    if (!pool) return _evidence.get(keyOf(package_id, version || (await this.getPackage(package_id))?.version)) || [];
    const r = await pool.query(
      `SELECT event, payload, actor, occurred_at AS "occurredAt"
       FROM curriculum_engine.package_evidence
       WHERE package_id=$1 AND ($2::text IS NULL OR version=$2) ORDER BY evidence_id ASC`, [package_id, version || null]);
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

  async seedPackage(pkg, createdBy = 'validation-activation') {
    // Resolve id from manifest.packageId or pkg.id
    const id = pkg.id || pkg.manifest?.packageId;
    if (!id) throw new Error('seedPackage: no id or manifest.packageId');
    const version = pkg.version || pkg.manifest?.version || '0.0.0';
    const domain = pkg.domain || pkg.manifest?.domain || 'unknown';
    const payload = { ...pkg };
    delete payload.digest;
    delete payload.state;
    const digest = sha256(payload);
    const existing = await this.getPackage(id, version);
    if (existing) {
      if (existing.digest !== digest) { const error = new Error('package_version_conflict'); error.code = 'package_version_conflict'; throw error; }
      return { created: false, digest };
    }
    if (!pool) {
      _packages.set(keyOf(id, version), { ...payload, id, version, domain, digest, createdBy,
        state: pkg.state || 'Candidate' });
      return { created: true, digest };
    }
    const inserted = await pool.query(
      `INSERT INTO curriculum_engine.packages (package_id, version, domain, payload, digest, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING package_id`,
      [id, version, domain, payload, digest, createdBy]);
    if (!inserted.rowCount) {
      const raced = await this.getPackage(id, version);
      if (raced?.digest !== digest) { const error = new Error('package_version_conflict'); error.code = 'package_version_conflict'; throw error; }
    }
    return { created: inserted.rowCount === 1, digest };
  },

  async submitReview(id, version, digest, review) {
    const key = keyOf(id, version);
    if (!pool) {
      const reviews = _reviews.get(key) || [];
      if (reviews.some(item => item.reviewer_id === review.reviewer_id)) return false;
      reviews.push({ ...review, digest }); _reviews.set(key, reviews); return true;
    }
    const inserted = await pool.query(
      `INSERT INTO curriculum_engine.package_reviews (package_id,version,digest,reviewer_id,score,approved)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING reviewer_id`,
      [id, version, digest, review.reviewer_id, review.score, review.approved]);
    return inserted.rowCount === 1;
  },

  async getReviews(id, version) {
    if (!pool) return [...(_reviews.get(keyOf(id, version)) || [])];
    const rows = await pool.query(
      `SELECT reviewer_id, score::float, approved, digest, recorded_at AS ts
       FROM curriculum_engine.package_reviews WHERE package_id=$1 AND version=$2 ORDER BY recorded_at`, [id, version]);
    return rows.rows;
  },

  async recordFallbackScore(id, version, attemptId, result) {
    if (!pool) {
      if (_fallbackScores.has(attemptId)) return false;
      _fallbackScores.add(attemptId); return true;
    }
    const inserted = await pool.query(
      `INSERT INTO curriculum_engine.fallback_attempt_scores(attempt_id,package_id,version,result)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING attempt_id`,
      [attemptId, id, version, result]);
    return inserted.rowCount === 1;
  },

  async activatePackage(id, version, digest) {
    const operation = async () => {
      if (!pool) {
        const pkg = await this.getPackage(id, version);
        if (!pkg || pkg.state !== 'AwaitingReview' || pkg.digest !== digest) throw new Error('activation_precondition_failed');
        const current = [..._packages.values()].find(value => value.domain === pkg.domain && value.state === 'Active');
        if (current && (pkg.manifest?.predecessor?.packageId !== current.id ||
            pkg.manifest?.predecessor?.version !== current.version)) throw new Error('stale_candidate');
        if (current) await this.setPackageState(current.id, 'Superseded', current.version);
        await this.setPackageState(id, 'Active', version);
        await this.setActivePointer(id, version);
        return { superseded_id: current?.id || null };
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const candidate = await client.query(
          `SELECT domain,digest,payload FROM curriculum_engine.packages WHERE package_id=$1 AND version=$2`, [id, version]);
        if (!candidate.rowCount || candidate.rows[0].digest !== digest) throw new Error('activation_precondition_failed');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [candidate.rows[0].domain]);
        const state = await client.query(
          `SELECT state FROM curriculum_engine.package_lifecycle_events WHERE package_id=$1 AND version=$2 ORDER BY event_id DESC LIMIT 1`, [id, version]);
        if ((state.rows[0]?.state || 'Candidate') !== 'AwaitingReview') throw new Error('activation_precondition_failed');
        const reviews = await client.query(
          `SELECT reviewer_id,score::float,approved FROM curriculum_engine.package_reviews
           WHERE package_id=$1 AND version=$2 AND digest=$3`, [id, version, digest]);
        const approvals = reviews.rows.filter(review => review.approved && review.score >= 3.5);
        if (new Set(approvals.map(review => review.reviewer_id)).size < 2 ||
            approvals.reduce((sum, review) => sum + review.score, 0) / approvals.length < 3.5)
          throw new Error('insufficient_approvals');
        const active = await client.query(
          `SELECT p.package_id,p.version FROM curriculum_engine.packages p JOIN LATERAL
           (SELECT state FROM curriculum_engine.package_lifecycle_events e WHERE e.package_id=p.package_id AND e.version=p.version ORDER BY event_id DESC LIMIT 1) s ON s.state='Active'
           WHERE p.domain=$1 ORDER BY p.created_at DESC`, [candidate.rows[0].domain]);
        if (active.rows.length && (candidate.rows[0].payload?.manifest?.predecessor?.packageId !== active.rows[0].package_id ||
            candidate.rows[0].payload?.manifest?.predecessor?.version !== active.rows[0].version))
          throw new Error('stale_candidate');
        for (const row of active.rows) await client.query(
          `INSERT INTO curriculum_engine.package_lifecycle_events(package_id,version,state,actor,reason)
           VALUES($1,$2,'Superseded','validation-activation','atomic domain activation')`, [row.package_id, row.version]);
        await client.query(
          `INSERT INTO curriculum_engine.package_lifecycle_events(package_id,version,state,actor,reason)
           VALUES($1,$2,'Active','validation-activation','atomic domain activation')`, [id, version]);
        await client.query('COMMIT');
        return { superseded_id: active.rows[0]?.package_id || null };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    if (pool) return operation();
    const queued = activationQueue.then(operation);
    activationQueue = queued.catch(() => {});
    return queued;
  }
};

module.exports = { db };
