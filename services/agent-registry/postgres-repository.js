const { randomUUID } = require('node:crypto');

const { registrationResult } = require('./domain');
const { RegistryError } = require('./errors');

const EVENT_REGISTERED = 'agent_learner.registered';
const EVENT_REPLAYED = 'agent_learner.registration_replayed';
const EVENT_CHANGED = 'agent_learner.configuration_changed';
const LEARNER_COLUMNS = `id, agent_learner_key, status, configuration_version,
                         current_fingerprint, created_at, updated_at`;

class PostgresRegistryRepository {
  constructor({ pool, idGenerator = randomUUID }) {
    if (!pool) throw new TypeError('A PostgreSQL pool is required');
    this.pool = pool;
    this.idGenerator = idGenerator;
  }

  async health() {
    await this.pool.query('SELECT 1');
  }

  async register(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Serialize by identity before checking the durable request key or mutating state.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.agentLearnerKey]);
      if (input.requestKey) {
        const existing = await client.query(
          'SELECT fingerprint, result FROM agent_registry.registration_requests WHERE subject=$1 AND request_key=$2',
          [input.agentLearnerKey, input.requestKey]);
        if (existing.rows[0]) {
          if (existing.rows[0].fingerprint !== input.requestFingerprint) {
            throw new RegistryError(409, 'idempotency_conflict', 'Request key was already used for different content');
          }
          await client.query('COMMIT');
          return { ...existing.rows[0].result, replayed: true };
        }
      }

      const learnerInsert = await client.query(
        `INSERT INTO agent_registry.agent_learners
           (id, agent_learner_key, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (agent_learner_key) DO NOTHING
         RETURNING ${LEARNER_COLUMNS}`,
        [this.idGenerator(), input.agentLearnerKey]
      );
      const learner = learnerInsert.rows[0] || (await this.findLearnerForUpdate(client, input.agentLearnerKey));
      const current = await this.findCurrentConfiguration(client, learner.id);

      if (current && current.fingerprint === input.configurationFingerprint) {
        const event = await this.insertEvent(client, {
          learnerId: learner.id,
          configurationId: current.id,
          eventType: EVENT_REPLAYED,
          configurationVersion: current.configuration_version,
          fingerprint: current.fingerprint,
          previousFingerprint: null,
          correlationId: input.correlationId,
          input,
        });
        const registration = await this.loadRegistration(client, learner.id, event);
        return await this.commitRegistration(client, input, { outcome: 'unchanged', registration, assurance: mapAssurance(event) });
      }

      const configurationVersion = (current?.configuration_version || 0) + 1;
      const configurationId = this.idGenerator();
      await client.query(
        `INSERT INTO agent_registry.agent_configurations
           (id, agent_learner_id, configuration_version, fingerprint,
            model_provider, model_version, system_prompt_hash,
            approved_tool_manifest, policy_configuration_hash, adapter_version,
            correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          configurationId,
          learner.id,
          configurationVersion,
          input.configurationFingerprint,
          input.model.provider,
          input.model.version,
          input.systemPromptHash,
          JSON.stringify(input.approvedToolManifest),
          input.policyConfigurationHash,
          input.adapterVersion,
          input.correlationId,
        ]
      );
      const updatedLearnerResult = await client.query(
        `UPDATE agent_registry.agent_learners
         SET configuration_version = $2,
             current_fingerprint = $3,
             updated_at = now()
         WHERE id = $1
         RETURNING ${LEARNER_COLUMNS}`,
        [learner.id, configurationVersion, input.configurationFingerprint]
      );
      const updatedLearner = updatedLearnerResult.rows[0];
      const event = await this.insertEvent(client, {
        learnerId: learner.id,
        configurationId,
        eventType: configurationVersion === 1 ? EVENT_REGISTERED : EVENT_CHANGED,
        configurationVersion,
        fingerprint: input.configurationFingerprint,
        previousFingerprint: current?.fingerprint || null,
        correlationId: input.correlationId,
        input,
      });

      const registration = await this.loadRegistration(client, updatedLearner.id, event);
      return await this.commitRegistration(client, input, {
        outcome: configurationVersion === 1 ? 'registered' : 'configuration_changed',
        registration,
        assurance: mapAssurance(event),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async commitRegistration(client, input, result) {
    result = registrationResult({ ...result, correlationId: input.correlationId });
    if (input.requestKey) {
      await client.query(`INSERT INTO agent_registry.registration_requests (subject, request_key, fingerprint, result)
        VALUES ($1,$2,$3,$4::jsonb)`,
      [input.agentLearnerKey, input.requestKey, input.requestFingerprint, JSON.stringify(result)]);
    }
    await client.query('COMMIT');
    return result;
  }

  async deliveryStatus() {
    const result = await this.pool.query(`SELECT
      (SELECT count(*)::integer FROM agent_registry.event_outbox) AS total,
      (SELECT count(*)::integer FROM agent_registry.event_outbox WHERE published_at IS NULL) AS pending,
      (SELECT count(*)::integer FROM agent_registry.event_outbox WHERE published_at IS NULL AND attempts>=3) AS exhausted,
      (SELECT count(*)::integer FROM agent_registry.event_inbox WHERE status='applied') AS applied,
      (SELECT count(*)::integer FROM agent_registry.event_inbox WHERE status='waiting') AS waiting,
      (SELECT count(*)::integer FROM agent_registry.event_inbox WHERE status='quarantined') AS quarantined`);
    return result.rows[0];
  }

  async getById(agentLearnerId) {
    return this.loadRegistrationByQuery(
      `SELECT ${LEARNER_COLUMNS}
       FROM agent_registry.agent_learners
       WHERE id = $1`,
      [agentLearnerId]
    );
  }

  async getByKey(agentLearnerKey) {
    return this.loadRegistrationByQuery(
      `SELECT ${LEARNER_COLUMNS}
       FROM agent_registry.agent_learners
       WHERE agent_learner_key = $1`,
      [agentLearnerKey]
    );
  }

  async getLatestTrace() {
    return this.readSnapshot(async (client) => {
      const result = await client.query(`SELECT id, agent_learner_id, configuration_id, event_type,
        configuration_version, fingerprint, previous_fingerprint, correlation_id, payload, occurred_at
        FROM agent_registry.assurance_events ORDER BY occurred_at DESC, id DESC LIMIT 1`);
      const event = result.rows[0];
      if (!event) return null;
      const registration = await this.loadRegistration(client, event.agent_learner_id, event);
      return { outcome: outcomeForEvent(event.event_type), registration, assurance: mapAssurance(event) };
    });
  }

  async findLearnerForUpdate(client, agentLearnerKey) {
    const result = await client.query(
      `SELECT ${LEARNER_COLUMNS}
       FROM agent_registry.agent_learners
       WHERE agent_learner_key = $1
       FOR UPDATE`,
      [agentLearnerKey]
    );
    return result.rows[0];
  }

  async findCurrentConfiguration(client, learnerId) {
    const result = await client.query(
      `SELECT id, agent_learner_id, configuration_version, fingerprint,
              model_provider, model_version, system_prompt_hash,
              approved_tool_manifest, policy_configuration_hash,
              adapter_version, correlation_id, created_at
       FROM agent_registry.agent_configurations
       WHERE agent_learner_id = $1
       ORDER BY configuration_version DESC
       LIMIT 1
       FOR UPDATE`,
      [learnerId]
    );
    return result.rows[0];
  }

  async insertEvent(client, event) {
    const result = await client.query(
      `INSERT INTO agent_registry.assurance_events
         (id, agent_learner_id, configuration_id, event_type,
          configuration_version, fingerprint, previous_fingerprint,
          correlation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id, agent_learner_id, configuration_id, event_type,
                 configuration_version, fingerprint, previous_fingerprint,
                 correlation_id, payload, occurred_at`,
      [
        this.idGenerator(),
        event.learnerId,
        event.configurationId,
        event.eventType,
        event.configurationVersion,
        event.fingerprint,
        event.previousFingerprint,
        event.correlationId,
        JSON.stringify(eventPayload(event.input)),
      ]
    );
    const row = result.rows[0];
    const sequenceResult = await client.query(
      'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM agent_registry.event_outbox WHERE aggregate_id=$1',
      [event.learnerId]);
    const envelope = {
      schemaVersion: '1.0.0', ...mapAssurance(row), aggregateId: event.learnerId,
      sequence: sequenceResult.rows[0].sequence, causationId: event.input.messageId || event.correlationId,
    };
    await client.query(`INSERT INTO agent_registry.event_outbox (event_id, aggregate_id, sequence, envelope)
      VALUES ($1,$2,$3,$4::jsonb)`, [row.id, event.learnerId, envelope.sequence, JSON.stringify(envelope)]);
    return row;
  }

  async loadRegistrationByQuery(query, values) {
    return this.readSnapshot(async (client) => {
      const learner = (await client.query(query, values)).rows[0];
      return learner ? await this.loadRegistration(client, learner.id) : null;
    });
  }

  async readSnapshot(read) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async loadRegistration(clientOrPool, learnerId, latestEvent) {
    const [configurationResult, eventResult] = await Promise.all([
      clientOrPool.query(
        `SELECT id, agent_learner_id, configuration_version, fingerprint,
                model_provider, model_version, system_prompt_hash,
                approved_tool_manifest, policy_configuration_hash,
                adapter_version, correlation_id, created_at
         FROM agent_registry.agent_configurations
         WHERE agent_learner_id = $1
         ORDER BY configuration_version DESC`,
        [learnerId]
      ),
      latestEvent
        ? Promise.resolve({ rows: [latestEvent] })
        : clientOrPool.query(
          `SELECT id, agent_learner_id, configuration_id, event_type,
                  configuration_version, fingerprint, previous_fingerprint,
                  correlation_id, payload, occurred_at
           FROM agent_registry.assurance_events
           WHERE agent_learner_id = $1
           ORDER BY occurred_at DESC, id DESC
           LIMIT 1`,
          [learnerId]
        ),
    ]);

    const learnerResult = await clientOrPool.query(
      `SELECT ${LEARNER_COLUMNS}
       FROM agent_registry.agent_learners
       WHERE id = $1`,
      [learnerId]
    );
    const learner = learnerResult.rows[0];
    if (!learner) return null;
    const configurations = configurationResult.rows.map(mapConfiguration);
    return mapRegistration(learner, configurations, eventResult.rows[0]);
  }
}

function eventPayload(input) {
  return {
    agentLearnerKey: input.agentLearnerKey,
    model: input.model,
    systemPromptHash: input.systemPromptHash,
    approvedToolManifest: input.approvedToolManifest,
    policyConfigurationHash: input.policyConfigurationHash,
    adapterVersion: input.adapterVersion,
    configurationFingerprint: input.configurationFingerprint,
  };
}

function mapConfiguration(row) {
  return {
    id: row.id,
    configurationVersion: row.configuration_version,
    configurationFingerprint: row.fingerprint,
    model: { provider: row.model_provider, version: row.model_version },
    systemPromptHash: row.system_prompt_hash,
    approvedToolManifest: row.approved_tool_manifest,
    policyConfigurationHash: row.policy_configuration_hash,
    adapterVersion: row.adapter_version,
    correlationId: row.correlation_id,
    createdAt: asIso(row.created_at),
  };
}

function mapAssurance(row) {
  return {
    eventId: row.id,
    eventType: row.event_type,
    agentLearnerId: row.agent_learner_id,
    configurationVersion: row.configuration_version,
    configurationFingerprint: row.fingerprint,
    previousFingerprint: row.previous_fingerprint || null,
    correlationId: row.correlation_id,
    occurredAt: asIso(row.occurred_at),
  };
}

function mapRegistration(learner, configurations, latestEvent) {
  return {
    agentLearnerId: learner.id,
    agentLearnerKey: learner.agent_learner_key,
    status: learner.status,
    configurationVersion: learner.configuration_version,
    configurationFingerprint: learner.current_fingerprint,
    createdAt: asIso(learner.created_at),
    updatedAt: asIso(learner.updated_at),
    currentConfiguration: configurations[0] || null,
    configurations,
    latestAssurance: latestEvent ? mapAssurance(latestEvent) : null,
  };
}

function outcomeForEvent(eventType) {
  if (eventType === EVENT_REGISTERED) return 'registered';
  if (eventType === EVENT_REPLAYED) return 'unchanged';
  return 'configuration_changed';
}

function asIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = {
  EVENT_CHANGED,
  EVENT_REGISTERED,
  EVENT_REPLAYED,
  PostgresRegistryRepository,
  eventPayload,
  mapAssurance,
  mapConfiguration,
  mapRegistration,
  outcomeForEvent,
};
