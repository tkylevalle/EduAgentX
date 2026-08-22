const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { createRegistryService } = require('../registry-service');

class InMemoryRegistry {
  constructor() {
    this.learners = new Map();
    this.events = [];
    this.nextId = 1;
  }

  async register(input) {
    let learner = this.learners.get(input.agentLearnerKey);
    const now = new Date().toISOString();

    if (!learner) {
      learner = {
        agentLearnerId: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`,
        agentLearnerKey: input.agentLearnerKey,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        configurations: [],
      };
      this.learners.set(input.agentLearnerKey, learner);
    }

    const current = learner.configurations.at(-1);
    if (current && current.configurationFingerprint === input.configurationFingerprint) {
      const event = this.addEvent(learner, 'agent_learner.registration_replayed', current, input);
      return this.result('unchanged', learner, current, event);
    }

    const configuration = {
      configurationVersion: learner.configurations.length + 1,
      configurationFingerprint: input.configurationFingerprint,
      model: input.model,
      systemPromptHash: input.systemPromptHash,
      approvedToolManifest: input.approvedToolManifest,
      policyConfigurationHash: input.policyConfigurationHash,
      adapterVersion: input.adapterVersion,
      createdAt: now,
      correlationId: input.correlationId,
    };
    learner.configurations.push(configuration);
    learner.updatedAt = now;
    const eventType = configuration.configurationVersion === 1
      ? 'agent_learner.registered'
      : 'agent_learner.configuration_changed';
    const event = this.addEvent(learner, eventType, configuration, input, current);
    return this.result(
      configuration.configurationVersion === 1 ? 'registered' : 'configuration_changed',
      learner,
      configuration,
      event,
      current
    );
  }

  addEvent(learner, eventType, configuration, input, previous) {
    const event = {
      eventId: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`,
      eventType,
      agentLearnerId: learner.agentLearnerId,
      configurationVersion: configuration.configurationVersion,
      configurationFingerprint: configuration.configurationFingerprint,
      previousFingerprint: previous?.configurationFingerprint || null,
      correlationId: input.correlationId,
      occurredAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  result(outcome, learner, configuration, assurance, previous) {
    return {
      outcome,
      registration: {
        agentLearnerId: learner.agentLearnerId,
        agentLearnerKey: learner.agentLearnerKey,
        status: learner.status,
        configurationVersion: configuration.configurationVersion,
        configurationFingerprint: configuration.configurationFingerprint,
        createdAt: learner.createdAt,
        updatedAt: learner.updatedAt,
        currentConfiguration: configuration,
        configurations: learner.configurations,
      },
      assurance: { ...assurance, previousFingerprint: previous?.configurationFingerprint || assurance.previousFingerprint || null },
      correlationId: assurance.correlationId,
    };
  }

  async getById(id) {
    return [...this.learners.values()].find((learner) => learner.agentLearnerId === id) || null;
  }

  async getByKey(key) {
    return this.learners.get(key) || null;
  }

  async getLatestTrace() {
    const event = this.events.at(-1);
    if (!event) return null;
    const learner = [...this.learners.values()].find((item) => item.agentLearnerId === event.agentLearnerId);
    return { outcome: outcomeForEvent(event.eventType), registration: learner, assurance: event, correlationId: event.correlationId };
  }
}

function outcomeForEvent(eventType) {
  if (eventType.endsWith('registered')) return 'registered';
  if (eventType.endsWith('replayed')) return 'unchanged';
  return 'configuration_changed';
}

function request(server, method, path, body, correlationId = 'test-correlation') {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        method,
        path,
        headers: { ...(payload ? { 'content-type': 'application/json' } : {}), 'x-correlation-id': correlationId },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const registration = {
  agentLearnerKey: 'black-box-agent',
  model: { provider: 'synthetic', version: '1.0.0' },
  systemPromptHash: 'sha256:prompt-v1',
  approvedToolManifest: [{ name: 'lookup', version: '1.0.0' }],
  policyConfigurationHash: 'sha256:policy-v1',
  adapterVersion: '1.0.0',
};

test('registration contract covers valid, invalid, repeated, changed, retrieval, and trace flows', async (t) => {
  const repository = new InMemoryRegistry();
  const service = createRegistryService({ repository, eventPublisher: { publish: async () => {} } });
  const server = http.createServer(createApp({ service }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const invalid = await request(server, 'POST', '/v1/registrations', {
    ...registration,
    fingerprint: 'sha256:client-chosen',
  }, 'invalid-correlation');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_request');
  assert.equal(invalid.body.correlationId, 'invalid-correlation');
  const missingAfterInvalid = await request(
    server,
    'GET',
    `/v1/registrations?agentLearnerKey=${encodeURIComponent(registration.agentLearnerKey)}`,
    undefined,
    'after-invalid-correlation'
  );
  assert.equal(missingAfterInvalid.status, 404);

  const created = await request(server, 'POST', '/v1/registrations', registration, 'created-correlation');
  assert.equal(created.status, 201);
  assert.equal(created.body.outcome, 'registered');
  assert.equal(created.body.assurance.correlationId, 'created-correlation');
  assert.match(created.body.registration.configurationFingerprint, /^sha256:/);

  const repeated = await request(server, 'POST', '/v1/registrations', registration, 'retry-correlation');
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.outcome, 'unchanged');
  assert.equal(repeated.body.registration.agentLearnerId, created.body.registration.agentLearnerId);
  assert.equal(repeated.body.registration.configurationVersion, 1);

  const changed = await request(server, 'POST', '/v1/registrations', {
    ...registration,
    model: { provider: 'synthetic', version: '2.0.0' },
  }, 'changed-correlation');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.outcome, 'configuration_changed');
  assert.equal(changed.body.registration.configurationVersion, 2);
  assert.equal(changed.body.assurance.previousFingerprint, created.body.registration.configurationFingerprint);

  const reverted = await request(server, 'POST', '/v1/registrations', registration, 'reverted-correlation');
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.outcome, 'configuration_changed');
  assert.equal(reverted.body.registration.configurationVersion, 3);
  assert.equal(reverted.body.assurance.previousFingerprint, changed.body.registration.configurationFingerprint);

  const repeatedRevert = await request(server, 'POST', '/v1/registrations', registration, 'repeated-revert-correlation');
  assert.equal(repeatedRevert.status, 200);
  assert.equal(repeatedRevert.body.outcome, 'unchanged');
  assert.equal(repeatedRevert.body.registration.configurationVersion, 3);

  const retrieved = await request(
    server,
    'GET',
    `/v1/registrations/${created.body.registration.agentLearnerId}`,
    undefined,
    'retrieve-correlation'
  );
  assert.equal(retrieved.status, 200);
  assert.equal(retrieved.body.registration.configurationVersion, 3);
  assert.equal(retrieved.body.registration.configurations.length, 3);
  assert.equal(retrieved.body.correlationId, 'retrieve-correlation');

  const trace = await request(server, 'GET', '/v1/registration-traces/latest', undefined, 'trace-correlation');
  assert.equal(trace.status, 200);
  assert.equal(trace.body.trace.outcome, 'unchanged');
  assert.equal(trace.body.trace.assurance.correlationId, 'repeated-revert-correlation');
});

test('retrieval returns a versioned not-found contract', async (t) => {
  const repository = new InMemoryRegistry();
  const service = createRegistryService({ repository });
  const server = http.createServer(createApp({ service }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const response = await request(
    server,
    'GET',
    '/v1/registrations/00000000-0000-4000-8000-000000000000',
    undefined,
    'missing-correlation'
  );
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    apiVersion: 'v1',
    error: 'not_found',
    message: 'Agent Learner was not found',
    correlationId: 'missing-correlation',
  });
});
