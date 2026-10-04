'use strict';
const { ChromaClient } = require('chromadb');
const { extractChunks } = require('./model');
const { getActivePackages } = require('./db');
const fs = require('node:fs');
const path = require('node:path');

const COLLECTION_NAME = 'curriculum-chunks';
const SNAPSHOT_PATH = process.env.INDEX_SNAPSHOT_PATH || path.join(__dirname, 'data', 'last-index-snapshot.json');

// ChromaDB metadata values must be plain strings/numbers/booleans, not
// arrays, so objectiveIds gets flattened to a comma-joined string here.
function chunksToChromaInput(chunks) {
  return {
    ids: chunks.map((c) => c.chunkId),
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((c) => ({
      packageId: c.packageId,
      version: c.version,
      domain: c.domain,
      moduleId: c.moduleId,
      objectiveIds: c.objectiveIds.join(','),
      digest: c.digest,
    })),
  };
}

// Written after every successful rebuild. This is the "last validated
// cache" the service falls back to if ChromaDB itself becomes unreachable —
// note it never gets consulted for activation decisions, only for serving
// previously-indexed content during degraded mode.
function saveSnapshot(chunks) {
  const snapshot = { builtAt: new Date().toISOString(), chunks };
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
}

// Full rebuild: read every Active package straight from Postgres, re-derive
// all chunks from scratch, and replace the entire ChromaDB collection.
// Deliberately a full wipe-and-reinsert rather than an incremental diff —
// simpler to reason about and test, and cheap enough at this package count
// to run on every startup and on demand.
async function rebuildIndex({ pool, client, embeddingFunction }) {
  const packages = await getActivePackages(pool);
  const chunks = packages.flatMap((pkg) => extractChunks(pkg));

  await client.deleteCollection({ name: COLLECTION_NAME }).catch(() => {});
  const collection = await client.createCollection({ name: COLLECTION_NAME, embeddingFunction });
  if (chunks.length) await collection.add(chunksToChromaInput(chunks));

  const snapshot = saveSnapshot(chunks);
  return { chunkCount: chunks.length, builtAt: snapshot.builtAt, mode: 'rebuilt' };
}

// Query the live index when ChromaDB is reachable. If it isn't, fall back
// to a plain substring match over the last saved snapshot and say so
// explicitly via `mode` — callers must be able to tell cached results from
// live ones, never silently treat them the same.
async function queryIndex({ client, embeddingFunction, text, limit = 5 }) {
  try {
    const collection = await client.getCollection({ name: COLLECTION_NAME, embeddingFunction });
    const result = await collection.query({ queryTexts: [text], nResults: limit });
    return { mode: 'live', results: result };
  } catch {
    const snapshot = loadSnapshot();
    if (!snapshot) throw new Error('index_unavailable_no_cache');
    const needle = text.toLowerCase();
    const matches = snapshot.chunks.filter((c) => c.text.toLowerCase().includes(needle)).slice(0, limit);
    return { mode: 'cached-stale', builtAt: snapshot.builtAt, results: matches };
  }
}
module.exports = { COLLECTION_NAME, chunksToChromaInput, saveSnapshot, loadSnapshot, rebuildIndex, queryIndex };