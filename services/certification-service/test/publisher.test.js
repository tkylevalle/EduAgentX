'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialPublisher, envelopeFor } = require('../publisher');

const row = (id) => ({ credential_id: id, credential: { id: `https://eduagentx.example/credentials/${id}` },
  compact_jws: 'h.p.s', issued_at: '2026-10-18T08:00:00.000Z', subject_id: 'agent-1' });

// A pool stand-in: the pending query returns unpublished rows, an insert marks one published.
function fakePool(ids) {
  const published = new Set();
  return {
    published,
    async query(sql, params) {
      if (sql.includes('LEFT JOIN')) return { rows: ids.filter((id) => !published.has(id)).map(row) };
      if (sql.includes('INSERT INTO certification_engine.credential_publications')) published.add(params[0]);
      return { rows: [] };
    },
  };
}

const okFetch = (calls) => async (url, options) => { calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
  return { ok: true, status: 200 }; };

test('envelope uses a stable event id and carries the issued record', () => {
  const envelope = envelopeFor({ credentialId: 'c1', subjectId: 'agent-1', issuedAt: 't', credential: {}, compactJws: 'j' });
  assert.equal(envelope.eventId, 'credential.issued:c1');
  assert.equal(envelope.eventType, 'credential.issued');
  assert.deepEqual(envelope.credential, { credentialId: 'c1', credential: {}, compactJws: 'j' });
});

test('publisher registers status, appends to the stream, then marks the credential published', async () => {
  const pool = fakePool(['c1', 'c2']);
  const added = [], calls = [];
  const redis = { isReady: true, async xAdd(stream, id, fields) { added.push({ stream, fields }); } };
  const publisher = createCredentialPublisher({ pool, redis, verificationUrl: 'http://verify', verificationKey: 'k',
    fetchImpl: okFetch(calls) });
  assert.equal(await publisher.publishPending(), 2);
  assert.deepEqual([...pool.published], ['c1', 'c2']);
  assert.equal(added.length, 2);
  assert.equal(JSON.parse(added[0].fields.envelope).credentialId, 'c1');
  assert.equal(calls[0].url, 'http://verify/status/register');
  assert.equal(calls[0].headers['x-internal-service-key'], 'k');
  assert.equal(await publisher.publishPending(), 0, 'published credentials are not sent again');
});

test('an unavailable stream leaves the credential pending for the next tick', async () => {
  const pool = fakePool(['c1']);
  const redis = { isReady: false, async xAdd() { throw new Error('unreachable'); } };
  const publisher = createCredentialPublisher({ pool, redis, fetchImpl: okFetch([]) });
  assert.equal(await publisher.publishPending(), 0);
  assert.equal(pool.published.size, 0);
  redis.isReady = true; redis.xAdd = async () => {};
  assert.equal(await publisher.publishPending(), 1);
});

test('a status registration failure blocks publication', async () => {
  const pool = fakePool(['c1']);
  const publisher = createCredentialPublisher({ pool, verificationUrl: 'http://verify',
    fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(await publisher.publishPending(), 0);
  assert.equal(pool.published.size, 0);
});
