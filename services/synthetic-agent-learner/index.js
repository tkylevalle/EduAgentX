const express = require('express');

const { canonicalEvidence } = require('../external-agent-protocol');
const { GatewayProtocolClient } = require('./gateway-client');
const {
  DEFAULT_REGISTRATION,
  createSyntheticAgentLearner,
  listSyntheticProfiles,
} = require('./learner');

const PORT = Number(process.env.PORT || 4200);
const SERVICE_NAME = process.env.SERVICE_NAME || 'synthetic-agent-learner';
const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';
const AGENT_CLIENT_ID = process.env.AGENT_CLIENT_ID || 'synthetic-agent-learner-dev';
const AGENT_CLIENT_SECRET = process.env.AGENT_CLIENT_SECRET || 'changeme_local_only_agent_secret';

function createApp({ learner = createDefaultLearner() } = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || null;
    next();
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: SERVICE_NAME, protocol: 'ExternalAgentLearner', protocolVersion: '1.0.0' });
  });

  app.get('/v1/profiles', (req, res) => {
    res.status(200).json({
      apiVersion: 'v1',
      evidence: canonicalEvidence('synthetic'),
      profiles: listSyntheticProfiles(),
      correlationId: req.correlationId,
    });
  });

  app.post('/v1/runs', async (req, res, next) => {
    try {
      const body = req.body || {};
      const profileId = body.profileId || body.profile || 'competent';
      const agentLearnerKey = body.agentLearnerKey || AGENT_CLIENT_ID;
      const result = await learner.run({
        profileId,
        registration: {
          ...DEFAULT_REGISTRATION,
          ...(body.registration || {}),
          agentLearnerKey,
        },
        correlationId: req.correlationId || body.correlationId,
        timeoutMs: body.timeoutMs === undefined ? 5000 : body.timeoutMs,
      });
      res.setHeader('x-correlation-id', result.correlationId);
      return res.status(statusForOutcome(result.outcome)).json(result);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(`[${SERVICE_NAME}] unhandled request error`, error);
    return res.status(500).json({
      apiVersion: 'v1',
      error: 'internal_error',
      correlationId: req.correlationId,
    });
  });

  return app;
}

function createDefaultLearner() {
  return createSyntheticAgentLearner({
    gatewayClient: new GatewayProtocolClient({
      gatewayUrl: GATEWAY_URL,
      clientId: AGENT_CLIENT_ID,
      clientSecret: AGENT_CLIENT_SECRET,
    }),
  });
}

function statusForOutcome(outcome) {
  if (outcome === 'rejected') return 400;
  if (outcome === 'system_aborted') return 503;
  return 200;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });
}

module.exports = { createApp, createDefaultLearner, statusForOutcome };
