'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { generateStandardForm } = require('../generation');
const { createStandardItems } = require('../standard-generator');
const { createMemoryStore } = require('../store');
const { derive } = require('../lifecycle');

const START = '2026-10-12T06:00:00.000Z';
const BEFORE_DEADLINE = '2026-10-12T06:59:59.999Z';
const DEADLINE = '2026-10-12T07:00:00.000Z';
const AFTER_DEADLINE = '2026-10-12T08:00:00.000Z';

async function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: `lifecycle-${randomUUID()}`, configurationFingerprint: 'sha256:locked-fingerprint' };
  const completion = { eventType: 'training.session.completed', eventId: 'training-completed', sessionId: 'training-session',
    agentLearnerKey: registration.agentLearnerKey, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
  const store = createMemoryStore();
  const { attempt } = await store.admit({ actor: registration.agentLearnerKey, key: 'start', form,
    now: START, deadlineAt: DEADLINE, correlationId: 'lifecycle-test' });
  return { store, attempt, form };
}

function responseCommand(attempt, overrides = {}) {
  return { type: 'response', idempotencyKey: 'response-1', expectedSequence: attempt.sequence,
    itemId: attempt.form.items[0].id, response: 'A valid learner response.',
    now: BEFORE_DEADLINE, correlationId: 'response-test', ...overrides };
}

async function answerAll(ctx) {
  let current = await ctx.store.get(ctx.attempt.attemptId);
  for (const [index, item] of current.form.items.entries()) {
    const outcome = await ctx.store.command(current.attemptId, responseCommand(current, {
      itemId: item.id, idempotencyKey: `response-${index + 1}`, response: `Accepted response ${index + 1}.`,
    }));
    current = outcome.attempt;
  }
  return current;
}

function finalizeCommand(attempt, overrides = {}) {
  return { type: 'finalize', idempotencyKey: 'grade-1', expectedSequence: attempt.sequence,
    eventId: randomUUID(), formDigest: attempt.formDigest, rubricDigest: attempt.form.rubric.digest,
    responseSetDigest: attempt.responseSetDigest,
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: true },
    now: AFTER_DEADLINE, correlationId: 'grade-test', ...overrides };
}

const conflict = (error) => error.status === 409;

test('attempt configuration remains immutable through admission, reads and response acceptance', async () => {
  const ctx = await fixture();
  const original = structuredClone(ctx.attempt);
  assert.deepEqual([original.status, original.sequence, original.responsesReceived], ['in_progress', 1, 0]);
  ctx.attempt.form.items[0].prompt = 'Caller mutation';
  ctx.attempt.configurationFingerprint = 'changed';
  const saved = await ctx.store.get(original.attemptId);
  assert.equal(saved.configurationFingerprint, original.configurationFingerprint);
  assert.deepEqual(saved.form, original.form);
  const accepted = await ctx.store.command(saved.attemptId, responseCommand(saved));
  for (const field of ['agentLearnerKey', 'configurationFingerprint', 'package', 'form', 'formDigest', 'mode', 'startedAt', 'deadlineAt']) {
    assert.deepEqual(accepted.attempt[field], original[field], field);
  }
  accepted.attempt.form.items.length = 0;
  assert.equal((await ctx.store.get(saved.attemptId)).form.items.length, 15);
});

test('first accepted answer is final; identical command and same-answer retries append nothing', async () => {
  const ctx = await fixture();
  const command = responseCommand(ctx.attempt);
  const accepted = await ctx.store.command(ctx.attempt.attemptId, command);
  assert.deepEqual([accepted.replay, accepted.attempt.sequence, accepted.attempt.responsesReceived], [false, 2, 1]);
  const replay = await ctx.store.command(ctx.attempt.attemptId, { ...command, now: AFTER_DEADLINE, correlationId: 'retry' });
  assert.equal(replay.replay, true);
  assert.equal(replay.attempt.sequence, 2);
  const sameAnswer = await ctx.store.command(ctx.attempt.attemptId, { ...command, idempotencyKey: 'response-retry' });
  assert.equal(sameAnswer.replay, true);
  assert.equal(sameAnswer.attempt.sequence, 2);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, {
    ...command, idempotencyKey: 'different-answer', expectedSequence: 2, response: 'An edited answer.',
  }), conflict);
  assert.equal((await ctx.store.get(ctx.attempt.attemptId)).responsesReceived, 1);
});

