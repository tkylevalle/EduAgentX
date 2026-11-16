// api-gateway (Sprint 1)
//
// The gateway is the only public lifecycle boundary. Agent Learners use the
// versioned ExternalAgentLearner envelope; owning services receive only the
// validated payload after authentication, identity, and correlation checks.

const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const fetch = require('node-fetch');

const telemetry = require('../../packages/telemetry');
const {
  EVIDENCE_ENVIRONMENTS,
  EVIDENCE_LABELS,
  EVIDENCE_MODES,
  MAX_TIMEOUT_MS,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  ProtocolValidationError,
  SUPPORTED_PROTOCOL_VERSIONS,
  protocolResponseMetadata,
  validateProtocolMessage,
} = require('../../packages/external-agent-protocol');
const { authHealth, issueToken, requireRole } = require('./auth');
const execution = require('../../packages/execution-provenance');
const { createRateLimit } = require('./rate-limit');
const { registerAssuranceRoutes } = require('./assurance-routes');
const { registerContinuousAssuranceRoutes } = require('./continuous-assurance-routes');
const { registerReconciliationRoutes } = require('./reconciliation-routes');
const { registerCurriculumRoutes } = require('./curriculum-routes');
const { registerExaminationRoutes } = require('./examination-routes');
const { createMarketplaceGateway } = require('./marketplace-routes');
const { registerTrainingAdminRoutes } = require('./training-admin-routes');
const { TRAINING_IDENTIFIER, isIdentifier } = require('./route-helpers');

const PORT = process.env.PORT || 4000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const MAX_PROTOCOL_IDEMPOTENCY_ENTRIES = 1000;

// Training Session interactions owned by training-service. The plain
// `training.submit` stays on the Sprint 1 boundary below, because the
// conformance suite and the Synthetic Agent Learner still send it as the
// generic lifecycle example and expect 202.
const TRAINING_INTERACTIONS = Object.freeze({
  'training.session.start': { action: 'start' },
  'training.session.continue': { action: 'continue', needsSession: true },
  'training.session.submit': { action: 'submit', needsSession: true, needsItem: true },
});

// Issue #30: an Agent Learner lists or withdraws itself in the Marketplace.
const MARKETPLACE_INTERACTIONS = Object.freeze({
  'marketplace.listing.publish': 'publish',
  'marketplace.listing.withdraw': 'withdraw',
});

