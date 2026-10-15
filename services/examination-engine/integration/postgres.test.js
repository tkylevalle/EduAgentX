'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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

const START = '2026-10-12T06:00:00.000Z';
const DEADLINE = '2026-10-12T07:00:00.000Z';
const BEFORE_DEADLINE = '2026-10-12T06:59:59.999Z';
const AFTER_DEADLINE = '2026-10-12T08:00:00.000Z';

async function fixture(t) {
  const pool = new Pool({ connectionString: process.env.EXAMINATION_TEST_DATABASE_URL });
  t.after(() => pool.end());
  await pool.query(fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8'));
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: `pg-lifecycle-${randomUUID()}`, configurationFingerprint: 'sha256:pg-locked' };
  const completion = { eventType: 'training.session.completed', eventId: 'pg-training-completed', sessionId: 'pg-training',
    agentLearnerKey: registration.agentLearnerKey, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
  const store = createPgStore(pool);
  const { attempt } = await store.admit({ actor: registration.agentLearnerKey, key: 'start', form,
    now: START, deadlineAt: DEADLINE, correlationId: 'pg-lifecycle' });
  return { pool, store, attempt, form };
}

function responseCommand(attempt, overrides = {}) {
  return { type: 'response', idempotencyKey: 'response-1', expectedSequence: attempt.sequence,
    itemId: attempt.form.items[0].id, response: 'PRIVATE_PG_RESPONSE_119b3bb4',
    now: BEFORE_DEADLINE, correlationId: 'pg-response', ...overrides };
}

async function answerAll(ctx) {
  let current = await ctx.store.get(ctx.attempt.attemptId);
  for (const [index, item] of current.form.items.entries()) {
    const result = await ctx.store.command(current.attemptId, responseCommand(current, {
      itemId: item.id, response: `Private response number ${index + 1} for review`, idempotencyKey: `response-${index + 1}`,
    }));
    current = result.attempt;
  }
  return current;
}

function finalizeCommand(attempt, overrides = {}) {
  return { type: 'finalize', idempotencyKey: 'grade', expectedSequence: attempt.sequence, eventId: randomUUID(),
    formDigest: attempt.formDigest, rubricDigest: attempt.form.rubric.digest, responseSetDigest: attempt.responseSetDigest,
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true },
    now: AFTER_DEADLINE, correlationId: 'pg-grade', ...overrides };
}

test('PostgreSQL response replay survives restart and does not leak answers into events or receipts', async (t) => {
  const ctx = await fixture(t);
  const command = responseCommand(ctx.attempt);
  const first = await ctx.store.command(ctx.attempt.attemptId, command);
  await ctx.store.command(ctx.attempt.attemptId, responseCommand(first.attempt, {
    idempotencyKey: 'response-2', itemId: ctx.form.items[1].id, response: 'Second private answer.',
  }));
  const restarted = createPgStore(ctx.pool);
  const replay = await restarted.command(ctx.attempt.attemptId, { ...command, now: AFTER_DEADLINE });
  assert.equal(replay.replay, true);
  assert.equal(replay.receipt.sequence, 2);
  assert.equal(replay.attempt.sequence, 3);
  assert.equal((await restarted.get(ctx.attempt.attemptId)).sequence, 3);
  await assert.rejects(restarted.command(ctx.attempt.attemptId, { ...command, response: 'Changed meaning.' }),
    (error) => error.status === 409);
  const responses = await ctx.pool.query('SELECT * FROM examination_engine.attempt_responses WHERE attempt_id = $1',
    [ctx.attempt.attemptId]);
  assert.equal(responses.rows.length, 2);
  assert.equal(responses.rows[0].response_digest, sha256(responses.rows[0].response));
  const events = await ctx.pool.query('SELECT * FROM examination_engine.attempt_events WHERE attempt_id = $1 ORDER BY seq',
    [ctx.attempt.attemptId]);
  const receipts = await ctx.pool.query('SELECT * FROM examination_engine.attempt_commands WHERE attempt_id = $1',
    [ctx.attempt.attemptId]);
  assert.equal(JSON.stringify(events.rows).includes(command.response), false);
  assert.equal(JSON.stringify(receipts.rows).includes(command.response), false);
  assert.deepEqual(events.rows.map((row) => row.seq), [1, 2, 3]);
  for (const table of ['attempt_responses', 'attempt_commands', 'attempt_events']) {
    await assert.rejects(ctx.pool.query(`DELETE FROM examination_engine.${table} WHERE attempt_id = $1`, [ctx.attempt.attemptId]),
      /immutable examination evidence/);
  }
  await assert.rejects(ctx.pool.query('UPDATE examination_engine.attempt_responses SET response = $1 WHERE attempt_id = $2',
    ['replacement', ctx.attempt.attemptId]), /immutable examination evidence/);
});

