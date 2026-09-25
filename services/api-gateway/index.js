// api-gateway (Sprint 1)
//
// The gateway is the only public lifecycle boundary. Agent Learners use the
// versioned ExternalAgentLearner envelope; owning services receive only the
// validated payload after authentication, identity, and correlation checks.

const crypto = require('node:crypto');
const express = require('express');
const fetch = require('node-fetch');
const { randomUUID } = require('crypto');

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
} = require('../external-agent-protocol');
const { issueToken, requireRole } = require('./auth');

const PORT = process.env.PORT || 4000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'api-gateway';
const MAX_PROTOCOL_IDEMPOTENCY_ENTRIES = 1000;

function createApp({
  agentRegistryUrl = process.env.AGENT_REGISTRY_URL || 'http://agent-registry:4001',
  protocolIdempotencyStore = new Map(),
} = {}) {
  const app = express();
  // Every request gets a correlation id, either passed in or generated here.
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });

  // Log request metadata without bodies, credentials, or query parameters.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.once('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1e6;

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'http_request_completed',
        service: 'api-gateway',
        correlationId: req.correlationId,
        method: req.method,
        path: req.route?.path || '[unmatched]',
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
      }));
    });

    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (req, res) => {
    try {
      const response = await fetch(`${agentRegistryUrl}/health`);
      if (!response.ok) throw new Error(`agent-registry health returned ${response.status}`);
      res.status(200).json({ status: 'ok', service: SERVICE_NAME });
    } catch (error) {
      res.status(503).json({ status: 'unhealthy', service: SERVICE_NAME, error: error.message });
    }
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
    await proxyJson(req, res, `${agentRegistryUrl}/v1/registrations`, {
      method: 'POST',
      body: req.body || {},
      headers: { 'x-agent-subject': req.auth.subject },
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
        headers: { 'x-agent-subject': req.auth.subject },
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
    console.error(`[${SERVICE_NAME}] unhandled request error`, error);
    return res.status(500).json({ apiVersion: 'v1', error: 'internal_error', correlationId: req.correlationId });
  });

  return app;
}

function requireAgentIdentity(req, res, next) {
  if (!req.body || req.body.agentLearnerKey !== req.auth.subject) return identityMismatch(req, res);
  next();
}

function identityMismatch(req, res, message) {
  const body = {
    apiVersion: 'v1',
    error: 'identity_mismatch',
    message: 'agentLearnerKey must match the authenticated Agent Learner identity',
    correlationId: req.correlationId,
  };
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
  return crypto.createHash('sha256')
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
  const controller = Number.isInteger(options.timeoutMs) ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  try {
    const upstream = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'x-correlation-id': options.correlationId || req.correlationId,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers || {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(controller ? { signal: controller.signal } : {}),
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
    if (error.name === 'AbortError' && controller) {
      const timeoutError = new Error(`upstream request exceeded timeoutMs (${options.timeoutMs})`);
      timeoutError.code = 'upstream_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function proxyFailure(req, res, error, message, protocolIdempotencyStore, subject) {
  console.error(`[${SERVICE_NAME}] proxy error`, error);
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
  return candidate && candidate.length <= 256 ? candidate : req.correlationId;
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