function createApp({
  agentRegistryUrl = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001',
  curriculumEngineUrl = process.env.CURRICULUM_ENGINE_URL || 'http://curriculum-engine:4002',
  validationActivationUrl = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  curriculumInternalKey = process.env.CURRICULUM_INTERNAL_KEY,
  // knowledge.lookup reads the curriculum index; without it the route answers 503.
  curriculumIndexUrl = process.env.CURRICULUM_INDEX_URL,
  trainingServiceUrl = process.env.TRAINING_SERVICE_URL || 'http://training-service:4004',
  trainingInternalKey = process.env.TRAINING_INTERNAL_KEY,
  examinationEngineUrl = process.env.EXAMINATION_ENGINE_URL || 'http://examination-engine:4005',
  examinationInternalKey = process.env.EXAMINATION_INTERNAL_KEY,
  // No default URL: without both values every Marketplace route answers 503.
  marketplaceServiceUrl = process.env.MARKETPLACE_SERVICE_URL,
  marketplaceInternalKey = process.env.MARKETPLACE_INTERNAL_KEY,
  skillGapServiceUrl = process.env.SKILL_GAP_SERVICE_URL,
  skillGapInternalKey = process.env.SKILL_GAP_INTERNAL_KEY,
  certificationServiceUrl = process.env.CERTIFICATION_SERVICE_URL,
  certificationInternalKey = process.env.CERTIFICATION_INTERNAL_KEY,
  credentialVerificationUrl = process.env.CREDENTIAL_VERIFICATION_URL,
  credentialInternalKey = process.env.CREDENTIAL_INTERNAL_KEY,
  monitoringServiceUrl = process.env.MONITORING_SERVICE_URL,
  // The monitoring key only the Gateway holds: the one monitoring trusts with a caller's role.
  monitoringGatewayKey = process.env.MONITORING_GATEWAY_KEY,
  protocolIdempotencyStore = new Map(),
  executionPrincipals = execution.enrollments(),
  // Issue #27: pending two-person approvals for governance commands, keyed
  // by `${packageId}:${scopeType}:${scopeId}`. Ephemeral and per-instance,
  // same bounded-state pattern as protocolIdempotencyStore above — it never
  // holds a domain record, only "who has approved so far," so losing it on
  // restart just means approvals have to be re-submitted, not that any
  // state is corrupted.
  governanceApprovalStore = new Map(),
  rateLimit,
} = {}) {
  const enrolledExecutors = execution.enrollments(executionPrincipals);
  const app = express();
  // Every request gets a correlation id, either passed in or generated here.
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });

  app.use(telemetry.middleware('api-gateway'));
  app.use(createRateLimit(rateLimit));

  app.use(express.json({ limit: '64kb' }));

  // Best effort: monitoring is a read-only projection, so its outage never
  // changes a lifecycle answer.
  const notifyMonitoring = (event) => {
    if (!monitoringServiceUrl) return;
    fetch(`${monitoringServiceUrl}/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...event, source: 'api-gateway' }), signal: AbortSignal.timeout(2000) }).catch(() => {});
  };

  app.get('/health', async (req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${agentRegistryUrl}/health`, {
        signal: controller.signal, headers: { 'x-correlation-id': req.correlationId },
      });
      const upstream = await response.json();
      if (!response.ok) throw new Error('dependency unavailable');
      if (!authHealth()) throw new Error('auth unavailable');
      res.status(200).json({ status: 'ok', service: SERVICE_NAME,
        dependencies: { registry: 'ok', authentication: 'ok',
          postgres: upstream.dependencies?.postgres || 'unknown',
          redis: upstream.dependencies?.redis || 'unknown' } });
    } catch (error) {
      telemetry.log(SERVICE_NAME, 'health_failed', { correlationId: req.correlationId });
      res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, error: 'dependency_unavailable' });
    } finally { clearTimeout(timer); }
  });

  // Exchanges pre-shared Sprint 1 client credentials for a short-lived RS256 JWT.
  app.post('/v1/auth/tokens', issueToken);

  app.get('/v1/admin/whoami', requireRole('admin'), (req, res) => {
    res.status(200).json({
      apiVersion: 'v1',
      subject: req.auth.subject,
      role: req.auth.role,
      correlationId: req.correlationId,
    });
  });

  // Public protocol discovery is authenticated so clients cannot mistake an
  // unauthenticated capability document for permission to use the lifecycle.
  app.get('/v1/agent-learner/protocol', requireRole('agent', 'admin'), (req, res) => {
    res.status(200).json({
      apiVersion: 'v1',
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      messageTypes: {
        registration: {
          method: 'POST',
          path: '/v1/agent-learner/registrations',
          description: 'Register or reconcile the authenticated Agent Learner identity',
        },
        lifecycle: {
          method: 'POST',
          path: '/v1/agent-learner/interactions',
          description: 'Submit a versioned lifecycle interaction to the gateway boundary',
        },
      },
      requiredEnvelopeFields: [
        'protocol',
        'protocolVersion',
        'messageType',
        'messageId',
        'correlationId',
        'idempotencyKey',
        'timeoutMs',
        'evidence',
        'payload',
      ],
      timeout: { minimumMs: 1, maximumMs: MAX_TIMEOUT_MS },
      executionProvenance: { schemaVersion: execution.RUN, policyVersion: execution.POLICY,
        supportedModes: ['synthetic','replay'], liveEnabled: false, enrollmentRequired: true },
      evidenceModes: Object.fromEntries(EVIDENCE_MODES.map((mode) => [mode, {
        environment: EVIDENCE_ENVIRONMENTS[mode],
        label: EVIDENCE_LABELS[mode],
      }])),
      providerPolicy: {
        allowlist: false,
        description: 'Model/provider identifiers are opaque protocol metadata; compatibility is defined by the contract.',
      },
      correlationId: req.correlationId,
    });
  });

  // The existing direct registration route remains available for the Agent
  // Registry contract. New adapters should use the envelope route below.
  app.post('/v1/registrations', requireRole('agent'), requireAgentIdentity, async (req, res) => {
    const key = req.header('idempotency-key');
    await proxyJson(req, res, `${agentRegistryUrl}/v1/registrations`, {
      method: 'POST',
      body: req.body || {},
      headers: { 'x-agent-subject': req.auth.subject, ...(key ? {
        'idempotency-key': `direct:${key}`,
        'x-request-fingerprint': createHash('sha256').update(JSON.stringify(req.body)).digest('hex'),
      } : {}) },
    });
  });

  app.post('/v1/agent-learner/registrations', requireRole('agent'), async (req, res) => {
    let message;
    try {
      message = validateProtocolMessage(req.body, { expectedMessageType: 'registration' });
    } catch (error) {
      return protocolError(req, res, error);
    }
    if (!adoptProtocolHeaders(req, res, message)) return undefined;
    if (message.payload.agentLearnerKey !== req.auth.subject) return identityMismatch(req, res, message);

    const idempotencyResult = readProtocolIdempotency(protocolIdempotencyStore, req.auth.subject, message);
    if (idempotencyResult?.conflict) return idempotencyConflict(req, res, message);
    if (idempotencyResult?.replay) {
      return res.status(idempotencyResult.status).json(idempotencyResult.body);
    }

    try {
      const upstream = await forwardJson(req, `${agentRegistryUrl}/v1/registrations`, {
        method: 'POST',
        body: message.payload,
        correlationId: message.correlationId,
        timeoutMs: message.timeoutMs,
        headers: { 'x-agent-subject': req.auth.subject, 'idempotency-key': message.idempotencyKey,
          'x-request-fingerprint': protocolFingerprint(req.auth.subject, message), 'x-message-id': message.messageId },
      });
      const body = decorateProtocolResponse(message, upstream.body);
      rememberProtocolIdempotency(
        protocolIdempotencyStore,
        req.auth.subject,
        message,
        { status: upstream.status, body }
      );
      return res.status(upstream.status).json(body);
    } catch (error) {
      return proxyFailure(req, res, error, message, protocolIdempotencyStore, req.auth.subject);
    }
  });

  app.post('/v1/agent-learner/interactions', requireRole('agent'), async (req, res) => {
    let message;
    try {
      message = validateProtocolMessage(req.body, { expectedMessageType: 'lifecycle' });
    } catch (error) {
      return protocolError(req, res, error);
    }
    if (!adoptProtocolHeaders(req, res, message)) return undefined;
    const identity = message.payload.data?.agentLearnerKey;
    if (identity !== req.auth.subject) return identityMismatch(req, res, message);

    const idempotencyResult = readProtocolIdempotency(protocolIdempotencyStore, req.auth.subject, message);
    if (idempotencyResult?.conflict) return idempotencyConflict(req, res, message);
    if (idempotencyResult?.replay) {
      return res.status(idempotencyResult.status).json(idempotencyResult.body);
    }

    const training = TRAINING_INTERACTIONS[message.payload.interactionType];
    if (training) return forwardTrainingInteraction(req, res, message, training);
    const listing = MARKETPLACE_INTERACTIONS[message.payload.interactionType];
    if (listing) return marketplace.forwardListingInteraction(req, res, message, listing);

    // Sprint 1 has no curriculum/training owner yet. The gateway still proves
    // the real public interaction seam and returns a deliberately bounded
    // acknowledgement; it does not invent a grade, credential, or lifecycle
    // state. The next owning service can replace this boundary without changing
    // adapter messages.
    const body = {
      apiVersion: 'v1',
      status: 'accepted',
      outcome: 'accepted',
      safeState: 'awaiting_lifecycle_owner',
      lifecycle: {
        interactionType: message.payload.interactionType,
        dispatch: 'gateway_boundary',
      },
      credentialIssued: false,
      ...decorateProtocolResponse(message, {}),
    };
    rememberProtocolIdempotency(protocolIdempotencyStore, req.auth.subject, message, { status: 202, body });
    return res.status(202).json(body);
  });

  app.get('/v1/registrations', requireRole('agent', 'admin'), async (req, res) => {
    const key = req.query.agentLearnerKey;
    if (req.auth.role === 'agent' && key !== req.auth.subject) return identityMismatch(req, res);
    await proxyJson(
      req,
      res,
      `${agentRegistryUrl}/v1/registrations?agentLearnerKey=${encodeURIComponent(key || '')}`
    );
  });

  app.get('/v1/registrations/:agentLearnerId', requireRole('agent', 'admin'), async (req, res) => {
    await proxyJson(req, res, `${agentRegistryUrl}/v1/registrations/${encodeURIComponent(req.params.agentLearnerId)}`, {
      enforceAgentOwnership: req.auth.role === 'agent',
    });
  });

  app.get('/v1/admin/registration-traces/latest', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${agentRegistryUrl}/v1/registration-traces/latest`);
  });

  app.get('/v1/admin/event-delivery', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${agentRegistryUrl}/v1/event-delivery`);
  });

  registerCurriculumRoutes(app, { requireRole, proxyJson, forwardJson, proxyFailure, serviceName: SERVICE_NAME,
    curriculumEngineUrl, curriculumInternalKey, validationActivationUrl, governanceApprovalStore });

  // Marketplace forwarding: the listing interaction below and the HTTP routes registered later.
  const marketplace = createMarketplaceGateway({ requireRole, proxyJson, forwardJson, proxyFailure, decorateProtocolResponse,
    marketplaceServiceUrl, marketplaceInternalKey });
  // Training-service trusts these two headers, so the actor is always the
  // authenticated subject, never an agentLearnerKey from the request body.
  const trainingHeaders = (req) => ({
    'x-internal-service-key': trainingInternalKey,
    'x-actor-subject': req.auth.subject, 'x-actor-role': 'gateway',
  });
  // Without the internal key Training would refuse every call; answer 503
  // here instead of sending a request that cannot be authorised.
  const trainingUnavailable = (req, res, message) => {
    const body = { apiVersion: 'v1', error: 'training_unavailable', correlationId: req.correlationId };
    return res.status(503).json(message ? decorateProtocolResponse(message, body) : body);
  };

  async function forwardTrainingInteraction(req, res, message, training) {
    let trustedExecution;
    try { trustedExecution = execution.authority(enrolledExecutors, req.auth, message.payload.data.executionProfile); }
    catch (e) { return res.status(e.status || 403).json({ error: e.code }); }
    if (message.payload.data.executionEvidence && !trustedExecution)
      return res.status(403).json({ error: 'executor_not_authorized' });
    const data = message.payload.data;
    const details = [];
    if (training.needsSession && !TRAINING_IDENTIFIER.test(typeof data.sessionId === 'string' ? data.sessionId : '')) {
      details.push({ field: 'payload.data.sessionId', code: 'required', message: 'sessionId is required' });
    }
    if (training.needsItem && !TRAINING_IDENTIFIER.test(typeof data.deliveryItemId === 'string' ? data.deliveryItemId : '')) {
      details.push({ field: 'payload.data.deliveryItemId', code: 'required', message: 'deliveryItemId is required' });
    }
    // A start's domain is an identifier string; any other type is refused, never coerced or dropped.
    if (training.action === 'start' && data.domainId !== undefined && !isIdentifier(data.domainId)) {
      details.push({ field: 'payload.data.domainId', code: 'invalid', message: 'domainId must be an identifier string' });
    }
    if (details.length) {
      return res.status(400).json(decorateProtocolResponse(message, {
        apiVersion: 'v1', error: 'invalid_lifecycle_payload', details, correlationId: req.correlationId,
      }));
    }
    if (!trainingInternalKey) return trainingUnavailable(req, res, message);

    const path = training.needsSession
      ? `/internal/sessions/${encodeURIComponent(data.sessionId)}/${training.action}`
      : '/internal/sessions/start';
    // On start and continue, data.response is only the protocol's required
    // acknowledgement string, so it is not forwarded. On submit it is the answer.
    const body = {
      idempotencyKey: message.idempotencyKey,
      ...(trustedExecution ? { trustedExecution } : {}),
      ...(training.needsItem && message.payload.data.executionEvidence ? { executionEvidence: message.payload.data.executionEvidence } : {}),
      evidence: { mode: message.evidence.mode, environment: message.evidence.environment },
      ...(training.needsItem ? { deliveryItemId: data.deliveryItemId, response: data.response } : {}),
      // A start may name the domain to train in; Training validates it.
      ...(training.action === 'start' && data.domainId !== undefined ? { domainId: data.domainId } : {}),
    };
    try {
      const upstream = await forwardJson(req, `${trainingServiceUrl}${path}`, {
        method: 'POST', body, correlationId: message.correlationId, timeoutMs: message.timeoutMs,
        headers: trainingHeaders(req),
      });
      if (training.action === 'start' && upstream.status >= 200 && upstream.status < 300) {
        notifyMonitoring({ type: 'training.started', agentId: req.auth.subject, sessionId: upstream.body.sessionId });
      }
      // Not stored in the Gateway's idempotency cache: Training keeps the
      // durable record and re-checks the package on every retry, so a cached
      // reply here could hide a later Quarantine.
      return res.status(upstream.status).json(decorateProtocolResponse(message, {
        ...upstream.body, credentialIssued: false,
      }));
    } catch (error) {
      return proxyFailure(req, res, error, message);
    }
  }

  registerTrainingAdminRoutes(app, { requireRole, proxyJson, trainingServiceUrl, trainingInternalKey, trainingHeaders,
    trainingUnavailable, enrolledExecutors });

  // Issue #32: recommendations and explicit Training handoff share existing admin authority.
  for (const [method, suffix] of [['post', ''], ['get', '/:id'], ['post', '/:id/training-handoff']]) {
    app[method](`/v1/admin/skill-gap/recommendations${suffix}`, requireRole('admin'), async (req, res) => {
      if (!skillGapServiceUrl || !skillGapInternalKey)
        return res.status(503).json({ apiVersion: 'v1', error: 'skill_gap_unavailable', correlationId: req.correlationId });
      const tail = req.params.id ? `/${encodeURIComponent(req.params.id)}${suffix.endsWith('/training-handoff') ? '/training-handoff' : ''}` : '';
      await proxyJson(req, res, `${skillGapServiceUrl}/internal/recommendations${tail}`, {
        method: method.toUpperCase(), ...(method === 'post' ? { body: req.body } : {}),
        headers: { 'x-internal-service-key': skillGapInternalKey, 'x-actor-subject': req.auth.subject, 'x-actor-role': req.auth.role },
      });
    });
  }

  marketplace.registerRoutes(app);

  registerExaminationRoutes(app, { requireRole, proxyJson, forwardJson, serviceName: SERVICE_NAME, enrolledExecutors,
    examinationEngineUrl, examinationInternalKey, curriculumIndexUrl, curriculumInternalKey });

  registerAssuranceRoutes(app, { requireRole, proxyJson, certificationServiceUrl, certificationInternalKey,
    credentialVerificationUrl, credentialInternalKey, monitoringServiceUrl });
  registerContinuousAssuranceRoutes(app, { requireRole, proxyJson, monitoringServiceUrl, monitoringGatewayKey });
  registerReconciliationRoutes(app, { requireRole, proxyJson, examinationEngineUrl, examinationInternalKey,
    certificationServiceUrl, certificationInternalKey, marketplaceServiceUrl, marketplaceInternalKey });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ProtocolValidationError) return protocolError(req, res, error);
    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        apiVersion: 'v1',
        error: 'payload_too_large',
        message: 'Request body exceeds the 64kb limit',
        correlationId: req.correlationId,
      });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        apiVersion: 'v1',
        error: 'invalid_request',
        message: 'Request body must contain valid JSON',
        correlationId: req.correlationId,
      });
    }
    telemetry.log(SERVICE_NAME, 'request_failed', { correlationId: req.correlationId });
    return res.status(500).json({ apiVersion: 'v1', error: 'internal_error', correlationId: req.correlationId });
  });

  return app;
}