test('PostgreSQL row serialization converges identical requests and rejects competing answers and stale sequences', async (t) => {
  const ctx = await fixture(t);
  const otherStore = createPgStore(ctx.pool);
  const command = responseCommand(ctx.attempt);
  const identical = await Promise.all([
    ctx.store.command(ctx.attempt.attemptId, command),
    otherStore.command(ctx.attempt.attemptId, { ...command, idempotencyKey: 'same-answer-new-key' }),
  ]);
  assert.deepEqual(identical.map((entry) => entry.replay).sort(), [false, true]);
  const next = await ctx.store.get(ctx.attempt.attemptId);
  const competing = responseCommand(next, { itemId: ctx.form.items[1].id, idempotencyKey: 'competing-a', response: 'Answer A.' });
  const race = await Promise.allSettled([
    ctx.store.command(next.attemptId, competing),
    otherStore.command(next.attemptId, { ...competing, idempotencyKey: 'competing-b', response: 'Answer B.' }),
  ]);
  assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(race.find((entry) => entry.status === 'rejected').reason.status, 409);
  await assert.rejects(ctx.store.command(next.attemptId, responseCommand(next, {
    idempotencyKey: 'gap', expectedSequence: 100, itemId: ctx.form.items[2].id,
  })), (error) => error.status === 409);
  const saved = await otherStore.get(next.attemptId);
  assert.deepEqual([saved.sequence, saved.responsesReceived], [3, 2]);
});

