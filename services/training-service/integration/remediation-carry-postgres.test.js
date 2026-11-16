'use strict';
// A remediation ended by a reconfiguration is carried over once, on the same
// request, and the request still names its assigned session.
//   TRAINING_TEST_DATABASE_URL=postgres://...@host/db node --test integration/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Pool } = require('pg');
const { createPgStore } = require('../store');
const { decideCarriedRemediation, decideRemediation, decideStart, deriveSessionState } = require('../session');
const { completionPolicy } = require('../plan');
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

const payload = { objectives: [{ id: 'o1', deliveryItemIds: ['m1-lesson', 'm1-practice'] }],
  modules: [{ id: 'm1', sequence: 1, deliveryItems: [{ id: 'm1-lesson', kind: 'lesson', text: 'L1' }, { id: 'm1-practice', kind: 'practice', text: 'P1' }] }] };
const pkg = { id: 'pkg-carry', version: '1.0.0', state: 'Active', digest: 'digest-carry', payload };

test('PostgreSQL carries an ended remediation over once and keeps the request on its assigned session', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await applySchema(pool, fs.readFileSync(`${__dirname}/../schema.sql`, 'utf8'));
    const learner = `carry-${Date.now()}`;
    const first = { agentLearnerKey: learner, configurationFingerprint: 'sha256:config-1', configurationVersion: 1 };
    const second = { ...first, configurationFingerprint: 'sha256:config-2', configurationVersion: 2 };
    let n = 0;
    const input = (extra = {}) => ({ now: new Date(Date.UTC(2026, 10, 16, 10, 0, n += 1)).toISOString(),
      evidence: { mode: 'synthetic', environment: 'simulation' }, correlationId: `c-${n}`, actor: learner,
      idempotencyKey: `${learner}-k-${n}`, requestFingerprint: `f-${n}`, policy: completionPolicy(), agentLearnerKey: learner, ...extra });
    const store = createPgStore(pool);
    const append = (decision, insert = true) => store.transaction(learner, async (tx) => {
      if (insert) await tx.insertSession(decision.session);
      await tx.insertEvents(decision.events);
    });

    const assigned = decideRemediation(pkg, first, {}, input({ sessionId: crypto.randomUUID(), actor: 'operator-1', requestId: 'req-1',
      packageId: pkg.id, packageVersion: pkg.version, objectiveIds: ['o1'], requestDigest: 'sha256:request-1',
      cause: { type: 'examination_failure', reference: 'attempt-1', evidenceDigest: `sha256:${'a'.repeat(64)}`, observedAt: '2026-11-16T09:00:00Z', summary: null } }));
    await append(assigned);
    const ended = decideStart(pkg, second, { session: assigned.session, state: deriveSessionState(assigned.events) }, input());
    await append(ended, false);

    const previous = await store.transaction(learner, (tx) => tx.findLatestRemediation(learner));
    assert.deepEqual([previous.session.sessionId, deriveSessionState(previous.events).blockReason], [assigned.session.sessionId, 'configuration_changed']);
    const carry = () => decideCarriedRemediation(pkg, second, { session: previous.session, state: deriveSessionState(previous.events) },
      input({ sessionId: crypto.randomUUID() }));
    const carried = carry();
    await append(carried);
    await assert.rejects(append(carry()), (error) => error.code === '23505', 'one carry-over per ended session');

    const latest = await store.transaction(learner, (tx) => tx.findLatestRemediation(learner));
    assert.deepEqual([latest.session.sessionId, latest.session.configurationFingerprint, latest.session.remediation.carriedFromSessionId],
      [carried.session.sessionId, 'sha256:config-2', assigned.session.sessionId]);
    const open = await store.transaction(learner, async (tx) => [await tx.findOpenSession(learner, pkg.id), await tx.findOpenSession(learner, 'pkg-other')]);
    assert.deepEqual([open[0].sessionId, open[1]], [carried.session.sessionId, null], 'open sessions are found per package');
    const request = await store.transaction(learner, (tx) => tx.findRemediation(learner, 'req-1'));
    assert.equal(request.session.sessionId, assigned.session.sessionId);
  } finally { await pool.end(); }
});