function requireAgentIdentity(req, res, next) {
  if (!req.body || req.body.agentLearnerKey !== req.auth.subject) return identityMismatch(req, res);
  next();
}

function identityMismatch(req, res, message) {
  const body = identityMismatchBody(req.correlationId);
  return res.status(403).json(message ? decorateProtocolResponse(message, body) : body);
}

function adoptProtocolHeaders(req, res, message) {
  const headerCorrelationId = req.header('x-correlation-id');
  if (headerCorrelationId && headerCorrelationId !== message.correlationId) {
    res.status(400).json(decorateProtocolResponse(message, {
      apiVersion: 'v1',
      error: 'correlation_mismatch',
      message: 'x-correlation-id must match the protocol correlationId',
      correlationId: req.correlationId,
    }));
    return false;
  }
  const headerProtocolVersion = req.header('x-agent-protocol-version');
  if (headerProtocolVersion && headerProtocolVersion !== message.protocolVersion) {
    res.status(400).json(decorateProtocolResponse(message, {
      apiVersion: 'v1',
      error: 'protocol_version_mismatch',
      message: 'x-agent-protocol-version must match protocolVersion',
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      correlationId: req.correlationId,
    }));
    return false;
  }
  const headerIdempotencyKey = req.header('idempotency-key');
  if (headerIdempotencyKey && headerIdempotencyKey !== message.idempotencyKey) {
    res.status(400).json(decorateProtocolResponse(message, {
      apiVersion: 'v1',
      error: 'idempotency_key_mismatch',
      message: 'idempotency-key must match idempotencyKey',
      correlationId: req.correlationId,
    }));
    return false;
  }
  req.correlationId = message.correlationId;
  res.setHeader('x-correlation-id', message.correlationId);
  return true;
}