test('a reused idempotency key cannot mean a different response, item, or command', async () => {
  const ctx = await fixture();
  const command = responseCommand(ctx.attempt);
  await ctx.store.command(ctx.attempt.attemptId, command);
  for (const change of [{ response: 'Different.' }, { itemId: ctx.attempt.form.items[1].id },
    { type: 'abort', reason: 'governance_changed', eventId: randomUUID() }]) {
    await assert.rejects(ctx.store.command(ctx.attempt.attemptId, { ...command, ...change }), conflict);
  }
  assert.equal((await ctx.store.get(ctx.attempt.attemptId)).sequence, 2);
});

test('sequence gaps, stale writes, unknown items and nonexistent attempts cannot mutate state', async () => {
  const ctx = await fixture();
  const command = responseCommand(ctx.attempt);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, { ...command, expectedSequence: 3 }), conflict);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, { ...command, itemId: 'not-in-locked-form' }));
  assert.equal((await ctx.store.get(ctx.attempt.attemptId)).sequence, 1);
  await ctx.store.command(ctx.attempt.attemptId, command);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, { ...command,
    idempotencyKey: 'stale-next-item', itemId: ctx.attempt.form.items[1].id }), conflict);
  await assert.rejects(ctx.store.command(randomUUID(), command), (error) => error.status === 404);
  assert.equal((await ctx.store.get(ctx.attempt.attemptId)).sequence, 2);
});

test('concurrent identical submissions converge while competing answers accept exactly one', async () => {
  const identical = await fixture();
  const command = responseCommand(identical.attempt);
  const retries = await Promise.all([
    identical.store.command(identical.attempt.attemptId, command),
    identical.store.command(identical.attempt.attemptId, { ...command, idempotencyKey: 'retry-key' }),
  ]);
  assert.deepEqual(retries.map((entry) => entry.replay).sort(), [false, true]);
  assert.equal((await identical.store.get(identical.attempt.attemptId)).sequence, 2);
  const competing = await fixture();
  const base = responseCommand(competing.attempt);
  const answers = await Promise.allSettled([
    competing.store.command(competing.attempt.attemptId, base),
    competing.store.command(competing.attempt.attemptId, { ...base, idempotencyKey: 'competitor', response: 'Competing answer.' }),
  ]);
  assert.equal(answers.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(answers.find((entry) => entry.status === 'rejected').reason.status, 409);
  assert.equal((await competing.store.get(competing.attempt.attemptId)).responsesReceived, 1);
});

test('response deadline expires incomplete attempts durably and terminal state cannot be changed', async () => {
  const ctx = await fixture();
  const expired = await ctx.store.command(ctx.attempt.attemptId, { type: 'timeout', now: DEADLINE,
    correlationId: 'deadline-test' });
  assert.equal(expired.attempt.status, 'agent_failed');
  assert.equal(expired.attempt.sequence, 2);
  const again = await ctx.store.command(ctx.attempt.attemptId, { type: 'timeout', now: AFTER_DEADLINE,
    correlationId: 'deadline-retry' });
  assert.equal(again.attempt.sequence, 2);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, responseCommand(expired.attempt)), conflict);
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, { type: 'abort', idempotencyKey: 'late-abort',
    expectedSequence: 2, eventId: randomUUID(), reason: 'governance_changed', now: AFTER_DEADLINE,
    correlationId: 'late-abort' }), conflict);
});

test('all 15 timely answers await grading after deadline and trusted passing finalization is atomic', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  assert.deepEqual([ready.status, ready.sequence, ready.responsesReceived, ready.responseCollectionComplete],
    ['in_progress', 16, 15, true]);
  const swept = await ctx.store.command(ready.attemptId, { type: 'timeout', now: AFTER_DEADLINE, correlationId: 'sweep' });
  assert.equal(swept.attempt.status, 'in_progress');
  assert.equal(swept.attempt.sequence, 16);
  const finalized = await ctx.store.command(ready.attemptId, finalizeCommand(ready));
  assert.equal(finalized.attempt.status, 'complete');
  assert.equal(finalized.attempt.sequence, 18);
  assert.equal(finalized.attempt.completedAt, AFTER_DEADLINE);
});

