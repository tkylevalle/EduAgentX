const telemetry = require('./telemetry');
const express = require('express');

const { RegistryError } = require('./registry-service');

const API_VERSION = 'v1';

function createApp({ service }) {
  if (!service) throw new TypeError('An Agent Registry service is required');

  const app = express();

  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || require('node:crypto').randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });

  app.use(telemetry.middleware('agent-registry'));

  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (req, res, next) => {
    try {
      const dependencies = typeof service.health === 'function' ? await service.health() : {};
      res.status(200).json({ apiVersion: API_VERSION, status: 'ok', service: 'agent-registry', dependencies });
    } catch (error) {
      telemetry.log('agent-registry', 'health_failed', { correlationId: req.correlationId });
      res.status(503).json({ status: 'unhealthy', service: 'agent-registry' });
    }
  });

  app.post('/v1/registrations', async (req, res, next) => {
    try {
      const result = await service.register(req.body, { correlationId: req.correlationId });
      res.status(result.httpStatus).json({
        apiVersion: API_VERSION,
        outcome: result.outcome,
        status: result.status,
        registration: registrationSummary(result.registration),
        assurance: assuranceSummary(result.assurance),
        correlationId: result.correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/registrations', async (req, res, next) => {
    try {
      const result = await service.getByKey(req.query.agentLearnerKey, { correlationId: req.correlationId });
      res.status(200).json({
        apiVersion: API_VERSION,
        registration: registrationDetails(result.registration),
        correlationId: result.correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/registrations/:agentLearnerId', async (req, res, next) => {
    try {
      const result = await service.getById(req.params.agentLearnerId, { correlationId: req.correlationId });
      res.status(200).json({
        apiVersion: API_VERSION,
        registration: registrationDetails(result.registration),
        correlationId: result.correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/registration-traces/latest', async (req, res, next) => {
    try {
      const result = await service.getLatestTrace({ correlationId: req.correlationId });
      res.status(200).json({
        apiVersion: API_VERSION,
        trace: {
          outcome: result.trace.outcome,
          registration: registrationDetails(result.trace.registration),
          assurance: assuranceSummary(result.trace.assurance),
        },
        correlationId: result.correlationId,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        apiVersion: API_VERSION,
        error: 'payload_too_large',
        message: 'Request body exceeds the 64kb limit',
        correlationId: req.correlationId,
      });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        apiVersion: API_VERSION,
        error: 'invalid_request',
        message: 'Request body must contain valid JSON',
        correlationId: req.correlationId,
      });
    }
    if (error instanceof RegistryError) {
      return res.status(error.statusCode).json({
        apiVersion: API_VERSION,
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        correlationId: req.correlationId,
      });
    }

    telemetry.log('agent-registry', 'request_failed', { correlationId: req.correlationId });
    return res.status(500).json({
      apiVersion: API_VERSION,
      error: 'internal_error',
      message: 'The Agent Registry could not complete the request',
      correlationId: req.correlationId,
    });
  });

  return app;
}

function registrationSummary(registration) {
  if (!registration) return null;
  const currentConfiguration = registration.currentConfiguration || registration.configurations?.at(-1) || {};
  return {
    agentLearnerId: registration.agentLearnerId,
    agentLearnerKey: registration.agentLearnerKey,
    status: registration.status,
    configurationVersion: registration.configurationVersion ?? currentConfiguration.configurationVersion,
    configurationFingerprint: registration.configurationFingerprint ?? currentConfiguration.configurationFingerprint,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
  };
}

function configurationDetails(configuration) {
  if (!configuration) return null;
  return {
    configurationVersion: configuration.configurationVersion,
    configurationFingerprint: configuration.configurationFingerprint,
    model: configuration.model,
    systemPromptHash: configuration.systemPromptHash,
    approvedToolManifest: configuration.approvedToolManifest,
    policyConfigurationHash: configuration.policyConfigurationHash,
    adapterVersion: configuration.adapterVersion,
    correlationId: configuration.correlationId,
    createdAt: configuration.createdAt,
  };
}

function registrationDetails(registration) {
  if (!registration) return null;
  const summary = registrationSummary(registration);
  return {
    ...summary,
    currentConfiguration: configurationDetails(
      registration.currentConfiguration || registration.configurations?.at(0)
    ),
    configurations: Array.isArray(registration.configurations)
      ? registration.configurations.map(configurationDetails)
      : [],
    latestAssurance: assuranceSummary(registration.latestAssurance),
  };
}

function assuranceSummary(assurance) {
  if (!assurance) return null;
  return {
    eventId: assurance.eventId,
    eventType: assurance.eventType,
    agentLearnerId: assurance.agentLearnerId,
    configurationVersion: assurance.configurationVersion,
    configurationFingerprint: assurance.configurationFingerprint,
    previousFingerprint: assurance.previousFingerprint || null,
    correlationId: assurance.correlationId,
    occurredAt: assurance.occurredAt,
    ...(assurance.publicationStatus ? { publicationStatus: assurance.publicationStatus } : {}),
  };
}

module.exports = { API_VERSION, createApp, assuranceSummary, registrationDetails, registrationSummary };
