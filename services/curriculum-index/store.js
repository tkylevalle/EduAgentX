'use strict';
const { extractChunks, sha256 } = require('./model');
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
  const snapshot = { builtAt: new Date().toISOString(), chunks, digest: sha256(chunks) };
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const temporary = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2));
  fs.renameSync(temporary, SNAPSHOT_PATH);
  return snapshot;
}

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  if (!Array.isArray(snapshot.chunks) || snapshot.digest !== sha256(snapshot.chunks))
    throw new Error('index_cache_integrity_failed');
  return snapshot;
}

// Reconcile the derived collection without deleting the last usable index
// before the replacement succeeds. Queries still verify every returned byte
// against current PostgreSQL-derived chunks.
async function rebuildIndex({ pool, client, embeddingFunction }) {
  const packages = await getActivePackages(pool);
  const chunks = packages.flatMap((pkg) => extractChunks(pkg));

  const collection = await client.getOrCreateCollection({ name: COLLECTION_NAME, embeddingFunction });
  if (chunks.length) await collection.upsert(chunksToChromaInput(chunks));
  const existing = await collection.get();
  const currentIds = new Set(chunks.map(chunk => chunk.chunkId));
  const stale = (existing.ids || []).filter(id => !currentIds.has(id));
  if (stale.length) await collection.delete({ ids: stale });

  const snapshot = saveSnapshot(chunks);
  return { chunkCount: chunks.length, builtAt: snapshot.builtAt, mode: 'rebuilt' };
}

// Query the live index when ChromaDB is reachable. If it isn't, fall back
// to a plain substring match over the last saved snapshot and say so
// explicitly via `mode` — callers must be able to tell cached results from
// live ones, never silently treat them the same.
async function queryIndex({ pool, client, embeddingFunction, text, limit = 5 }) {
  if (!pool) throw new Error('index_unavailable_active_state_unverified');
  // Re-check the authoritative active package and its current quarantine
  // scopes on every query. If Postgres is unavailable, stale content is not
  // safe to serve because a newer critical quarantine may be unknown.
  const activeChunks = (await getActivePackages(pool)).flatMap((pkg) => extractChunks(pkg));
  const currentById = new Map(activeChunks.map((chunk) => [chunk.chunkId, chunk]));
  try {
    const collection = await client.getCollection({ name: COLLECTION_NAME, embeddingFunction });
    const result = await collection.query({ queryTexts: [text], nResults: limit });
    return { mode: 'live', results: filterVectorResult(result, currentById) };
  } catch {
    const snapshot = loadSnapshot();
    if (!snapshot) throw new Error('index_unavailable_no_cache');
    const needle = text.toLowerCase();
    const matches = snapshot.chunks.filter((c) => currentById.get(c.chunkId)?.text === c.text &&
      c.digest === sha256(c.text) && c.text.toLowerCase().includes(needle)).slice(0, limit);
    return { mode: 'cached-stale', builtAt: snapshot.builtAt, results: matches };
  }
}

function filterVectorResult(result, currentById) {
  const ids = result?.ids;
  if (!Array.isArray(ids) || ids.some((row) => !Array.isArray(row))) throw new Error('index_response_invalid');
  if (!Array.isArray(result.documents) || result.documents.length !== ids.length ||
      result.documents.some((row, index) => !Array.isArray(row) || row.length !== ids[index].length))
    throw new Error('index_response_invalid');
  const keep = ids.map((row, rowIndex) => row.map((id, index) => {
    const expected = currentById.get(id);
    return expected && expected.text === result.documents[rowIndex][index] &&
      expected.digest === sha256(result.documents[rowIndex][index]) ? index : -1;
  }).filter((index) => index >= 0));
  const filtered = { ...result };
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value) && value.length === ids.length && value.every((row) => Array.isArray(row))) {
      filtered[key] = value.map((row, rowIndex) => keep[rowIndex].map((index) => row[index]));
    }
  }
  return filtered;
}
module.exports = { COLLECTION_NAME, chunksToChromaInput, saveSnapshot, loadSnapshot, rebuildIndex, queryIndex, filterVectorResult };
