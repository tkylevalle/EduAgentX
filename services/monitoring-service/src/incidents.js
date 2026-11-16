'use strict';

// Storage for the Assurance Incident log and Runtime Monitor manifests:
// PostgreSQL when the service has a database, memory for tests. Every write
// appends; an incident is never edited, and the same source and sourceId
// append once.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// A page of the Attention Queue; the log itself is unbounded, so a reader pages with a cursor.
const MAX_LIST = 500;
const statusOf = (updates) => updates.at(-1)?.status || 'open';
// A cursor names the last incident of the previous page: when it was recorded
// (to the microsecond PostgreSQL keeps, so no row sharing a millisecond is
// skipped) and its id, which orders incidents recorded at the same instant.
const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z),([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** @param {unknown} text @returns {{ recordedAt: string, incidentId: string } | null} */
function parseCursor(text) {
  const match = typeof text === 'string' ? CURSOR.exec(text) : null;
  return match ? { recordedAt: match[1], incidentId: match[2] } : null;
}

// The store reads one row past the page; that row only says another page follows.
function toPage(entries, size) {
  const page = entries.slice(0, size);
  const last = page.at(-1);
  return { incidents: page.map((entry) => entry.incident), next: entries.length > size ? `${last.cursorAt},${last.incident.incidentId}` : null };
}
const pageSize = (limit) => Math.min(Math.max(1, limit), MAX_LIST);
const newestFirst = (a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.incidentId.localeCompare(a.incidentId);
const olderThan = (cursor) => (incident) => incident.recordedAt < cursor.recordedAt ||
  (incident.recordedAt === cursor.recordedAt && incident.incidentId < cursor.incidentId);

function createMemoryStore({ now = () => new Date() } = {}) {
  const incidents = [];
  const updates = [];
  const manifests = [];
  const reports = new Map();
  const view = (incident) => {
    const own = updates.filter((update) => update.incidentId === incident.incidentId);
    return structuredClone({ ...incident, status: statusOf(own), updates: own });
  };
  return {
    async health() {},
    async append(incident) {
      const existing = incidents.find((value) => value.source === incident.source && value.sourceId === incident.sourceId);
      if (existing) return { incident: view(existing), created: false };
      const stored = { incidentId: randomUUID(), ...structuredClone(incident), recordedAt: now().toISOString() };
      incidents.push(stored);
      return { incident: view(stored), created: true };
    },
    async get(incidentId) { const found = incidents.find((value) => value.incidentId === incidentId); return found ? view(found) : null; },
    async list({ status, limit = MAX_LIST, before } = {}) {
      const size = pageSize(limit);
      const found = incidents.map(view).filter((incident) => !status || (status === 'open' ? incident.status !== 'resolved' : incident.status === status))
        .filter(before ? olderThan(before) : () => true).sort(newestFirst).slice(0, size + 1);
      return toPage(found.map((incident) => ({ incident, cursorAt: incident.recordedAt })), size);
    },
    // The check and the append run in one synchronous step, as the PostgreSQL
    // store's row lock makes them one step there: nothing lands after a resolution.
    async addUpdate(incidentId, update) {
      if (!incidents.some((value) => value.incidentId === incidentId)) return 'incident_not_found';
      if (updates.some((value) => value.incidentId === incidentId && value.status === 'resolved')) return 'already_resolved';
      updates.push({ incidentId, ...update, recordedAt: now().toISOString() });
      return 'appended';
    },
    async addManifest(record) { manifests.push({ ...structuredClone(record), recordedAt: now().toISOString() }); },
    async manifestFor(credentialId) { return structuredClone([...manifests].reverse().find((value) => value.credentialId === credentialId) || null); },
    async recordReport(credentialId, at) { reports.set(credentialId, at); },
    // Each monitored credential's newest manifest, with when it last reported.
    async monitored() {
      const latest = new Map(manifests.map((value) => [value.credentialId, value]));
      return [...latest.values()].map((value) => ({ credentialId: value.credentialId, agentId: value.agentId, registeredAt: value.recordedAt,
        lastReportAt: reports.get(value.credentialId) || null }));
    },
  };
}

function createPgStore(pool) {
  const toIncident = (row) => ({ incidentId: row.incident_id, source: row.source, sourceId: row.source_id, severity: row.severity, kind: row.kind,
    summary: row.summary, subject: row.subject, detail: row.detail, safeState: row.safe_state, requiredAction: row.required_action, owner: row.owner,
    occurredAt: row.occurred_at.toISOString(), recordedAt: row.recorded_at.toISOString(),
    status: row.status || 'open', updates: row.updates || [] });
  const SELECT = `SELECT i.*, u.updates, u.updates->-1->>'status' AS status,
    to_char(i.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM monitoring_service.incidents i
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('status', status, 'note', note, 'actor', actor, 'recordedAt', recorded_at) ORDER BY update_id) AS updates
      FROM monitoring_service.incident_updates WHERE incident_id = i.incident_id) u ON true`;
  return {
    async init() { await pool.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8')); },
    async health() { await pool.query('SELECT 1'); },
    async append(incident) {
      const inserted = await pool.query(`INSERT INTO monitoring_service.incidents
        (incident_id, source, source_id, severity, kind, summary, subject, detail, occurred_at, safe_state, required_action, owner)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (source, source_id) DO NOTHING RETURNING incident_id`,
      [randomUUID(), incident.source, incident.sourceId, incident.severity, incident.kind, incident.summary, incident.subject, incident.detail, incident.occurredAt,
        incident.safeState ?? null, incident.requiredAction ?? null, incident.owner ?? null]);
      const row = (await pool.query(`${SELECT} WHERE i.source=$1 AND i.source_id=$2`, [incident.source, incident.sourceId])).rows[0];
      return { incident: toIncident(row), created: inserted.rowCount === 1 };
    },
    async get(incidentId) {
      const row = (await pool.query(`${SELECT} WHERE i.incident_id=$1`, [incidentId])).rows[0];
      return row ? toIncident(row) : null;
    },
    async list({ status, limit = MAX_LIST, before } = {}) {
      const size = pageSize(limit);
      const current = `coalesce(u.updates->-1->>'status', 'open')`;
      const params = [];
      const where = [];
      if (status === 'open') where.push(`${current} <> 'resolved'`);
      else if (status) { params.push(status); where.push(`${current} = $${params.length}`); }
      if (before) {
        params.push(before.recordedAt, before.incidentId);
        where.push(`(i.recorded_at, i.incident_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      params.push(size + 1);
      const { rows } = await pool.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY i.recorded_at DESC, i.incident_id DESC LIMIT $${params.length}`, params);
      return toPage(rows.map((row) => ({ incident: toIncident(row), cursorAt: row.cursor_at })), size);
    },
    // The incident row is locked before the resolution check, so two updates to
    // one incident run one after the other and none can land after a resolution.
    async addUpdate(incidentId, update) {
      const client = await pool.connect();
      let broken;
      try {
        await client.query('BEGIN');
        const outcome = await appendUnlessResolved(client, incidentId, update);
        await client.query(outcome === 'appended' ? 'COMMIT' : 'ROLLBACK');
        return outcome;
      } catch (error) {
        // A connection that cannot roll back is discarded, not reused; the first error is the one reported.
        await client.query('ROLLBACK').catch((rollbackError) => { broken = rollbackError; });
        throw error;
      } finally { client.release(broken); }
    },
    async addManifest(record) {
      await pool.query(`INSERT INTO monitoring_service.runtime_manifests (credential_id, agent_id, manifest, registered_by) VALUES ($1,$2,$3,$4)`,
        [record.credentialId, record.agentId, record.manifest, record.registeredBy]);
    },
    async manifestFor(credentialId) {
      const row = (await pool.query(`SELECT credential_id, agent_id, manifest, registered_by, recorded_at FROM monitoring_service.runtime_manifests
        WHERE credential_id=$1 ORDER BY manifest_id DESC LIMIT 1`, [credentialId])).rows[0];
      return row ? { credentialId: row.credential_id, agentId: row.agent_id, manifest: row.manifest, registeredBy: row.registered_by,
        recordedAt: row.recorded_at.toISOString() } : null;
    },
    async recordReport(credentialId, at) {
      await pool.query(`INSERT INTO monitoring_service.runtime_reports (credential_id, last_report_at) VALUES ($1, $2)
        ON CONFLICT (credential_id) DO UPDATE SET last_report_at = GREATEST(runtime_reports.last_report_at, EXCLUDED.last_report_at)`, [credentialId, at]);
    },
    async monitored() {
      const { rows } = await pool.query(`SELECT DISTINCT ON (m.credential_id) m.credential_id, m.agent_id, m.recorded_at, r.last_report_at
        FROM monitoring_service.runtime_manifests m LEFT JOIN monitoring_service.runtime_reports r USING (credential_id)
        ORDER BY m.credential_id, m.manifest_id DESC`);
      return rows.map((row) => ({ credentialId: row.credential_id, agentId: row.agent_id, registeredAt: row.recorded_at.toISOString(),
        lastReportAt: row.last_report_at ? row.last_report_at.toISOString() : null }));
    },
  };
}

// Runs inside addUpdate's transaction. FOR UPDATE takes the row lock without
// writing, so the incident's immutability trigger does not fire.
async function appendUnlessResolved(client, incidentId, update) {
  const locked = await client.query('SELECT 1 FROM monitoring_service.incidents WHERE incident_id=$1 FOR UPDATE', [incidentId]);
  if (!locked.rowCount) return 'incident_not_found';
  const resolved = await client.query(`SELECT 1 FROM monitoring_service.incident_updates WHERE incident_id=$1 AND status='resolved' LIMIT 1`, [incidentId]);
  if (resolved.rowCount) return 'already_resolved';
  await client.query(`INSERT INTO monitoring_service.incident_updates (incident_id, status, note, actor) VALUES ($1,$2,$3,$4)`,
    [incidentId, update.status, update.note, update.actor]);
  return 'appended';
}

module.exports = { MAX_LIST, createMemoryStore, createPgStore, parseCursor };
