const telemetry = require('./telemetry');
const { checkDependencies, bounded } = require('./dependency-health');
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 2000 });
pool.on('error', () => telemetry.log(SERVICE_NAME, 'postgres_connection_error'));
const redisClient = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, socket: { connectTimeout: 2000 } });
redisClient.on('error', (error) => telemetry.log(SERVICE_NAME, 'redis_connection_error'));

let redisReady = false;

async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await redisClient.connect();
  redisReady = true;

  const postgresRepository = new PostgresRegistryRepository({ pool });
  const repository = {};
  for (const method of ['register', 'getById', 'getByKey', 'getLatestTrace']) {
    repository[method] = (...args) => telemetry.observe(SERVICE_NAME, 'postgres', method,
      () => postgresRepository[method](...args));
  }
  repository.health = () => checkDependencies(postgresRepository, redisClient);
  const eventPublisher = {
    publish: (event) => telemetry.observe(SERVICE_NAME, 'redis', 'xadd', () => bounded(() => redisClient.xAdd(EVENT_STREAM, '*', {
      eventType: event.eventType,
      eventId: event.eventId,
      agentLearnerId: event.agentLearnerId,
      configurationVersion: String(event.configurationVersion),
      fingerprint: event.configurationFingerprint,
      previousFingerprint: event.previousFingerprint || '',
      correlationId: event.correlationId,
      occurredAt: event.occurredAt,
    })), event.correlationId),
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
    telemetry.log(SERVICE_NAME, 'startup_failed');
    process.exit(1);
  });
}

module.exports = { start };
