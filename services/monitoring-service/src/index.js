'use strict';

// Starts the monitoring service. With DATABASE_URL the incident log and
// runtime manifests are durable; without it (a bare local run) they live in
// memory and the startup log says so. Both keys are required: without them no
// service could append an incident and no person could read one.

const { Pool } = require('pg');
const telemetry = require('../../../packages/telemetry');
const { createApp, createCredentialStatusClient } = require('./app');
const { createMemoryStore, createPgStore } = require('./incidents');

// The silence sweep runs every five minutes; an incident appears within that of the window closing.
const SILENCE_SWEEP_MS = 5 * 60 * 1000;

// An idle client that loses its connection (a Postgres restart) emits 'error'
// on the pool; unheard, that event ends the process. The pool replaces the
// client on the next query, so logging is enough.
function createPool(connectionString) {
  const pool = new Pool({ connectionString });
  pool.on('error', (error) => telemetry.log('monitoring-service', 'postgres_connection_error', { outcome: String(error.code || error.name) }));
  return pool;
}

async function main() {
  for (const name of ['MONITORING_INTERNAL_KEY', 'MONITORING_GATEWAY_KEY']) {
    if (!process.env[name]) throw new Error(`${name} is required: run node scripts/setup-dev.js`);
  }
  const store = process.env.DATABASE_URL ? createPgStore(createPool(process.env.DATABASE_URL)) : createMemoryStore();
  if (store.init) await store.init();
  const credentialStatus = process.env.CREDENTIAL_VERIFICATION_URL && process.env.CREDENTIAL_INTERNAL_KEY
    ? createCredentialStatusClient({ url: process.env.CREDENTIAL_VERIFICATION_URL, key: process.env.CREDENTIAL_INTERNAL_KEY }) : undefined;
  const app = createApp({ store, credentialStatus, internalKey: process.env.MONITORING_INTERNAL_KEY, gatewayKey: process.env.MONITORING_GATEWAY_KEY,
    silenceMs: Number(process.env.RUNTIME_SILENCE_MS) || undefined });
  const port = process.env.PORT || 4040;
  app.listen(port, () => console.log(`[monitoring-service] listening on ${port}; incident log ${process.env.DATABASE_URL ? 'durable' : 'in memory'}`));
  setInterval(() => app.locals.sweepSilence().catch((error) =>
    telemetry.log('monitoring-service', 'silence_sweep_failed', { outcome: String(error.code || error.name) })), SILENCE_SWEEP_MS).unref();
}

main().catch((error) => { console.error(`[monitoring-service] failed to start: ${error.message}`); process.exit(1); });