test('PostgreSQL failure inside response transaction rolls back event, raw evidence and idempotency receipt', async (t) => {
  const ctx = await fixture(t);
  const unique = randomUUID().replaceAll('-', '');
  const triggerName = `test_reject_${unique}`;
  const functionName = `test_reject_${unique}`;
  const correlationId = `crash-${unique}`;
  await ctx.pool.query(`CREATE FUNCTION examination_engine.${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected transaction failure'; END $$`);
  await ctx.pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON examination_engine.attempt_events
    FOR EACH ROW WHEN (NEW.correlation_id = '${correlationId}') EXECUTE FUNCTION examination_engine.${functionName}()`);
  try {
    await assert.rejects(ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt, { correlationId })),
      /injected transaction failure/);
    const saved = await createPgStore(ctx.pool).get(ctx.attempt.attemptId);
    assert.deepEqual([saved.sequence, saved.responsesReceived, saved.responses.length], [1, 0, 0]);
    const receipts = await ctx.pool.query('SELECT count(*)::int AS count FROM examination_engine.attempt_commands WHERE attempt_id = $1',
      [ctx.attempt.attemptId]);
    assert.equal(receipts.rows[0].count, 0);
  } finally {
    await ctx.pool.query(`DROP TRIGGER ${triggerName} ON examination_engine.attempt_events`);
    await ctx.pool.query(`DROP FUNCTION examination_engine.${functionName}()`);
  }
  const retried = await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt));
  assert.deepEqual([retried.replay, retried.attempt.sequence, retried.attempt.responsesReceived], [false, 2, 1]);
});

test('PostgreSQL finalization rollback leaves neither grade nor terminal event and retry commits both', async (t) => {
  const ctx = await fixture(t);
  const ready = await answerAll(ctx);
  const unique = randomUUID().replaceAll('-', '');
  const name = `test_terminal_${unique}`;
  await ctx.pool.query(`CREATE FUNCTION examination_engine.${name}() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected terminal failure'; END $$`);
  await ctx.pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON examination_engine.attempt_events
    FOR EACH ROW WHEN (NEW.attempt_id = '${ready.attemptId}'::uuid AND NEW.event_type = 'attempt_completed')
    EXECUTE FUNCTION examination_engine.${name}()`);
  const command = finalizeCommand(ready);
  try {
    await assert.rejects(ctx.store.command(ready.attemptId, command), /injected terminal failure/);
    const saved = await createPgStore(ctx.pool).get(ready.attemptId);
    assert.deepEqual([saved.status, saved.sequence], ['in_progress', 16]);
    assert.equal(saved.events.some((event) => event.eventType === 'grade_recorded'), false);
  } finally {
    await ctx.pool.query(`DROP TRIGGER ${name} ON examination_engine.attempt_events`);
    await ctx.pool.query(`DROP FUNCTION examination_engine.${name}()`);
  }
  const completed = await createPgStore(ctx.pool).command(ready.attemptId, command);
  assert.deepEqual([completed.replay, completed.attempt.status, completed.attempt.sequence], [false, 'complete', 18]);
});

test('PostgreSQL deadlines persist across restart but fully collected timely attempts may be graded later', async (t) => {
  const ctx = await fixture(t);
  await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt));
  const expired = await createPgStore(ctx.pool).command(ctx.attempt.attemptId, { type: 'timeout', now: DEADLINE,
    correlationId: 'pg-timeout' });
  assert.equal(expired.attempt.status, 'agent_failed');
  assert.equal((await createPgStore(ctx.pool).get(ctx.attempt.attemptId)).status, 'agent_failed');
  const completeCtx = await fixture(t);
  const ready = await answerAll(completeCtx);
  const afterRestart = createPgStore(completeCtx.pool);
  const stillWaiting = await afterRestart.command(ready.attemptId, { type: 'timeout', now: AFTER_DEADLINE,
    correlationId: 'pg-late-sweep' });
  assert.deepEqual([stillWaiting.attempt.status, stillWaiting.attempt.sequence], ['in_progress', 16]);
  const completed = await afterRestart.command(ready.attemptId, finalizeCommand(ready));
  assert.equal(completed.attempt.status, 'complete');
  const replay = await createPgStore(completeCtx.pool).get(ready.attemptId);
  assert.deepEqual([replay.status, replay.completedAt], ['complete', AFTER_DEADLINE]);
});

test('PostgreSQL grade, timeout and abort races leave exactly one terminal event and duplicate grade replay is safe', async (t) => {
  const ctx = await fixture(t);
  const ready = await answerAll(ctx);
  const command = finalizeCommand(ready);
  const raced = await Promise.allSettled([
    ctx.store.command(ready.attemptId, command),
    createPgStore(ctx.pool).command(ready.attemptId, { type: 'abort', idempotencyKey: 'abort-race',
      expectedSequence: ready.sequence, eventId: randomUUID(), reason: 'governance_changed',
      now: AFTER_DEADLINE, correlationId: 'pg-abort' }),
    createPgStore(ctx.pool).command(ready.attemptId, { type: 'timeout', now: AFTER_DEADLINE, correlationId: 'pg-race-timeout' }),
  ]);
  assert.equal(raced.slice(0, 2).filter((entry) => entry.status === 'fulfilled').length, 1);
  const saved = await createPgStore(ctx.pool).get(ready.attemptId);
  assert.ok(['complete', 'system_aborted'].includes(saved.status));
  const terminal = await ctx.pool.query(`SELECT event_type FROM examination_engine.attempt_events WHERE attempt_id = $1
    AND event_type IN ('attempt_completed','agent_failed','system_aborted')`, [ready.attemptId]);
  assert.equal(terminal.rows.length, 1);
  const gradeCtx = await fixture(t);
  const gradeReady = await answerAll(gradeCtx);
  const grade = finalizeCommand(gradeReady);
  await gradeCtx.store.command(gradeReady.attemptId, grade);
  const duplicate = await createPgStore(gradeCtx.pool).command(gradeReady.attemptId, { ...grade, idempotencyKey: 'duplicate-event' });
  assert.deepEqual([duplicate.replay, duplicate.attempt.sequence], [true, 18]);
  const foreign = await fixture(t);
  const foreignReady = await answerAll(foreign);
  await assert.rejects(foreign.store.command(foreignReady.attemptId, { ...finalizeCommand(foreignReady), eventId: grade.eventId }),
    (error) => error.status === 409);
  assert.equal((await foreign.store.get(foreignReady.attemptId)).sequence, 16);
});

test('PostgreSQL migration preserves an Issue 16 manifest and legacy sequence-one start event', async (t) => {
  const ctx = await fixture(t);
  const attemptId = randomUUID();
  await ctx.pool.query(`INSERT INTO examination_engine.attempts
    (attempt_id,agent_learner_key,idempotency_key,configuration_fingerprint,package_id,package_version,package_digest,
     form_digest,form,mode,started_at,deadline_at,correlation_id)
    VALUES ($1,$2,'legacy-start',$3,$4,$5,$6,$7,$8,'standard',$9,$10,'legacy-issue-16')`,
  [attemptId, ctx.form.subject.agentLearnerKey, ctx.form.subject.configurationFingerprint,
    ctx.form.package.id, ctx.form.package.version, ctx.form.package.digest, sha256(ctx.form), JSON.stringify(ctx.form), START, DEADLINE]);
  await ctx.pool.query(`INSERT INTO examination_engine.attempt_events
    (attempt_id,seq,event_type,occurred_at,correlation_id) VALUES ($1,1,'attempt_started',$2,'legacy-issue-16')`,
  [attemptId, START]);
  await ctx.pool.query(fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8'));
  const restored = await createPgStore(ctx.pool).get(attemptId);
  assert.deepEqual([restored.status, restored.sequence, restored.responsesReceived], ['in_progress', 1, 0]);
  assert.equal(restored.events[0].eventId, null);
  assert.deepEqual(restored.form, ctx.form);
  assert.equal(restored.formDigest, sha256(ctx.form));
  const accepted = await ctx.store.command(attemptId, responseCommand(restored));
  assert.equal(accepted.attempt.sequence, 2);
});

// Issue #18 integration: a graded attempt keeps its assessment in PostgreSQL.
// jsonb reorders object keys, so the stored assessment must still pass its
// integrity check when a fresh store replays the event history.
test('PostgreSQL keeps the assessment of a graded attempt and lists only ungraded complete attempts', async (t) => {
  const { createGradingRunner } = require('../grading');
  const ctx = await fixture(t);
  const answered = await answerAll(ctx);
  assert.ok((await ctx.store.listAwaitingGrading(1000)).includes(answered.attemptId));
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg); pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const sources = { activePackage: async () => pkg,
    registration: async () => ({ configurationFingerprint: answered.configurationFingerprint }) };
  const gradeItems = async ({ items }) => ({ ok: true, body: { grader: { id: 'pg-grader', version: '1.0.0' },
    results: items.map((item) => ({ itemId: item.itemId, score: item.tier === 'adversarial' ? 60 : 95,
      criticalViolationRuleIds: [], rationale: 'pg fixture', citedItemIds: [item.itemId] })) } });
  const runner = createGradingRunner({ store: ctx.store, sources, gradeItems, clock: () => AFTER_DEADLINE });
  const graded = await runner.grade(answered.attemptId, 'pg-grade');
  assert.deepEqual([graded.attempt.status, graded.attempt.terminalReason], ['agent_failed', 'valid_failing_result']);
  const reread = await createPgStore(ctx.pool).get(answered.attemptId);
  assert.deepEqual(reread.assessment.failureReasons, ['insufficient_adversarial_score']);
  assert.equal(reread.assessment.tierPercents.adversarial, 60);
  assert.ok(!(await ctx.store.listAwaitingGrading(1000)).includes(answered.attemptId));
  const replay = await runner.grade(answered.attemptId, 'pg-grade-again');
  assert.equal(replay.outcome, 'replay');
});
