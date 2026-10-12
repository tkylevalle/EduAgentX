'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createStandardItems } = require('../standard-generator');
const { generateStandardForm } = require('../generation');
const { createPgStore } = require('../store');

if (!process.env.EXAMINATION_TEST_DATABASE_URL) throw new Error('EXAMINATION_TEST_DATABASE_URL required');
test('PostgreSQL admission is atomic, immutable and stable across store restart', async () => {
  const pool = new Pool({ connectionString: process.env.EXAMINATION_TEST_DATABASE_URL });
  try {
    await pool.query(fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8'));
    const pkg = structuredClone(candidate);
    pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
    pkg.state = 'Active'; pkg.digest = sha256(pkg);
    pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
    const registration = { agentLearnerKey: `pg-agent-${Date.now()}`,
      configurationFingerprint: 'sha256:pg-test' };
    const completion = { eventType: 'training.session.completed', eventId: 'pg-completion', sessionId: 'pg-session',
      agentLearnerKey: registration.agentLearnerKey,
      configurationFingerprint: registration.configurationFingerprint,
      package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
      completion: { plannedItems: 10, completedItems: 10 } };
    const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
    const input = { actor: registration.agentLearnerKey, key: 'same-key', form,
      now: '2026-10-12T06:00:00.000Z', deadlineAt: '2026-10-12T07:00:00.000Z', correlationId: 'pg-test' };
    const store = createPgStore(pool);
    const [a, b] = await Promise.all([store.admit(input), store.admit(input)]);
    assert.deepEqual([a.replay, b.replay].sort(), [false, true]);
    assert.equal(a.attempt.attemptId, b.attempt.attemptId);
    const restarted = createPgStore(pool);
    const saved = await restarted.get(a.attempt.attemptId);
    assert.equal(saved.formDigest, sha256(form));
    assert.equal(saved.form.items.length, 15);
    const events = await pool.query('SELECT * FROM examination_engine.attempt_events WHERE attempt_id = $1',
      [saved.attemptId]);
    assert.deepEqual(events.rows.map((row) => [row.seq, row.event_type]), [[1, 'attempt_started']]);
    await assert.rejects(pool.query('UPDATE examination_engine.attempts SET mode = $1 WHERE attempt_id = $2',
      ['standard', saved.attemptId]), /immutable examination evidence/);
  } finally { await pool.end(); }
});
