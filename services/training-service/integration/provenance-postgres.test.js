'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Pool } = require('pg');
const { createPgStore } = require('../store');
const { fixture } = require('../../../packages/execution-provenance/test/fixtures');
const url = process.env.TRAINING_TEST_DATABASE_URL;

// Each integration file applies schema.sql; the advisory lock makes them take
// turns, because concurrent DDL on the same tables can deadlock.
async function applySchema(pool, schema) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(435200)');
    await client.query(schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock(435200)').catch(() => {});
    client.release();
  }
}

test('PostgreSQL preserves immutable synthetic/replay runs and receipts across connections and rolls back receipt reuse', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const schema = fs.readFileSync(`${__dirname}/../schema.sql`, 'utf8');
  try {
    await applySchema(pool, schema);
    for (const mode of ['synthetic','replay']) {
      const f = fixture(mode, `pg-${mode}`), store = createPgStore(pool);
      await store.transaction(f.run.agentLearnerKey, async (tx) => {
        await tx.insertSession(f.session); await tx.insertEvents(f.events); await tx.insertCompletion(f.completion);
      });
      const fresh = new Pool({ connectionString: url });
      try {
        const restarted = createPgStore(fresh), saved = await restarted.readSession(f.run.runId);
        assert.deepEqual(saved.session.provenance, f.run);
        assert.deepEqual(saved.events.filter((e) => e.executionEvidence).map((e) => e.executionEvidence),
          f.events.filter((e) => e.executionEvidence).map((e) => e.executionEvidence));
        assert.deepEqual(await restarted.findCompletion({ agentLearnerKey: f.run.agentLearnerKey,
          packageId: f.run.package.id, packageVersion: f.run.package.version, packageDigest: f.run.package.digest,
          sessionId: f.run.runId }), f.completion);
        const copy = fixture(mode, `copy-${mode}`);
        copy.events.find((e) => e.executionEvidence).executionEvidence = f.events.find((e) => e.executionEvidence).executionEvidence;
        await assert.rejects(restarted.transaction(copy.run.agentLearnerKey, async (tx) => {
          await tx.insertSession(copy.session); await tx.insertEvents(copy.events);
        }), (e) => e.code === '23505');
        assert.equal(await restarted.readSession(copy.run.runId), null);
      } finally { await fresh.end(); }
      await assert.rejects(pool.query('UPDATE training_service.sessions SET provenance=NULL WHERE session_id=$1', [f.run.runId]), /immutable training evidence/);
      await assert.rejects(pool.query('DELETE FROM training_service.session_events WHERE session_id=$1', [f.run.runId]), /immutable training evidence/);
    }
    const legacy = fixture('synthetic', 'pg-legacy'); delete legacy.session.provenance;
    const store = createPgStore(pool);
    await store.transaction('pg-legacy', async (tx) => { await tx.insertSession(legacy.session); });
    await applySchema(pool, schema);
    assert.equal((await store.readSession(legacy.session.sessionId)).session.provenance, undefined);
  } finally { await pool.end(); }
});
