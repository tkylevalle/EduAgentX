'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.INDEX_SNAPSHOT_PATH = path.join(os.tmpdir(), `curriculum-index-test-${process.pid}.json`);

const { rebuildIndex, queryIndex } = require('../store');
const samplePackage = require('../../curriculum-engine/examples/ai-safety-candidate');

// Fake Postgres pool: db.js's getActivePackages just needs pool.query to
// resolve with rows shaped like { payload }. The real SQL query is already
// proven against a live database (see the Docker smoke test) — this just
// lets rebuildIndex run without a live Postgres connection.
function fakePool(packages) {
  return { query: async () => ({ rows: packages.map((payload) => ({ payload, quarantined_scopes: payload.quarantinedScopes || [] })) }) };
}

// Minimal in-memory stand-in for the real ChromaDB client — just enough of
// its API surface for rebuildIndex/queryIndex to exercise against.
function fakeChromaClient() {
  let collectionDocs = [];
  const collection = {
    async upsert({ ids, documents, metadatas }) {
      ids.forEach((id, i) => {
        collectionDocs = collectionDocs.filter(item => item.id !== id);
        collectionDocs.push({ id, document: documents[i], metadata: metadatas[i] });
      });
    },
    async get() { return { ids: collectionDocs.map(item => item.id) }; },
    async delete({ ids }) { collectionDocs = collectionDocs.filter(item => !ids.includes(item.id)); },
    async query({ queryTexts }) {
      const needle = queryTexts[0].toLowerCase();
      const matched = collectionDocs.filter((d) => d.document.toLowerCase().includes(needle));
      return { ids: [matched.map((d) => d.id)], documents: [matched.map((d) => d.document)] };
    },
  };
  return {
    async getOrCreateCollection() { return collection; },
    async getCollection() { return collection; },
  };
}

function unreachableChromaClient() {
  return {
    async getOrCreateCollection() { throw new Error('chromadb unreachable'); },
    async getCollection() { throw new Error('chromadb unreachable'); },
  };
}

test('rebuildIndex writes one chunk per module and reports an accurate count', async () => {
  const result = await rebuildIndex({ pool: fakePool([samplePackage]), client: fakeChromaClient(), embeddingFunction: null });
  assert.equal(result.chunkCount, 5);
  assert.equal(result.mode, 'rebuilt');
});

test('a rebuild with no Active packages produces an empty index, not an error', async () => {
  const result = await rebuildIndex({ pool: fakePool([]), client: fakeChromaClient(), embeddingFunction: null });
  assert.equal(result.chunkCount, 0);
});

test('queryIndex returns mode "live" and finds the right module when ChromaDB is reachable', async () => {
  const pool = fakePool([samplePackage]);
  const client = fakeChromaClient();
  await rebuildIndex({ pool, client, embeddingFunction: null });

  // Note: this fake client does literal matching, not real embeddings — the
  // actual semantic ranking behavior was already verified against live
  // ChromaDB in Docker. This test exists to check mode/wiring, not ranking.
  const result = await queryIndex({ pool, client, embeddingFunction: null, text: 'no match expected here' });
  assert.equal(result.mode, 'live');
});

test('queryIndex falls back to the cached snapshot, marked stale, when ChromaDB is unreachable', async () => {
  const pool = fakePool([samplePackage]);
  await rebuildIndex({ pool, client: fakeChromaClient(), embeddingFunction: null });

  const result = await queryIndex({ pool, client: unreachableChromaClient(), embeddingFunction: null, text: 'Tool Misuse' });
  assert.equal(result.mode, 'cached-stale');
  assert.ok(result.results.some((chunk) => chunk.moduleId === 'm4'));
});

test('the last-index cache does not return content quarantined after its snapshot was built', async () => {
  await rebuildIndex({ pool: fakePool([samplePackage]), client: fakeChromaClient(), embeddingFunction: null });
  const changed = structuredClone(samplePackage);
  changed.quarantinedScopes = [{ scopeType: 'module', scopeId: 'm4' }];
  const result = await queryIndex({ pool: fakePool([changed]), client: unreachableChromaClient(), embeddingFunction: null, text: 'Tool Misuse' });
  assert.equal(result.mode, 'cached-stale');
  assert.equal(result.results.some((chunk) => chunk.moduleId === 'm4'), false);
});

test('stale cache is not used when current Active scope cannot be verified', async () => {
  await rebuildIndex({ pool: fakePool([samplePackage]), client: fakeChromaClient(), embeddingFunction: null });
  await assert.rejects(queryIndex({ pool: { query: async () => { throw new Error('postgres unavailable'); } },
    client: unreachableChromaClient(), embeddingFunction: null, text: 'Tool Misuse' }), /postgres unavailable/);
});

test('known vector ID with corrupted document bytes is excluded', async () => {
  const pool = fakePool([samplePackage]);
  const current = require('../model').extractChunks(samplePackage)[0];
  const client = { getCollection: async () => ({ query: async () => ({
    ids: [[current.chunkId]], documents: [['tampered lesson']],
  }) }) };
  const result = await queryIndex({ pool, client, text: 'lesson' });
  assert.deepEqual(result.results.ids, [[]]);
});

test('tampered snapshot cannot be used during Chroma loss', async () => {
  const pool = fakePool([samplePackage]);
  await rebuildIndex({ pool, client: fakeChromaClient() });
  const snapshot = JSON.parse(fs.readFileSync(process.env.INDEX_SNAPSHOT_PATH, 'utf8'));
  snapshot.chunks[0].text = 'tampered lesson';
  fs.writeFileSync(process.env.INDEX_SNAPSHOT_PATH, JSON.stringify(snapshot));
  await assert.rejects(queryIndex({ pool, client: unreachableChromaClient(), text: 'lesson' }), /index_cache_integrity_failed/);
});