function protocolError(req, res, error) {
  const correlationId = protocolCorrelationId(req);
  res.setHeader('x-correlation-id', correlationId);
  const body = {
    apiVersion: 'v1',
    error: error.code || 'invalid_protocol_message',
    message: error.message,
    ...(error.details?.length ? { details: error.details } : {}),
    ...(error.code === 'unsupported_protocol_version' ? { supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS } : {}),
    correlationId,
  };
  const evidence = safeEvidenceFromInput(req.body?.evidence);
  return res.status(error.statusCode || 400).json(evidence ? { ...body, evidence } : body);
}

function idempotencyConflict(req, res, message) {
  const body = {
    apiVersion: 'v1',
    error: 'idempotency_conflict',
    message: 'idempotencyKey was already used for a different protocol message',
    correlationId: req.correlationId,
  };
  return res.status(409).json(message ? decorateProtocolResponse(message, body) : body);
}

function decorateProtocolResponse(message, body) {
  return {
    ...body,
    protocol: protocolResponseMetadata(message),
    evidence: message.evidence,
    correlationId: message.correlationId,
  };
}

function readProtocolIdempotency(store, subject, message) {
  const entry = store.get(protocolIdempotencyKey(subject, message.idempotencyKey));
  if (!entry) return null;
  return entry.fingerprint === protocolFingerprint(subject, message)
    ? { replay: true, status: entry.status, body: entry.body }
    : { conflict: true };
}

