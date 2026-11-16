'use strict';

// The Assurance Incident log on PostgreSQL: one row per source and sourceId,
// updates appended, and neither incidents nor updates editable.
//   MONITORING_TEST_DATABASE_URL=postgres://monitoring_owner:...@host/db node --test integration/

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createPgStore } = require('../src/incidents');

const url = process.env.MONITORING_TEST_DATABASE_URL;

test('PostgreSQL keeps one immutable incident per source id, with appended updates and manifests', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    const store = createPgStore(pool);
    await store.init();
    const sourceId = `event-${Date.now()}`;
    const incident = { source: 'training-service', sourceId, severity: 'high', kind: 'delivery_exhausted', summary: 'Not delivered.',
      subject: { sessionId: 's-1' }, detail: { attempts: 5 }, occurredAt: '2026-11-16T12:00:00.000Z' };
    const first = await store.append(incident);
    const again = await store.append({ ...incident, summary: 'A different summary.' });
    assert.deepEqual([first.created, again.created, again.incident.incidentId, again.incident.summary], [true, false, first.incident.incidentId, 'Not delivered.']);
    await store.addUpdate(first.incident.incidentId, { status: 'acknowledged', note: 'Looking.', actor: 'admin-1' });
    await store.addUpdate(first.incident.incidentId, { status: 'resolved', note: 'Redelivered.', actor: 'admin-1' });
    const read = await store.get(first.incident.incidentId);
    assert.deepEqual([read.status, read.updates.length], ['resolved', 2]);
    assert.equal((await store.list({ status: 'open' })).some((item) => item.incidentId === read.incidentId), false);
    await assert.rejects(pool.query(`UPDATE monitoring_service.incidents SET summary='edited' WHERE incident_id=$1`, [read.incidentId]), /immutable assurance incident/);
    await assert.rejects(pool.query(`DELETE FROM monitoring_service.incident_updates WHERE incident_id=$1`, [read.incidentId]), /immutable assurance incident/);
    const credentialId = `cred-${Date.now()}`;
    await store.addManifest({ credentialId, agentId: 'agent-1', manifest: { permittedTools: ['a'] }, registeredBy: 'admin-1' });
    await store.addManifest({ credentialId, agentId: 'agent-1', manifest: { permittedTools: ['b'] }, registeredBy: 'admin-1' });
    assert.deepEqual((await store.manifestFor(credentialId)).manifest, { permittedTools: ['b'] }, 'the newest manifest governs');
  } finally { await pool.end(); }
});
