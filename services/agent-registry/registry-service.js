const { randomUUID } = require('node:crypto');

const telemetry = require('../../packages/telemetry');
const {
  computeConfigurationFingerprint,
  isUuid,
  validateRegistrationRequest,
} = require('./domain');
const { RegistryError } = require('./errors');

function createRegistryService({
  repository,
  eventPublisher = { publish: async () => {} },
  correlationIdGenerator = randomUUID,
}) {
  if (!repository || typeof repository.register !== 'function') {
    throw new TypeError('A registry repository is required');
  }

  // The event is already committed to the outbox. Publishing now only makes
  // delivery faster; the stream worker retries anything this call misses.
  async function notifyEventPublisher(assurance) {
    try {
      await eventPublisher.publish(assurance);
    } catch {
      telemetry.log('agent-registry', 'publication_pending', { correlationId: assurance.correlationId });
    }
  }

  async function register(input, options = {}) {
    const validation = validateRegistrationRequest(input);
    const correlationId = options.correlationId || correlationIdGenerator();
    if (!validation.valid) {
      throw new RegistryError(400, 'invalid_request', 'Registration request is invalid', validation.errors);
    }

    const normalized = validation.value;
    const { replayed, ...result } = await repository.register({
      ...normalized,
      configurationFingerprint: computeConfigurationFingerprint(normalized),
      correlationId,
      requestKey: options.requestKey,
      requestFingerprint: options.requestFingerprint,
      messageId: options.messageId,
    });
    // A replay returns the stored response; its event was published before.
    if (!replayed) await notifyEventPublisher(result.assurance);
    return result;
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
    if (typeof repository.health === 'function') return await repository.health();
  }

  return { getById, getByKey, getLatestTrace, health, register,
    deliveryStatus: () => repository.deliveryStatus() };
}

module.exports = { RegistryError, createRegistryService };