test('a valid failing trusted result produces Agent-Failed after complete response collection', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  const failed = await ctx.store.command(ready.attemptId, finalizeCommand(ready, {
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: false },
  }));
  assert.equal(failed.attempt.status, 'agent_failed');
  assert.equal(failed.attempt.sequence, 18);
  assert.equal(failed.attempt.failedAt, AFTER_DEADLINE);
});

test('invalid, incomplete and wrongly bound grade requests leave the attempt unchanged', async () => {
  const ctx = await fixture();
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, finalizeCommand(ctx.attempt)));
  assert.equal((await ctx.store.get(ctx.attempt.attemptId)).sequence, 1);
  const ready = await answerAll(ctx);
  for (const change of [{ formDigest: 'sha256:wrong' }, { rubricDigest: 'sha256:wrong' },
    { responseSetDigest: 'sha256:wrong' }, { result: { valid: false, passed: true } },
    { result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: 'yes' } }]) {
    await assert.rejects(ctx.store.command(ready.attemptId, finalizeCommand(ready, { ...change, idempotencyKey: randomUUID() })));
    assert.equal((await ctx.store.get(ready.attemptId)).sequence, 16);
  }
});

test('grade receipt and lifecycle event identity replay across stale sequences without a second terminal outcome', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  const command = finalizeCommand(ready);
  const first = await ctx.store.command(ready.attemptId, command);
  const replay = await ctx.store.command(ready.attemptId, { ...command, now: '2026-10-13T00:00:00.000Z' });
  assert.equal(replay.replay, true);
  assert.equal(replay.attempt.sequence, first.attempt.sequence);
  const duplicateEvent = await ctx.store.command(ready.attemptId, { ...command, idempotencyKey: 'same-event-new-command' });
  assert.equal(duplicateEvent.replay, true);
  assert.equal(duplicateEvent.attempt.sequence, 18);
  await assert.rejects(ctx.store.command(ready.attemptId, { ...command, idempotencyKey: 'same-event-different-result',
    result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: false } }), conflict);
});

test('trusted grade and governance abort race to one immutable terminal outcome', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  const outcomes = await Promise.allSettled([
    ctx.store.command(ready.attemptId, finalizeCommand(ready)),
    ctx.store.command(ready.attemptId, { type: 'abort', idempotencyKey: 'abort-race', expectedSequence: ready.sequence,
      eventId: randomUUID(), reason: 'governance_changed', now: AFTER_DEADLINE, correlationId: 'abort-race' }),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((entry) => entry.status === 'rejected').reason.status, 409);
  const saved = await ctx.store.get(ready.attemptId);
  assert.ok(['complete', 'system_aborted'].includes(saved.status));
  assert.equal(saved.sequence, saved.status === 'complete' ? 18 : 17);
});

test('complete response collection racing with timeout never becomes Agent-Failed', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  const outcomes = await Promise.all([
    ctx.store.command(ready.attemptId, finalizeCommand(ready)),
    ctx.store.command(ready.attemptId, { type: 'timeout', now: AFTER_DEADLINE, correlationId: 'timeout-race' }),
  ]);
  assert.ok(outcomes.every((entry) => entry.attempt.status !== 'agent_failed'));
  assert.equal((await ctx.store.get(ready.attemptId)).status, 'complete');
});

test('event replay rejects gaps, reordered or duplicated entries and a foreign aggregate', async () => {
  const ctx = await fixture();
  const { attempt } = await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt));
  const histories = [
    attempt.events.map((event, index) => ({ ...event, seq: index === 1 ? 3 : event.seq })),
    [...attempt.events].reverse(),
    [...attempt.events, structuredClone(attempt.events[1])],
    attempt.events.map((event, index) => ({ ...event, attemptId: index === 1 ? randomUUID() : attempt.attemptId })),
  ];
  for (const events of histories) assert.throws(() => derive(attempt, events, attempt.responses), /invalid_event_history/);
  assert.equal(derive(attempt, attempt.events, attempt.responses).sequence, 2);
});

test('raw responses stay in restricted evidence and never enter lifecycle events', async () => {
  const ctx = await fixture();
  const rawAnswer = 'PRIVATE_LEARNER_RESPONSE_7da2d45b';
  const accepted = await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt, { response: rawAnswer }));
  assert.equal(accepted.attempt.responses[0].response, rawAnswer);
  assert.equal(accepted.attempt.responses[0].responseDigest, sha256(rawAnswer));
  assert.equal(JSON.stringify(accepted.attempt.events).includes(rawAnswer), false);
});