function rememberProtocolIdempotency(store, subject, message, response) {
  // Conflicts belong to the original durable key; transient failures may hide
  // a successful commit and must remain retryable against the owning service.
  if (response.status === 409 || response.status >= 500) return;
  const key = protocolIdempotencyKey(subject, message.idempotencyKey);
  store.set(key, { ...response, fingerprint: protocolFingerprint(subject, message) });
  while (store.size > MAX_PROTOCOL_IDEMPOTENCY_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

function protocolIdempotencyKey(subject, idempotencyKey) {
  return `${subject}:${idempotencyKey}`;
}

function protocolFingerprint(subject, message) {
  return createHash('sha256')
    .update(JSON.stringify({ subject, ...message }))
    .digest('hex');
}

async function proxyJson(req, res, url, options = {}) {
  try {
    const upstream = await forwardJson(req, url, options);
    return res.status(upstream.status).json(upstream.body);
  } catch (error) {
    return proxyFailure(req, res, error);
  }
}

async function forwardJson(req, url, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'x-correlation-id': options.correlationId || req.correlationId,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers || {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const raw = await upstream.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (error) {
      throw new Error(`upstream returned invalid JSON (${upstream.status})`);
    }

    if (options.enforceAgentOwnership && upstream.ok && body.registration?.agentLearnerKey !== req.auth.subject) {
      return { status: 403, body: identityMismatchBody(req.correlationId) };
    }
    return { status: upstream.status, body };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`upstream request exceeded timeoutMs (${options.timeoutMs})`);
      timeoutError.code = 'upstream_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function proxyFailure(req, res, error, message, protocolIdempotencyStore, subject) {
  telemetry.log(SERVICE_NAME, 'upstream_failed', { correlationId: req.correlationId });
  const status = error.code === 'upstream_timeout' ? 504 : 502;
  const errorCode = error.code === 'upstream_timeout' ? 'upstream_timeout' : 'upstream_unavailable';
  const body = {
    apiVersion: 'v1',
    error: errorCode,
    correlationId: req.correlationId,
  };
  const responseBody = message ? decorateProtocolResponse(message, body) : body;
  if (message && protocolIdempotencyStore && subject) {
    rememberProtocolIdempotency(protocolIdempotencyStore, subject, message, { status, body: responseBody });
  }
  return res.status(status).json(responseBody);
}

function protocolCorrelationId(req) {
  const candidate = typeof req.body?.correlationId === 'string' ? req.body.correlationId.trim() : '';
  return /^[\x20-\x7e]{1,256}$/.test(candidate) ? candidate : req.correlationId;
}

function safeEvidenceFromInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
  if (!EVIDENCE_MODES.includes(mode)) return null;
  return {
    mode,
    environment: EVIDENCE_ENVIRONMENTS[mode],
    label: EVIDENCE_LABELS[mode],
  };
}

function identityMismatchBody(correlationId) {
  return {
    apiVersion: 'v1',
    error: 'identity_mismatch',
    message: 'agentLearnerKey must match the authenticated Agent Learner identity',
    correlationId,
  };
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });
}

module.exports = {
  createApp,
  decorateProtocolResponse,
  protocolFingerprint,
};
