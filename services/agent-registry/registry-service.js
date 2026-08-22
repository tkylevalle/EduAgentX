const { randomUUID } = require('node:crypto');

const {
  computeConfigurationFingerprint,
  isUuid,
  validateRegistrationRequest,
} = require('./domain');

class RegistryError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'RegistryError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function createRegistryService({
  repository,
  eventPublisher = { publish: async () => {} },
  correlationIdGenerator = randomUUID,
}) {
  if (!repository || typeof repository.register !== 'function') {
    throw new TypeError('A registry repository is required');
  }

  async function publishAssuranceEvent(result) {
    if (!result.assurance || typeof eventPublisher.publish !== 'function') return 'not_configured';
    try {
      await eventPublisher.publish(result.assurance);
      return 'published';
    } catch (error) {
      // PostgreSQL has already committed the append-only assurance event. A
      // later stream consumer can reconcile the durable event without making
      // the caller retry a mutation that already succeeded.
      console.error('[agent-registry] assurance event publication failed', error);
      return 'pending';
    }
  }

  async function register(input, options = {}) {
    const validation = validateRegistrationRequest(input);
    const correlationId = options.correlationId || correlationIdGenerator();
    if (!validation.valid) {
      throw new RegistryError(400, 'invalid_request', 'Registration request is invalid', validation.errors);
    }

    const normalized = validation.value;
    const result = await repository.register({
      ...normalized,
      configurationFingerprint: computeConfigurationFingerprint(normalized),
      correlationId,
    });
    const publicationStatus = await publishAssuranceEvent(result);

    return {
      ...result,
      httpStatus: result.outcome === 'registered' ? 201 : 200,
      status: result.outcome === 'registered'
        ? 'created'
        : result.outcome === 'unchanged'
          ? 'already_registered'
          : 'updated',
      assurance: result.assurance
        ? { ...result.assurance, publicationStatus }
        : result.assurance,
      correlationId,
    };
  }

  async function getById(agentLearnerId, options = {}) {
    const correlationId = options.correlationId || correlationIdGenerator();
    if (!isUuid(agentLearnerId)) {
      throw new RegistryError(400, 'invalid_agent_learner_id', 'agentLearnerId must be a UUID');
    }
    const registration = await repository.getById(agentLearnerId);
    if (!registration) {
      throw new RegistryError(404, 'not_found', 'Agent Learner was not found');
    }
    return { registration, correlationId };
  }

  async function getByKey(agentLearnerKey, options = {}) {
    const correlationId = options.correlationId || correlationIdGenerator();
    if (typeof agentLearnerKey !== 'string' || !agentLearnerKey.trim()) {
      throw new RegistryError(400, 'invalid_agent_learner_key', 'agentLearnerKey is required');
    }
    const registration = await repository.getByKey(agentLearnerKey.trim());
    if (!registration) {
      throw new RegistryError(404, 'not_found', 'Agent Learner was not found');
    }
    return { registration, correlationId };
  }

  async function getLatestTrace(options = {}) {
    const correlationId = options.correlationId || correlationIdGenerator();
    const trace = await repository.getLatestTrace();
    if (!trace) throw new RegistryError(404, 'not_found', 'No registration assurance evidence exists');
    return { trace, correlationId };
  }

  async function health() {
    if (typeof repository.health === 'function') await repository.health();
  }

  return { getById, getByKey, getLatestTrace, health, register };
}

module.exports = { RegistryError, createRegistryService };
