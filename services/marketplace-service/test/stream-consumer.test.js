'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { issueCredential } = require('../../certification-service/evidence');
const { createMemoryStore } = require('../store');
const { createCredentialConsumer, toProjectionEvent, MAX_ATTEMPTS } = require('../stream-consumer');

const NOW = '2026-10-18T00:00:00.000Z';

function issuedRecord(agent = 'agent-a') {
  const { privateKey } = generateKeyPairSync('ed25519');
  const scores = { overallPercent: 90, tierPercents: { recall: 90, applied: 90, adversarial: 80 }, itemOutcomes: [] };
  const pkg = { id: 'ai-safety-fundamentals', version: '1.0.0', digest: 'sha256-package-1' };
  return issueCredential({ subjectId: agent, subjectFingerprint: `sha256:fp-${agent}`, packageId: pkg.id, packageVersion: pkg.version,
    mode: 'standard', scores, safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] },
    examinationEvidence: { package: pkg, scores } }, { privateKey, keyId: 'k', now: () => '2026-09-18T00:00:00.000Z' });
}

const issuedEnvelope = (record, eventId = 'evt-1', agent = 'agent-a') => JSON.stringify({
  eventId, eventType: 'credential.issued', credentialId: record.credentialId, agentLearnerKey: agent,
  occurredAt: '2026-09-18T00:00:00.000Z', credential: record });

// A fake Redis with one consumer group: entries are delivered once by xReadGroup and stay pending until acked.
function fakeRedis(entries = []) {
  const redis = {
    isReady: true, acked: [], pending: [], fail: null,
    async xGroupCreate() { if (redis.fail) throw new Error(redis.fail); throw new Error('BUSYGROUP Consumer Group name already exists'); },
    async xAutoClaim() { return { messages: redis.pending.filter((e) => !redis.acked.includes(e.id)) }; },
    async xReadGroup() {
      const fresh = entries.splice(0);
      redis.pending.push(...fresh);
      return fresh.length ? [{ name: 'certification.credentials', messages: fresh }] : null;
    },
    async xAck(_stream, _group, id) { redis.acked.push(id); return 1; },
    add(entry) { entries.push(entry); },
  };
  return redis;
}

const entry = (id, envelope) => ({ id, message: { envelope } });

test('an issued event from the real credential shape is projected and acknowledged', async () => {
  const store = createMemoryStore();
  const record = issuedRecord();
  const redis = fakeRedis([entry('1-0', issuedEnvelope(record))]);
  await createCredentialConsumer({ store, redis, clock: () => NOW }).consume();
  const [projected] = await store.listProjection();
  assert.equal(projected.status, 'active');
  assert.equal(projected.candidate.agentLearnerKey, 'agent-a');
  assert.equal(projected.candidate.overallPercent, 90);
  assert.equal(projected.candidate.environment, null);
  assert.equal(projected.candidate.compactJws, record.compactJws);
  assert.deepEqual(redis.acked, ['1-0']);
});

test('the same event delivered twice is applied once, and both deliveries are acknowledged', async () => {
  const store = createMemoryStore();
  const record = issuedRecord();
  const suspended = JSON.stringify({ eventId: 'evt-2', eventType: 'credential.suspended', credentialId: record.credentialId,
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-01T00:00:00.000Z' });
  const reinstated = JSON.stringify({ eventId: 'evt-3', eventType: 'credential.reinstated', credentialId: record.credentialId,
    agentLearnerKey: 'agent-a', occurredAt: '2026-10-02T00:00:00.000Z' });
  const redis = fakeRedis([entry('1-0', issuedEnvelope(record)), entry('2-0', suspended), entry('3-0', reinstated),
    entry('4-0', suspended)]);
  const consumer = createCredentialConsumer({ store, redis, clock: () => NOW });
  await consumer.consume();
  assert.equal((await store.listProjection())[0].status, 'active');
  assert.deepEqual(redis.acked, ['1-0', '2-0', '3-0', '4-0']);
});

test('a malformed entry is quarantined at once and does not block the next entry', async () => {
  const store = createMemoryStore();
  const record = issuedRecord();
  const tampered = JSON.parse(issuedEnvelope(record));
  tampered.agentLearnerKey = 'agent-b';
  const redis = fakeRedis([entry('1-0', 'not json'), entry('2-0', JSON.stringify(tampered)), entry('3-0', issuedEnvelope(record))]);
  await createCredentialConsumer({ store, redis, clock: () => NOW }).consume();
  assert.deepEqual([...store.quarantined().entries()],
    [['1-0', 'invalid_or_unrecognized_event'], ['2-0', 'invalid_or_unrecognized_event']]);
  assert.equal((await store.listProjection()).length, 1);
  assert.deepEqual(redis.acked, ['1-0', '2-0', '3-0']);
});

test('an entry that keeps failing is quarantined after three attempts', async () => {
  const store = createMemoryStore();
  const realApply = store.transaction;
  store.transaction = async () => { throw new Error('database down'); };
  const redis = fakeRedis([entry('1-0', issuedEnvelope(issuedRecord()))]);
  const consumer = createCredentialConsumer({ store, redis, clock: () => NOW });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await consumer.consume();
    assert.deepEqual(redis.acked, [], `attempt ${attempt} leaves it pending`);
  }
  store.transaction = realApply;
  await consumer.consume();
  assert.deepEqual([...store.quarantined().entries()], [['1-0', 'automatic_attempts_exhausted']]);
  assert.deepEqual(redis.acked, ['1-0']);
  assert.deepEqual(await store.listProjection(), []);
});

test('the consumer keeps running while Redis is down or failing', async () => {
  const store = createMemoryStore();
  const redis = fakeRedis([entry('1-0', issuedEnvelope(issuedRecord()))]);
  const consumer = createCredentialConsumer({ store, redis, clock: () => NOW });
  redis.isReady = false;
  await consumer.tick();
  redis.isReady = true;
  redis.fail = 'ECONNRESET';
  await consumer.tick();
  assert.deepEqual(await store.listProjection(), []);
  redis.fail = null;
  await consumer.tick();
  assert.equal((await store.listProjection()).length, 1);
});

test('toProjectionEvent passes status events through and refuses an issued event it cannot trust', () => {
  const status = { eventId: 'e', eventType: 'credential.revoked', credentialId: 'c', agentLearnerKey: 'a', occurredAt: NOW, extra: 'x' };
  assert.deepEqual(toProjectionEvent(JSON.stringify(status)),
    { eventId: 'e', eventType: 'credential.revoked', credentialId: 'c', agentLearnerKey: 'a', occurredAt: NOW });
  for (const raw of [undefined, '', '[]', 'null', JSON.stringify({ ...status, eventType: 'credential.issued' })])
    assert.equal(toProjectionEvent(raw), null, String(raw));
  const record = issuedRecord();
  const otherCredential = JSON.parse(issuedEnvelope(record));
  otherCredential.credentialId = 'someone-else';
  assert.equal(toProjectionEvent(JSON.stringify(otherCredential)), null);
});
