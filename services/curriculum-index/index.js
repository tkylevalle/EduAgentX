'use strict';

const express = require('express');
const { Pool } = require('pg');
const { ChromaClient } = require('chromadb');
const { DefaultEmbeddingFunction } = require('@chroma-core/default-embed');
const { rebuildIndex, queryIndex } = require('./store');

function createApp({ pool, client, embeddingFunction, internalKey = process.env.CURRICULUM_INTERNAL_KEY } = {}) {
  if (!pool || !client || !embeddingFunction || !internalKey) throw new Error('database, chroma client, embedding function, and internal key required');
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'curriculum-index' });
    } catch {
      res.status(503).json({ status: 'unhealthy', service: 'curriculum-index' });
    }
  });

  app.use('/internal/index', (req, res, next) => {
    if (req.header('x-internal-service-key') !== internalKey) return res.status(403).json({ error: 'forbidden' });
    next();
  });

  app.post('/internal/index/rebuild', async (req, res) => {
    try {
      const result = await rebuildIndex({ pool, client, embeddingFunction });
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'rebuild_failed', message: error.message });
    }
  });

  app.get('/internal/index/query', async (req, res) => {
    if (!req.query.text) return res.status(400).json({ error: 'text_required' });
    try {
      const result = await queryIndex({ client, embeddingFunction, text: req.query.text, limit: Number(req.query.limit) || 5 });
      res.json(result);
    } catch (error) {
      res.status(503).json({ error: 'query_failed', message: error.message });
    }
  });

  return app;
}

async function start() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Idle clients emit 'error' when Postgres restarts; an unhandled event would stop the process.
  pool.on('error', (error) => console.error('curriculum-index postgres connection error', error.code || error.name));
  const client = new ChromaClient({
    host: process.env.CHROMADB_HOST || 'chromadb',
    port: Number(process.env.CHROMADB_PORT) || 8000,
    ssl: false,
  });
  const embeddingFunction = new DefaultEmbeddingFunction();
  const app = createApp({ pool, client, embeddingFunction });

  try {
    const result = await rebuildIndex({ pool, client, embeddingFunction });
    console.log(`[curriculum-index] startup rebuild complete: ${result.chunkCount} chunks`);
  } catch (error) {
    console.error('[curriculum-index] startup rebuild failed, will serve from cache if available:', error.message);
  }

  app.listen(process.env.PORT || 4003);
}

if (require.main === module) start().catch((error) => {
  console.error('curriculum-index startup failed', error.code || error.name);
  process.exitCode = 1;
});

module.exports = { createApp };