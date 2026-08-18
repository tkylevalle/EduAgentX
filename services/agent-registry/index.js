// agent-registry (Sprint 1)
//
// Stub only. Real registry logic (fingerprint rules, validation, the
// full domain model) is #4. Real idempotency semantics on the redis
// stream side are #6. This just needs to insert something, dedupe on
// fingerprint, and return a response we can correlate - enough to
// prove the compose stack actually works together.

const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 4001;
const SERVICE_NAME = process.env.SERVICE_NAME || 'agent-registry';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error(`[${SERVICE_NAME}] redis error`, err));

let redisReady = false;

async function init() {
  await redisClient.connect();
  redisReady = true;

  // just enough schema for the smoke path - #4/#6 own the real migrations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_registry.registrations (
      id UUID PRIMARY KEY,
      fingerprint TEXT UNIQUE NOT NULL,
      payload JSONB NOT NULL,
      correlation_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!redisReady) throw new Error('redis not ready');
    res.status(200).json({ status: 'ok', service: SERVICE_NAME });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, error: err.message });
  }
});

app.post('/internal/registrations', async (req, res) => {
  const correlationId = req.header('x-correlation-id') || randomUUID();
  const { fingerprint, payload } = req.body || {};

  if (!fingerprint || typeof fingerprint !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'fingerprint is required',
      correlationId,
    });
  }

  try {
    // dedupe on fingerprint - if it exists already just hand back the
    // existing row instead of erroring, that's our "idempotent retry"
    const existing = await pool.query(
      'SELECT id, fingerprint, payload, created_at FROM agent_registry.registrations WHERE fingerprint = $1',
      [fingerprint]
    );

    let record;
    let isNew = false;

    if (existing.rows.length > 0) {
      record = existing.rows[0];
    } else {
      const id = randomUUID();
      const inserted = await pool.query(
        `INSERT INTO agent_registry.registrations (id, fingerprint, payload, correlation_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, fingerprint, payload, created_at`,
        [id, fingerprint, payload || {}, correlationId]
      );
      record = inserted.rows[0];
      isNew = true;

      await redisClient.xAdd('agent-registry.registrations', '*', {
        type: 'registration.created',
        id: record.id,
        fingerprint: record.fingerprint,
        correlationId,
      });
    }

    res.status(isNew ? 201 : 200).json({
      status: isNew ? 'created' : 'already_registered',
      registration: {
        id: record.id,
        fingerprint: record.fingerprint,
        createdAt: record.created_at,
      },
      correlationId,
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] registration error`, err);
    res.status(500).json({ error: 'internal_error', correlationId });
  }
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(`[${SERVICE_NAME}] failed to start`, err);
    process.exit(1);
  });
