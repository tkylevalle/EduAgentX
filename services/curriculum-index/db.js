'use strict';

// Finds every Domain Assurance Package whose most recent lifecycle event is
// 'Active'. This is the ONLY definition of "Active" the index ever uses —
// it reads the exact same append-only lifecycle_events table that
// curriculum-engine itself serves from, so the index can never drift from
// what's authoritative in Postgres.
async function getActivePackages(pool) {
  const result = await pool.query(`
    SELECT p.package_id, p.version, p.payload, COALESCE(q.scopes, '[]'::jsonb) AS quarantined_scopes
    FROM curriculum_engine.packages p
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('scopeType', latest.scope_type, 'scopeId', latest.scope_id)) AS scopes
      FROM (
        SELECT DISTINCT ON (scope_type, scope_id) scope_type, scope_id, event
        FROM curriculum_engine.package_scope_events
        WHERE package_id=p.package_id AND version=p.version
        ORDER BY scope_type, scope_id, event_id DESC
      ) latest
      WHERE latest.event='quarantined'
    ) q ON true
    WHERE (
      SELECT e.state FROM curriculum_engine.package_lifecycle_events e
      WHERE e.package_id = p.package_id AND e.version = p.version
      ORDER BY e.event_id DESC LIMIT 1
    ) = 'Active'
  `);
  return result.rows.map((row) => ({ ...row.payload, quarantinedScopes: row.quarantined_scopes || [] }));
}

module.exports = { getActivePackages };
