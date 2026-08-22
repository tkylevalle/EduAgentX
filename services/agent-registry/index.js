const fs = require('node:fs');
const path = require('node:path');

const { Pool } = require('pg');
const { createClient } = require('redis');

const { createApp } = require('./app');
const { PostgresRegistryRepository } = require('./postgres-repository');
const { createRegistryService } = require('./registry-service');

const PORT = Number(process.env.PORT || 4001);
const SERVICE_NAME = process.env.SERVICE_NAME || 'agent-registry';
const EVENT_STREAM = process.env.AGENT_REGISTRY_EVENT_STREAM || 'agent-registry.assurance';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (error) => console.error(`[${SERVICE_NAME}] redis error`, error));

let redisReady = false;

async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await redisClient.connect();
  redisReady = true;

  const postgresRepository = new PostgresRegistryRepository({ pool });
  const repository = {
    register: postgresRepository.register.bind(postgresRepository),
    getById: postgresRepository.getById.bind(postgresRepository),
    getByKey: postgresRepository.getByKey.bind(postgresRepository),
    getLatestTrace: postgresRepository.getLatestTrace.bind(postgresRepository),
    health: async () => {
      await postgresRepository.health();
      if (!redisReady) throw new Error('redis not ready');
    },
  };
  const eventPublisher = {
    publish: (event) => redisClient.xAdd(EVENT_STREAM, '*', {
      eventType: event.eventType,
      eventId: event.eventId,
      agentLearnerId: event.agentLearnerId,
      configurationVersion: String(event.configurationVersion),
      fingerprint: event.configurationFingerprint,
      previousFingerprint: event.previousFingerprint || '',
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
    }),
  };
  const service = createRegistryService({ repository, eventPublisher });
  const app = createApp({ service });
  const server = app.listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });

  const shutdown = async () => {
    server.close();
    if (redisReady) await redisClient.quit().catch(() => {});
    await pool.end().catch(() => {});
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { app, server, pool, redisClient, service };
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[${SERVICE_NAME}] failed to start`, error);
    process.exit(1);
  });
}

module.exports = { start };
