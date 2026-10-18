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
const { createRateLimit } = require('./rate-limit');
const { registerAssuranceRoutes } = require('./assurance-routes');

const PORT = process.env.PORT || 4000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const MAX_PROTOCOL_IDEMPOTENCY_ENTRIES = 1000;
const TRAINING_IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const REMEDIATION_FIELDS = Object.freeze([
  'requestId', 'agentLearnerKey', 'packageId', 'packageVersion', 'objectiveIds', 'cause', 'evidence',
]);

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
// Who may change Capability Requests and run checks, and who may only read them.
const MARKETPLACE_WRITERS = Object.freeze(['admin', 'demo_operator']);
const MARKETPLACE_READERS = Object.freeze([...MARKETPLACE_WRITERS, 'viewer', 'evaluator', 'governance_operator']);

function createApp({
  agentRegistryUrl = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001',
  curriculumEngineUrl = process.env.CURRICULUM_ENGINE_URL || 'http://curriculum-engine:4002',
  validationActivationUrl = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  curriculumInternalKey = process.env.CURRICULUM_INTERNAL_KEY,
  trainingServiceUrl = process.env.TRAINING_SERVICE_URL || 'http://training-service:4004',
  trainingInternalKey = process.env.TRAINING_INTERNAL_KEY,
  examinationEngineUrl = process.env.EXAMINATION_ENGINE_URL || 'http://examination-engine:4005',
  examinationInternalKey = process.env.EXAMINATION_INTERNAL_KEY,
  // No default URL: without both values every Marketplace route answers 503.
  marketplaceServiceUrl = process.env.MARKETPLACE_SERVICE_URL,
  marketplaceInternalKey = process.env.MARKETPLACE_INTERNAL_KEY,
  certificationServiceUrl = process.env.CERTIFICATION_SERVICE_URL,
  certificationInternalKey = process.env.CERTIFICATION_INTERNAL_KEY,
  credentialVerificationUrl = process.env.CREDENTIAL_VERIFICATION_URL,
  credentialInternalKey = process.env.CREDENTIAL_INTERNAL_KEY,
  monitoringServiceUrl = process.env.MONITORING_SERVICE_URL,
  protocolIdempotencyStore = new Map(),
  // Issue #27: pending two-person approvals for governance commands, keyed
  // by `${packageId}:${scopeType}:${scopeId}`. Ephemeral and per-instance,
  // same bounded-state pattern as protocolIdempotencyStore above — it never
  // holds a domain record, only "who has approved so far," so losing it on
  // restart just means approvals have to be re-submitted, not that any
  // state is corrupted.
  governanceApprovalStore = new Map(),
  rateLimit,
} = {}) {
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
      body: JSON.stringify({ ...event, source: 'api-gateway' }), timeout: 2000 }).catch(() => {});
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
    if (listing) return forwardListingInteraction(req, res, message, listing);

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

  // Candidate package intake is admin-only. No Agent Learner route serves
  // these artifacts; activation and delivery are owned by later work.
  const curriculumHeaders = (req) => ({
    'x-internal-service-key': curriculumInternalKey,
    'x-actor-subject': req.auth.subject,
    'x-actor-role': req.auth.role,
  });
  app.post('/v1/admin/packages', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${curriculumEngineUrl}/internal/packages`, {
      method: 'POST', body: req.body, headers: curriculumHeaders(req),
    });
  });
  app.get('/v1/admin/packages/:packageId/:version', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res,
      `${curriculumEngineUrl}/internal/packages/${encodeURIComponent(req.params.packageId)}/${encodeURIComponent(req.params.version)}`,
      { headers: curriculumHeaders(req) });
  });
  app.get('/v1/admin/packages/:packageId/:version/events', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res,
      `${curriculumEngineUrl}/internal/packages/${encodeURIComponent(req.params.packageId)}/${encodeURIComponent(req.params.version)}/events`,
      { headers: curriculumHeaders(req) });
  });

  // Governance operations are forwarded only after Gateway JWT verification;
  // the downstream service trusts the internal key and the derived subject.
  app.post('/v1/admin/curriculum/packages', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/packages`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.post('/v1/admin/curriculum/validate', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/validate`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.post('/v1/curriculum/review', requireRole('reviewer', 'admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/review`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.post('/v1/admin/curriculum/activate', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/activate`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.get('/v1/admin/curriculum/packages/:packageId/:version', requireRole('admin', 'reviewer'), async (req, res) => {
    await proxyJson(req, res,
      `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}?version=${encodeURIComponent(req.params.version)}`,
      { headers: curriculumHeaders(req) });
  });

  // Issue #27: bounded Governance command, requiring two distinct approving
  // identities before it executes — the same two-person pattern already
  // used for curriculum review (two distinct reviewer subjects before
  // activation), now applied to quarantine release, one of the actions the
  // spec names as human-governance-controlled (corrections, key rotation,
  // policy changes, quarantine release). Either governance_operator or
  // admin may approve; any two DISTINCT subjects (not roles) complete it —
  // matching how /review counts distinct reviewer_id values regardless of
  // whether the caller was 'reviewer' or 'admin'.
  //
  // The Gateway never mutates state itself. On every call (first and
  // second) it rechecks authoritative state immediately before recording an
  // approval or acting — closing a real gap in validation-activation's own
  // restore route, which does not itself verify a scope is still
  // quarantined before restoring it. Only once two distinct, matching
  // approvals are gathered does it call the owning service, which performs
  // the mutation and records it in its own append-only evidence trail —
  // that evidence trail is the audit record for the action itself; the
  // pending-approval store here only ever tracks *who has approved so far*,
  // never a domain record.
  //
  // governance_operator (and viewer/evaluator/demo_operator) are
  // intentionally only ever added to routes meant for them — never to
  // curriculum/activate, training-remediations, or any other mutating
  // admin route — so none of these roles can edit a score, force a pass,
  // issue a credential, or touch immutable policy/evidence.
  app.post('/v1/admin/governance/packages/:packageId/quarantine-release',
    requireRole('governance_operator', 'admin'), async (req, res) => {
      const body = req.body;
      const scope = body?.scope;
      const checks = {
        version: typeof body?.version === 'string' && body.version.trim().length > 0,
        scope: Boolean(scope) && typeof scope === 'object' && !Array.isArray(scope) &&
          typeof scope.type === 'string' && typeof scope.id === 'string' && scope.id.trim().length > 0,
        reason: typeof body?.reason === 'string' && body.reason.trim().length > 0,
        evidenceReference: typeof body?.evidenceReference === 'string' && body.evidenceReference.trim().length > 0,
        restoredPackageId: typeof body?.restoredPackageId === 'string' && body.restoredPackageId.trim().length > 0,
      };
      const invalid = Object.keys(checks).filter((name) => !checks[name]);
      if (invalid.length) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: invalid, correlationId: req.correlationId });
      }

      let current;
      try {
        current = await forwardJson(req,
          `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}?version=${encodeURIComponent(body.version)}`,
          { headers: curriculumHeaders(req) });
      } catch (error) {
        return proxyFailure(req, res, error);
      }
      if (current.status !== 200) return res.status(current.status).json(current.body);

      // Recheck authoritative state: the scope must be quarantined right now,
      // under this request, not merely when an operator last looked at it.
      // Done on every call, including the first approval, so a stale
      // approval can never be banked against a scope that is not (or is no
      // longer) quarantined.
      const stillQuarantined = (current.body.quarantinedScopes || [])
        .some((entry) => entry.scopeType === scope.type && entry.scopeId === scope.id);
      if (!stillQuarantined) {
        return res.status(409).json({ apiVersion: 'v1', error: 'scope_not_quarantined', correlationId: req.correlationId });
      }

      const key = `${req.params.packageId}:${scope.type}:${scope.id}`;
      const pending = governanceApprovalStore.get(key);
      const actor = req.auth.subject;

      if (!pending) {
        governanceApprovalStore.set(key, {
          firstActor: actor, firstRole: req.auth.role, version: body.version,
          restoredPackageId: body.restoredPackageId, evidenceReference: body.evidenceReference,
          reason: body.reason, recordedAt: new Date().toISOString(),
        });
        telemetry.log(SERVICE_NAME, 'governance_approval_recorded',
          { correlationId: req.correlationId, packageId: req.params.packageId, scope, approvals: 1 });
        return res.status(202).json({
          apiVersion: 'v1', status: 'pending_second_approval', approvals: 1, requiredApprovals: 2,
          correlationId: req.correlationId,
        });
      }

      if (pending.firstActor === actor) {
        return res.status(409).json({ apiVersion: 'v1', error: 'duplicate_approver', correlationId: req.correlationId });
      }
      if (pending.version !== body.version || pending.restoredPackageId !== body.restoredPackageId ||
        pending.evidenceReference !== body.evidenceReference) {
        return res.status(409).json({ apiVersion: 'v1', error: 'approval_mismatch', correlationId: req.correlationId });
      }

      // Second, distinct, matching approval: execute. Clear the pending
      // entry first so this can never be completed twice, and combine both
      // approvers' stated reasons into the record the owning service keeps.
      governanceApprovalStore.delete(key);
      telemetry.log(SERVICE_NAME, 'governance_second_approval_executing', {
        correlationId: req.correlationId, packageId: req.params.packageId, scope,
        firstActor: pending.firstActor, secondActor: actor,
      });
      const combinedReason = `Two-person governance approval. First approval by ${pending.firstActor}: ` +
        `${pending.reason} Second approval by ${actor}: ${body.reason}`;

      await proxyJson(req, res,
        `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}/quarantines/restore`,
        {
          method: 'POST',
          headers: curriculumHeaders(req),
          body: {
            version: body.version,
            scope,
            reason: combinedReason,
            evidenceReference: body.evidenceReference,
            restoredPackageId: body.restoredPackageId,
          },
        });
    });

  // Training-service trusts these two headers, so the actor is always the
  // authenticated subject, never an agentLearnerKey from the request body.
  const trainingHeaders = (req) => ({
    'x-internal-service-key': trainingInternalKey,
    'x-actor-subject': req.auth.subject,
  });
  // Without the internal key Training would refuse every call; answer 503
  // here instead of sending a request that cannot be authorised.
  const trainingUnavailable = (req, res, message) => {
    const body = { apiVersion: 'v1', error: 'training_unavailable', correlationId: req.correlationId };
    return res.status(503).json(message ? decorateProtocolResponse(message, body) : body);
  };

  async function forwardTrainingInteraction(req, res, message, training) {
    const data = message.payload.data;
    const details = [];
    if (training.needsSession && !TRAINING_IDENTIFIER.test(typeof data.sessionId === 'string' ? data.sessionId : '')) {
      details.push({ field: 'payload.data.sessionId', code: 'required', message: 'sessionId is required' });
    }
    if (training.needsItem && !TRAINING_IDENTIFIER.test(typeof data.deliveryItemId === 'string' ? data.deliveryItemId : '')) {
      details.push({ field: 'payload.data.deliveryItemId', code: 'required', message: 'deliveryItemId is required' });
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
      evidence: { mode: message.evidence.mode, environment: message.evidence.environment },
      ...(training.needsItem ? { deliveryItemId: data.deliveryItemId, response: data.response } : {}),
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

  // Read-only Training Session views for the Assurance Console. Training's own
  // read routes do not check roles, so the admin role is enforced here.
  app.get('/v1/admin/training-sessions', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    const query = new URLSearchParams();
    for (const name of ['agentLearnerKey', 'status']) {
      if (typeof req.query[name] === 'string' && req.query[name]) query.set(name, req.query[name]);
    }
    await proxyJson(req, res, `${trainingServiceUrl}/internal/sessions${query.size ? `?${query}` : ''}`,
      { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-sessions/:sessionId', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/sessions/${encodeURIComponent(req.params.sessionId)}`,
      { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-metrics', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/metrics`, { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-completion-events', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/completion-events`, { headers: trainingHeaders(req) });
  });
  app.get('/v1/admin/training-completion-incidents', requireRole('admin'), async (req, res) => {
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/completion-incidents`, { headers: trainingHeaders(req) });
  });

  // The one human write route into Training: an operator assigns targeted
  // remediation. An unknown field is refused here, as Training would refuse
  // it; Training validates the rest and records the admin as requestedBy.
  app.post('/v1/admin/training-remediations', requireRole('admin'), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: ['body'], correlationId: req.correlationId });
    }
    const unexpected = Object.keys(body).filter((name) => !REMEDIATION_FIELDS.includes(name));
    if (unexpected.length) {
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request',
        details: unexpected.map((name) => `unexpected:${name}`), correlationId: req.correlationId });
    }
    if (!trainingInternalKey) return trainingUnavailable(req, res);
    await proxyJson(req, res, `${trainingServiceUrl}/internal/remediations`,
      { method: 'POST', body, headers: trainingHeaders(req) });
  });

  // Issue #30: Marketplace. Like Training, marketplace-service trusts the two
  // headers, so the actor is always the token subject, never a body field.
  const marketplaceHeaders = (req) => ({
    'x-internal-service-key': marketplaceInternalKey,
    'x-actor-subject': req.auth.subject,
  });
  const marketplaceUnavailable = (req, res, message) => {
    const body = { apiVersion: 'v1', error: 'marketplace_unavailable', correlationId: req.correlationId };
    return res.status(503).json(message ? decorateProtocolResponse(message, body) : body);
  };

  async function forwardListingInteraction(req, res, message, action) {
    // Only the identity and the protocol's acknowledgement are allowed; the learner listed is the token subject.
    const unexpected = Object.keys(message.payload.data).filter((name) => !['agentLearnerKey', 'response'].includes(name));
    if (unexpected.length) {
      return res.status(400).json(decorateProtocolResponse(message, { apiVersion: 'v1', error: 'invalid_lifecycle_payload',
        details: unexpected.map((name) => ({ field: `payload.data.${name}`, code: 'unexpected', message: `${name} is not accepted` })),
        correlationId: req.correlationId }));
    }
    if (!marketplaceServiceUrl || !marketplaceInternalKey) return marketplaceUnavailable(req, res, message);
    try {
      const upstream = await forwardJson(req, `${marketplaceServiceUrl}/internal/listings/${action}`, {
        method: 'POST', body: { idempotencyKey: message.idempotencyKey }, correlationId: message.correlationId,
        timeoutMs: message.timeoutMs, headers: marketplaceHeaders(req),
      });
      // Not cached here: marketplace-service keeps the durable idempotency record.
      return res.status(upstream.status).json(decorateProtocolResponse(message, upstream.body));
    } catch (error) {
      return proxyFailure(req, res, error, message);
    }
  }

  // One forwarding route. Unknown body fields are refused before anything is
  // sent; marketplace-service validates the rest and stores the actor.
  const marketplaceRoute = (method, buildPath, allowedFields) => async (req, res) => {
    let body;
    if (method === 'POST') {
      body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: ['body'], correlationId: req.correlationId });
      }
      const unexpected = Object.keys(body).filter((name) => !allowedFields.includes(name));
      if (unexpected.length) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request',
          details: unexpected.map((name) => `unexpected:${name}`), correlationId: req.correlationId });
      }
    }
    if (!marketplaceServiceUrl || !marketplaceInternalKey) return marketplaceUnavailable(req, res);
    await proxyJson(req, res, `${marketplaceServiceUrl}${buildPath(req)}`,
      { method, ...(body === undefined ? {} : { body }), headers: marketplaceHeaders(req) });
  };
  const requestPath = (req, suffix = '') =>
    `/internal/capability-requests/${encodeURIComponent(req.params.id)}${suffix}`;

  app.post('/v1/marketplace/capability-requests', requireRole(...MARKETPLACE_WRITERS),
    marketplaceRoute('POST', () => '/internal/capability-requests', ['idempotencyKey', 'request']));
  app.post('/v1/marketplace/capability-requests/:id/versions', requireRole(...MARKETPLACE_WRITERS),
    marketplaceRoute('POST', (req) => requestPath(req, '/versions'), ['idempotencyKey', 'request']));
  app.post('/v1/marketplace/capability-requests/:id/open', requireRole(...MARKETPLACE_WRITERS),
    marketplaceRoute('POST', (req) => requestPath(req, '/open'), ['version']));
  app.post('/v1/marketplace/capability-requests/:id/close', requireRole(...MARKETPLACE_WRITERS),
    marketplaceRoute('POST', (req) => requestPath(req, '/close'), []));
  app.post('/v1/marketplace/capability-requests/:id/eligibility-checks', requireRole(...MARKETPLACE_WRITERS),
    marketplaceRoute('POST', (req) => requestPath(req, '/eligibility-checks'), ['idempotencyKey']));
  app.get('/v1/marketplace/capability-requests', requireRole(...MARKETPLACE_READERS),
    marketplaceRoute('GET', () => '/internal/capability-requests'));
  app.get('/v1/marketplace/capability-requests/:id', requireRole(...MARKETPLACE_READERS),
    marketplaceRoute('GET', (req) => requestPath(req)));
  app.get('/v1/marketplace/eligibility-checks/:checkId', requireRole(...MARKETPLACE_READERS),
    marketplaceRoute('GET', (req) => `/internal/eligibility-checks/${encodeURIComponent(req.params.checkId)}`));
  app.get('/v1/marketplace/listings/:agentLearnerKey', requireRole(...MARKETPLACE_READERS),
    marketplaceRoute('GET', (req) => `/internal/listings/${encodeURIComponent(req.params.agentLearnerKey)}`));

  // Issue #16: public Exam delivery is possible only after the Examination
  // Engine has committed an immutable attempt. No caller-supplied package,
  // completion event, learner key, or generated questions cross this boundary.
  const examinationHeaders = (req) => ({ 'x-internal-service-key': examinationInternalKey,
    'x-actor-subject': req.auth.subject, 'x-actor-role': req.auth.role });
  const examinationUnavailable = (req, res) => res.status(503).json({ apiVersion: 'v1',
    error: 'examination_unavailable', correlationId: req.correlationId });
  app.post('/v1/examinations', requireRole('agent'), async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some((name) => name !== 'idempotencyKey') ||
      !TRAINING_IDENTIFIER.test(req.body.idempotencyKey || ''))
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', correlationId: req.correlationId });
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, `${examinationEngineUrl}/internal/attempts`, { method: 'POST', body: req.body,
      headers: examinationHeaders(req) });
  });
  // The Engine owns durable replay and state checks; the Gateway never caches
  // an answer receipt or accepts a grading/finalization command publicly.
  app.post('/v1/examinations/:attemptId/responses', requireRole('agent'), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((name) => !['idempotencyKey', 'expectedSequence', 'itemId', 'response'].includes(name)) ||
      typeof body.idempotencyKey !== 'string' || !TRAINING_IDENTIFIER.test(body.idempotencyKey) ||
      !Number.isSafeInteger(body.expectedSequence) || body.expectedSequence < 1 ||
      typeof body.itemId !== 'string' || !TRAINING_IDENTIFIER.test(body.itemId) ||
      typeof body.response !== 'string' || !body.response.trim() || body.response.length > 16000)
      return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', correlationId: req.correlationId });
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res,
      `${examinationEngineUrl}/internal/attempts/${encodeURIComponent(req.params.attemptId)}/responses`,
      { method: 'POST', body, headers: examinationHeaders(req) });
  });
  app.get('/v1/examinations/:attemptId', requireRole('agent'), async (req, res) => {
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, `${examinationEngineUrl}/internal/attempts/${encodeURIComponent(req.params.attemptId)}`,
      { headers: examinationHeaders(req) });
  });
  app.get('/v1/admin/examinations/:attemptId', requireRole('admin'), async (req, res) => {
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res, `${examinationEngineUrl}/internal/admin/attempts/${encodeURIComponent(req.params.attemptId)}`,
      { headers: examinationHeaders(req) });
  });
  // Issue #21: failure, gap, remediation delivery and re-examinations of one attempt.
  app.get('/v1/admin/examinations/:attemptId/remediation', requireRole('admin'), async (req, res) => {
    if (!examinationInternalKey) return examinationUnavailable(req, res);
    await proxyJson(req, res,
      `${examinationEngineUrl}/internal/admin/attempts/${encodeURIComponent(req.params.attemptId)}/remediation`,
      { headers: examinationHeaders(req) });
  });

  registerAssuranceRoutes(app, { requireRole, proxyJson, certificationServiceUrl, certificationInternalKey,
    credentialVerificationUrl, credentialInternalKey, monitoringServiceUrl });

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
