'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { generateStandardForm } = require('../generation');
const { createStandardItems } = require('../standard-generator');
const { buildFallbackForm } = require('../fallback-form');
const { createMemoryStore } = require('../store');

const START = '2026-10-14T06:00:00.000Z';
const DEADLINE = '2026-10-14T07:00:00.000Z';
const ACTOR = 'store-fallback-learner';
const registration = { agentLearnerKey: ACTOR, configurationFingerprint: 'sha256:store-fallback-fingerprint' };

function activePackage() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  return pkg;
}

// A standard attempt to act as the aborted cause.
async function standardAttempt(store, key) {
  const pkg = activePackage();
  const completion = { eventType: 'training.session.completed', eventId: `completed-${key}`, sessionId: `session-${key}`,
    agentLearnerKey: ACTOR, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 } };
  const form = await generateStandardForm({ pkg, registration, completion, generateItems: createStandardItems });
  return (await store.admit({ actor: ACTOR, key, form, now: START, deadlineAt: DEADLINE, correlationId: key })).attempt;
}

function fallbackInput(key, causeAttemptId) {
  const pkg = activePackage();
  const bank = candidate.fallbackBank;
  const selection = JSON.parse(JSON.stringify({ packageId: pkg.packageId, bankId: bank.id, bankVersion: bank.version,
    scoringPolicy: bank.scoringPolicy, attemptId: randomUUID(), mode: 'fallback',
    items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) }));
  const form = buildFallbackForm({ selection, packageId: pkg.packageId, packageVersion: pkg.version, packageDigest: pkg.digest,
    causeAttemptId, reason: 'standard_grading_unavailable', agentLearnerKey: ACTOR,
    configurationFingerprint: registration.configurationFingerprint });
  return { actor: ACTOR, key, form, now: START, deadlineAt: DEADLINE,
    correlationId: key, causeAttemptId, reason: 'standard_grading_unavailable', bankId: bank.id,
    bankVersion: bank.version, bankDigest: sha256(bank) };
}

test('fresh fallback admission stores mode fallback, the five fallback fields and one start event', async () => {
  const store = createMemoryStore();
  const cause = await standardAttempt(store, 'standard-1');
  for (const field of ['fallbackCauseAttemptId', 'fallbackReason', 'fallbackBankId', 'fallbackBankVersion', 'fallbackBankDigest'])
    assert.equal(cause[field], null, field);
  const input = fallbackInput('fallback-1', cause.attemptId);
  const { attempt, replay } = await store.admitFallback(input);
  assert.equal(replay, false);
  assert.notEqual(attempt.attemptId, cause.attemptId);
  assert.deepEqual([attempt.mode, attempt.form.mode, attempt.status, attempt.sequence], ['fallback', 'fallback', 'in_progress', 1]);
  assert.deepEqual([attempt.fallbackCauseAttemptId, attempt.fallbackReason, attempt.fallbackBankId,
    attempt.fallbackBankVersion, attempt.fallbackBankDigest],
  [cause.attemptId, 'standard_grading_unavailable', input.bankId, input.bankVersion, input.bankDigest]);
  assert.deepEqual(attempt.events.map((event) => [event.seq, event.eventType]), [[1, 'attempt_started']]);
  const read = await store.get(attempt.attemptId);
  assert.equal(read.fallbackCauseAttemptId, cause.attemptId);
  assert.equal(read.formDigest, sha256(input.form));
});

test('same actor and key replays the same fallback attempt without a second admission', async () => {
  const store = createMemoryStore();
  const cause = await standardAttempt(store, 'standard-1');
  const first = await store.admitFallback(fallbackInput('fallback-1', cause.attemptId));
  const again = await store.admitFallback(fallbackInput('fallback-1', cause.attemptId));
  assert.equal(again.replay, true);
  assert.equal(again.attempt.attemptId, first.attempt.attemptId);
  assert.equal((await store.findByKey(ACTOR, 'fallback-1')).attemptId, first.attempt.attemptId);
  // Concurrent same-key admissions converge on one attempt.
  const other = await standardAttempt(store, 'standard-2');
  const raced = await Promise.all([store.admitFallback(fallbackInput('fallback-2', other.attemptId)),
    store.admitFallback(fallbackInput('fallback-2', other.attemptId))]);
  assert.deepEqual(raced.map((entry) => entry.replay).sort(), [false, true]);
  assert.equal(raced[0].attempt.attemptId, raced[1].attempt.attemptId);
});

test('different causes each admit their own fallback attempt', async () => {
  const store = createMemoryStore();
  const causes = [await standardAttempt(store, 'standard-1'), await standardAttempt(store, 'standard-2')];
  const admitted = [await store.admitFallback(fallbackInput('fallback-1', causes[0].attemptId)),
    await store.admitFallback(fallbackInput('fallback-2', causes[1].attemptId))];
  assert.deepEqual(admitted.map((entry) => entry.replay), [false, false]);
  assert.notEqual(admitted[0].attempt.attemptId, admitted[1].attempt.attemptId);
  assert.deepEqual(admitted.map((entry) => entry.attempt.fallbackCauseAttemptId), causes.map((cause) => cause.attemptId));
});

test('a cause can produce only one fallback; unknown causes and incomplete fields are refused', async () => {
  const store = createMemoryStore();
  const cause = await standardAttempt(store, 'standard-1');
  await store.admitFallback(fallbackInput('fallback-1', cause.attemptId));
  await assert.rejects(store.admitFallback(fallbackInput('fallback-2', cause.attemptId)),
    { code: 'fallback_already_admitted', status: 409 });
  assert.equal(await store.findByKey(ACTOR, 'fallback-2'), null);
  await assert.rejects(store.admitFallback(fallbackInput('fallback-3', randomUUID())),
    { code: 'fallback_cause_not_found', status: 409 });
  for (const change of [{ reason: null }, { bankId: '' }, { bankVersion: undefined }, { bankDigest: null },
    { causeAttemptId: 'not-a-uuid' }]) {
    await assert.rejects(store.admitFallback({ ...fallbackInput('fallback-4', null), ...change }),
      { code: 'invalid_fallback_admission', status: 400 });
  }
  const standardForm = (await store.get(cause.attemptId)).form;
  await assert.rejects(store.admitFallback({ ...fallbackInput('fallback-5', null), form: standardForm }),
    { code: 'invalid_fallback_admission', status: 400 });
  // A generation outage has no aborted attempt to link; null causes never collide.
  const unlinked = [await store.admitFallback(fallbackInput('fallback-6', null)),
    await store.admitFallback(fallbackInput('fallback-7', null))];
  assert.notEqual(unlinked[0].attempt.attemptId, unlinked[1].attempt.attemptId);
  assert.equal(unlinked[0].attempt.fallbackCauseAttemptId, null);
});
