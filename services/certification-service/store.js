'use strict';

const { randomUUID } = require('node:crypto');
const { fail } = require('./evidence');

const clone = (value) => structuredClone(value);

// Answer-free view of one decision and its credential for operator reads.
const credentialSummary = ({ examinationId, decision, subjectId, packageId, packageVersion, mode, scores, credential }) => ({
  credentialId: credential.credentialId, examinationId, agentLearnerKey: subjectId, packageId, packageVersion, mode,
  overallPercent: scores?.overallPercent ?? null, tierPercents: scores?.tierPercents ?? null,
  decision, issuedAt: credential.issuedAt, keyId: credential.keyId, validUntil: credential.credential?.validUntil ?? null,
  compactJws: credential.compactJws,
});

function createMemoryStore() {
  const byAttempt = new Map(), byKey = new Map();
  let cursor = null;
  let tail = Promise.resolve();
  async function serialize(action) {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
  return {
    async health() {},
    async findByAttempt(id) { const row = byAttempt.get(id); return row ? { ...clone(row), replay: true } : null; },
    async issue({ evidence, commandKey, commandDigest, createCredential, latencyStartedAt = process.hrtime.bigint() }) {
      return serialize(async () => {
        const keyRow = byKey.get(commandKey);
        if (keyRow && keyRow.examinationId !== evidence.examinationId) throw fail('idempotency_conflict');
        const existing = byAttempt.get(evidence.examinationId);
        if (existing) return { ...clone(existing), replay: true };
        const issued = createCredential();
        const processingLatencyMs = Math.max(0, Number(process.hrtime.bigint() - latencyStartedAt) / 1e6);
        const row = { decisionId: randomUUID(), examinationId: evidence.examinationId,
          commandKey, commandDigest, evidence: clone(evidence), decision: { outcome: 'certified', decidedAt: evidence.decidedAt },
          credential: clone(issued), issuanceLatencyMs: Math.max(0, Date.parse(issued.issuedAt) - Date.parse(evidence.decidedAt)),
          processingLatencyMs, replay: false };
        byAttempt.set(row.examinationId, row); byKey.set(commandKey, row);
        return clone(row);
      });
    },
    async counts() { return { decisions: byAttempt.size, credentials: byAttempt.size }; },
    async issuanceKpi() {
      const values = [...byAttempt.values()].map((row) => row.issuanceLatencyMs).sort((a, b) => a - b);
      const processing = [...byAttempt.values()].map((row) => row.processingLatencyMs).sort((a, b) => a - b);
      return { sampleCount: values.length, p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : 0,
        processingP95Ms: processing.length ? processing[Math.ceil(processing.length * 0.95) - 1] : 0 };
    },
    async listCredentials(limit = 50) {
      return [...byAttempt.values()].sort((a, b) => b.credential.issuedAt.localeCompare(a.credential.issuedAt))
        .slice(0, limit).map((row) => credentialSummary({ examinationId: row.examinationId, decision: row.decision,
          subjectId: row.evidence.subjectId, packageId: row.evidence.packageId, packageVersion: row.evidence.packageVersion,
          mode: row.evidence.mode, scores: row.evidence.scores, credential: row.credential }));
    },
    async getCursor() { return clone(cursor); },
    async advanceCursor(next) { cursor = clone(next); },
  };
}

function createPgStore(pool) {
  async function findByAttempt(id, client = pool) {
    const { rows } = await client.query(`SELECT d.*, c.credential, c.compact_jws, c.key_id, c.issued_at,
      c.credential_id,c.issuance_latency_ms,c.processing_latency_ms FROM certification_engine.decisions d JOIN certification_engine.credentials c USING (decision_id)
      WHERE d.examination_id=$1`, [id]);
    return rows[0] || null;
  }
  const project = (row, replay = true) => ({ decisionId: row.decision_id,
    examinationId: row.examination_id, commandKey: row.idempotency_key,
    decision: { outcome: 'certified', decidedAt: new Date(row.decided_at).toISOString() },
    evidence: row.examination_evidence, credential: { credentialId: row.credential_id,
      credential: row.credential, compactJws: row.compact_jws, keyId: row.key_id,
      issuedAt: new Date(row.issued_at).toISOString() }, issuanceLatencyMs: row.issuance_latency_ms,
    processingLatencyMs: row.processing_latency_ms, replay });
  return {
    async health() { await pool.query('SELECT 1'); },
    async findByAttempt(id) { const row = await findByAttempt(id); return row ? project(row) : null; },
    async issue({ evidence, commandKey, commandDigest, createCredential, latencyStartedAt = process.hrtime.bigint() }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`certification:${evidence.examinationId}`]);
        const key = await client.query('SELECT examination_id FROM certification_engine.decisions WHERE idempotency_key=$1', [commandKey]);
        if (key.rows[0] && key.rows[0].examination_id !== evidence.examinationId) throw fail('idempotency_conflict');
        const found = await findByAttempt(evidence.examinationId, client);
        if (found) { await client.query('COMMIT'); return project(found, true); }
        const decisionId = randomUUID();
        const issued = createCredential();
        await client.query(`INSERT INTO certification_engine.decisions
          (decision_id,examination_id,idempotency_key,command_digest,subject_id,subject_fingerprint,
           package_id,package_version,package_digest,template_id,template_version,rubric_id,rubric_version,
           template_digest,rubric_digest,mode,scores,safety_result,examination_evidence,decided_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [decisionId,evidence.examinationId,commandKey,commandDigest,evidence.subjectId,evidence.subjectFingerprint,
          evidence.packageId,evidence.packageVersion,evidence.packageDigest,evidence.templateId,evidence.templateVersion,
          evidence.rubricId,evidence.rubricVersion,evidence.templateDigest,evidence.rubricDigest,evidence.mode,JSON.stringify(evidence.scores),
          JSON.stringify(evidence.safetyResult),JSON.stringify(evidence.examinationEvidence),evidence.decidedAt]);
        const processingLatency = Math.max(0, Math.round(Number(process.hrtime.bigint() - latencyStartedAt) / 1e6));
        const issuanceLatency = Math.max(0, Date.parse(issued.issuedAt) - Date.parse(evidence.decidedAt));
        await client.query(`INSERT INTO certification_engine.credentials
          (credential_id,decision_id,credential,compact_jws,key_id,issued_at,issuance_latency_ms,processing_latency_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [issued.credentialId,decisionId,JSON.stringify(issued.credential),issued.compactJws,issued.keyId,
          issued.issuedAt,issuanceLatency,processingLatency]);
        await client.query('COMMIT');
        return { decisionId, examinationId: evidence.examinationId, commandKey,
          decision: { outcome: 'certified', decidedAt: evidence.decidedAt }, evidence,
          credential: issued, issuanceLatencyMs: issuanceLatency, processingLatencyMs: processingLatency, replay: false };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async counts() {
      const { rows } = await pool.query(`SELECT (SELECT count(*) FROM certification_engine.decisions)::int AS decisions,
        (SELECT count(*) FROM certification_engine.credentials)::int AS credentials`);
      return rows[0];
    },
    async issuanceKpi() {
      const { rows } = await pool.query(`SELECT count(*)::int AS sample_count,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY issuance_latency_ms),0)::int AS p95_ms
        FROM certification_engine.credentials`);
      const processing = await pool.query(`SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP
        (ORDER BY processing_latency_ms),0)::int AS p95_ms FROM certification_engine.credentials`);
      return { sampleCount: rows[0].sample_count, p95Ms: rows[0].p95_ms, processingP95Ms: processing.rows[0].p95_ms };
    },
    async listCredentials(limit = 50) {
      const { rows } = await pool.query(`SELECT d.examination_id, d.decided_at, d.subject_id, d.package_id, d.package_version,
        d.mode, d.scores, c.credential_id, c.credential, c.compact_jws, c.key_id, c.issued_at
        FROM certification_engine.decisions d JOIN certification_engine.credentials c USING (decision_id)
        ORDER BY c.issued_at DESC LIMIT $1`, [limit]);
      return rows.map((row) => credentialSummary({ examinationId: row.examination_id,
        decision: { outcome: 'certified', decidedAt: new Date(row.decided_at).toISOString() },
        subjectId: row.subject_id, packageId: row.package_id, packageVersion: row.package_version, mode: row.mode,
        scores: row.scores, credential: { credentialId: row.credential_id, credential: row.credential,
          compactJws: row.compact_jws, keyId: row.key_id, issuedAt: new Date(row.issued_at).toISOString() } }));
    },
    async getCursor() {
      const { rows } = await pool.query('SELECT completed_at, examination_id FROM certification_engine.issuance_cursor WHERE cursor_id=1');
      return rows[0] ? { completedAt: new Date(rows[0].completed_at).toISOString(), examinationId: rows[0].examination_id } : null;
    },
    async advanceCursor(cursor) {
      await pool.query(`INSERT INTO certification_engine.issuance_cursor(cursor_id,completed_at,examination_id)
        VALUES (1,$1,$2) ON CONFLICT(cursor_id) DO UPDATE SET completed_at=EXCLUDED.completed_at,
        examination_id=EXCLUDED.examination_id WHERE (certification_engine.issuance_cursor.completed_at,
        certification_engine.issuance_cursor.examination_id) < (EXCLUDED.completed_at,EXCLUDED.examination_id)`,
      [cursor.completedAt,cursor.examinationId]);
    },
  };
}

module.exports = { createMemoryStore, createPgStore };
