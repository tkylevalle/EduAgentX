'use strict';
// Shared by the Training Postgres tests: each applies schema.sql, and node --test
// runs files in parallel, where concurrent DDL on the same tables can deadlock.
// The advisory lock makes them take turns.

// Any fixed id; it only has to be the same in every file that applies the schema.
const SCHEMA_LOCK_ID = 435200;

/** @param {import('pg').Pool} pool @param {string} schema the schema.sql text */
async function applySchema(pool, schema) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
    try { await client.query(schema); } finally { await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]); }
  } finally {
    client.release();
  }
}

module.exports = { applySchema };