test('malformed commands reject without appending lifecycle evidence or changing outcome', async () => {
  const ctx = await fixture();
  for (const change of [{ response: 'answer\0' }, { response: '\ud800' }, { response: '' }, { response: '   ' }, { response: 'x'.repeat(16001) },
    { response: { answer: 'structured but unsupported' } }, { expectedSequence: 0 }, { idempotencyKey: '\n' }]) {
    await assert.rejects(ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt, change)),
      (error) => error.status === 400);
    const saved = await ctx.store.get(ctx.attempt.attemptId);
    assert.deepEqual([saved.status, saved.sequence, saved.responsesReceived], ['in_progress', 1, 0]);
  }
});

test('a response at deadline is not accepted and records the timeout independently of the rejected command', async () => {
  const ctx = await fixture();
  await assert.rejects(ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt, { now: DEADLINE })),
    (error) => error.status === 409);
  const saved = await ctx.store.get(ctx.attempt.attemptId);
  assert.deepEqual([saved.status, saved.sequence, saved.responsesReceived], ['agent_failed', 2, 0]);
  assert.equal(saved.terminalReason, 'response_deadline_elapsed');
});

test('event replay detects changed manifests and mismatches between accepted events and restricted response evidence', async () => {
  const ctx = await fixture();
  const accepted = await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt));
  const current = accepted.attempt;
  for (const change of [{ configurationFingerprint: 'different-fingerprint' }, { formDigest: 'wrong-form-digest' },
    { package: { ...current.package, version: 'different-version' } }, { deadlineAt: START }]) {
    assert.throws(() => derive({ ...current, ...change }, current.events, current.responses), /invalid_manifest/);
  }
  for (const change of [{ response: 'Changed durable answer.' }, { responseDigest: 'wrong-digest' },
    { seq: 100 }, { acceptedAt: START }]) {
    assert.throws(() => derive(current, current.events, [{ ...current.responses[0], ...change }]), /invalid_event_history/);
  }
  const events = structuredClone(current.events);
  events[1].payload.responseDigest = 'different-event-digest';
  assert.throws(() => derive(current, events, current.responses), /invalid_event_history/);
});

test('event replay rejects regressing timestamps and repeated lifecycle event identities', async () => {
  const ctx = await fixture();
  const first = await ctx.store.command(ctx.attempt.attemptId, responseCommand(ctx.attempt));
  const second = await ctx.store.command(ctx.attempt.attemptId, responseCommand(first.attempt, {
    itemId: ctx.form.items[1].id, idempotencyKey: 'response-2',
  }));
  const regressed = structuredClone(second.attempt.events);
  regressed[2].occurredAt = START;
  assert.throws(() => derive(second.attempt, regressed, second.attempt.responses), /invalid_event_history/);
  const duplicatedIdentity = structuredClone(second.attempt.events);
  duplicatedIdentity[2].eventId = duplicatedIdentity[1].eventId;
  assert.throws(() => derive(second.attempt, duplicatedIdentity, second.attempt.responses), /invalid_event_history/);
});

test('grade replay requires locked evidence bindings and an aligned terminal event in the same committed history', async () => {
  const ctx = await fixture();
  const ready = await answerAll(ctx);
  const completed = await ctx.store.command(ready.attemptId, finalizeCommand(ready));
  for (const change of [{ formDigest: 'different-form' }, { rubricDigest: 'different-rubric' },
    { responseSetDigest: 'different-response-set' },
    { result: { schemaVersion: 'examination-result/1.0.0', valid: true, passed: false } }]) {
    const events = structuredClone(completed.attempt.events);
    Object.assign(events[16].payload, change);
    assert.throws(() => derive(completed.attempt, events, completed.attempt.responses), /invalid_event_history/);
  }
  assert.throws(() => derive(completed.attempt, completed.attempt.events.slice(0, -1), completed.attempt.responses),
    /invalid_event_history/);
  const invalidTimeout = [...structuredClone(ready.events), { attemptId: ready.attemptId, seq: 17,
    eventId: randomUUID(), eventType: 'agent_failed', occurredAt: AFTER_DEADLINE,
    payload: { reason: 'response_deadline_elapsed' } }];
  assert.throws(() => derive(ready, invalidTimeout, ready.responses), /invalid_event_history/);
});
