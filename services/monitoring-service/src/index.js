'use strict';

// Starts the monitoring service. With DATABASE_URL the incident log and
// runtime manifests are durable; without it (tests, a bare local run) they
// live in memory and the health route says so in the startup log.

const { Pool } = require('pg');
const { createApp, createCredentialStatusClient } = require('./app');
const { createMemoryStore, createPgStore } = require('./incidents');

async function main() {
  const store = process.env.DATABASE_URL ? createPgStore(new Pool({ connectionString: process.env.DATABASE_URL })) : createMemoryStore();
  if (store.init) await store.init();
  const credentialStatus = process.env.CREDENTIAL_VERIFICATION_URL && process.env.CREDENTIAL_INTERNAL_KEY
    ? createCredentialStatusClient({ url: process.env.CREDENTIAL_VERIFICATION_URL, key: process.env.CREDENTIAL_INTERNAL_KEY }) : undefined;
  const app = createApp({ store, internalKey: process.env.MONITORING_INTERNAL_KEY, credentialStatus });
  const port = process.env.PORT || 4040;
  app.listen(port, () => console.log(`[monitoring-service] listening on ${port}; incident log ${process.env.DATABASE_URL ? 'durable' : 'in memory'}`));
}

main().catch((error) => { console.error(`[monitoring-service] failed to start: ${error.message}`); process.exit(1); });
