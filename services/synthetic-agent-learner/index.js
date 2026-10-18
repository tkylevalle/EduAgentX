const express = require('express');

const telemetry = require('../../packages/telemetry');
const { canonicalEvidence } = require('../../packages/external-agent-protocol');
const { GatewayProtocolClient } = require('./gateway-client');
const { createExamRunner } = require('./exam-runner');
const { examAnswer, listExamScenarios } = require('./exam-scenarios');
const { createLiveModel, LiveModelError } = require('./live-model');
const {
  DEFAULT_REGISTRATION,
  createSyntheticAgentLearner,
  listSyntheticProfiles,
} = require('./learner');

const PORT = Number(process.env.PORT || 4200);
const SERVICE_NAME = process.env.SERVICE_NAME || 'synthetic-agent-learner';
const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';
const AGENT_CLIENT_ID = process.env.AGENT_CLIENT_ID || 'synthetic-agent-learner-dev';
const AGENT_CLIENT_SECRET = process.env.AGENT_CLIENT_SECRET;
// The live learner is a different agent, so it signs in as its own identity.
const LIVE_AGENT_CLIENT_ID = process.env.LIVE_AGENT_CLIENT_ID || 'live-agent-learner-dev';
const LIVE_AGENT_CLIENT_SECRET = process.env.LIVE_AGENT_CLIENT_SECRET;
// The live learner is optional: without a key its routes answer 503.
const LIVE_MODEL = process.env.LIVE_MODEL || undefined;
const LIVE_MODEL_URL = process.env.LIVE_MODEL_URL || undefined;
const LIVE_SCENARIO = 'live-model';

// The passing baseline: every item gets the safe answer and the v4 slot an
// explicit refusal and escalation.
const DEFAULT_EXAM_SCENARIO = 'safe-escalation';

function createApp({ learner = createDefaultLearner(), examRunner = null, liveModel = createDefaultLiveModel(),
  liveLearner = null, liveExamRunner = null } = {}) {
  // Built on first use, so apps that never run an exam need no exam client.
  const runner = () => examRunner || (examRunner = createDefaultExamRunner());
  const liveAgent = () => liveLearner || (liveLearner = createDefaultLearner(LIVE_AGENT_CLIENT_ID, LIVE_AGENT_CLIENT_SECRET));
  const liveRunner = () => liveExamRunner ||
    (liveExamRunner = createDefaultExamRunner(LIVE_AGENT_CLIENT_ID, LIVE_AGENT_CLIENT_SECRET));
  const liveIdentity = Boolean(liveLearner || liveExamRunner || LIVE_AGENT_CLIENT_SECRET);
  const liveReady = liveModel.available && liveIdentity;
  const app = express();
  app.use((req, res, next) => {
    req.correlationId = req.header('x-correlation-id') || null;
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: SERVICE_NAME, protocol: 'ExternalAgentLearner', protocolVersion: '1.0.0' });
  });

  // Says whether a live model is configured. Never returns the key.
  app.get('/v1/live-model', (req, res) => {
    res.status(200).json({ apiVersion: 'v1', available: liveReady, provider: liveModel.provider,
      model: liveModel.model, scenarioId: LIVE_SCENARIO, evidence: canonicalEvidence('live'),
      ...(liveReady ? {} : { reason: liveModel.available ? 'live_agent_not_configured' : 'live_model_not_configured' }) });
  });

  const liveUnavailable = (res) => res.status(503).json({ apiVersion: 'v1', outcome: 'system_aborted',
    reason: liveModel.available ? 'live_agent_not_configured' : 'live_model_not_configured', evidence: canonicalEvidence('live') });

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
      const live = body.learner === 'live';
      const agentLearnerKey = live ? LIVE_AGENT_CLIENT_ID : body.agentLearnerKey || AGENT_CLIENT_ID;
      if (live && !liveReady) return liveUnavailable(res);
      const result = await (live ? liveAgent() : learner).run({
        profileId,
        registration: {
          ...DEFAULT_REGISTRATION,
          ...(live ? liveModel.registration : body.registration || {}),
          agentLearnerKey,
        },
        correlationId: req.correlationId || body.correlationId,
        timeoutMs: body.timeoutMs === undefined ? 5000 : body.timeoutMs,
        evidenceMode: live ? 'live' : 'synthetic',
      });
      res.setHeader('x-correlation-id', result.correlationId);
      return res.status(statusForOutcome(result.outcome)).json(live ? { ...result, live: { provider: liveModel.provider, model: liveModel.model } } : result);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/v1/training-runs', async (req, res, next) => {
    try {
      const body = req.body || {};
      const live = body.learner === 'live';
      if (live && !liveReady) return liveUnavailable(res);
      const usage = newUsage();
      const result = await (live ? liveAgent() : learner).train({
        agentLearnerKey: live ? LIVE_AGENT_CLIENT_ID : body.agentLearnerKey || AGENT_CLIENT_ID,
        profileId: body.profileId || 'competent',
        resumeSessionId: body.resumeSessionId,
        maxItems: body.maxItems === undefined ? 20 : body.maxItems,
        correlationId: req.correlationId || body.correlationId,
        ...(live ? { registration: liveModel.registration, evidenceMode: 'live',
          respond: async (item) => {
            try { return record(usage, await liveModel.answerTraining(item)); } catch (error) {
              telemetry.log(SERVICE_NAME, 'live_model_failed', { correlationId: req.correlationId, dependency: 'live-model',
                outcome: error.code, itemKind: item.kind, itemFields: Object.keys(item).join(','), ...(error.detail || {}) });
              throw error;
            }
          } } : {}),
      });
      return res.status(statusForOutcome(result.outcome)).json({ apiVersion: 'v1', ...result,
        ...(live ? { live: liveSummary(liveModel, usage) } : {}),
        evidence: canonicalEvidence(live ? 'live' : 'synthetic') });
    } catch (error) { return next(error); }
  });

  app.get('/v1/exam-scenarios', (req, res) => {
    res.status(200).json({ apiVersion: 'v1', defaultScenario: DEFAULT_EXAM_SCENARIO, scenarios: listExamScenarios(),
      evidence: canonicalEvidence('synthetic') });
  });

  // Issue #21 scenarios taken through the real public Examination route.
  app.post('/v1/exam-runs', async (req, res, next) => {
    try {
      const body = req.body || {};
      const scenarioId = body.scenarioId || DEFAULT_EXAM_SCENARIO;
      if (scenarioId === LIVE_SCENARIO) {
        if (!liveReady) return liveUnavailable(res);
        const usage = newUsage();
        try {
          const result = await liveRunner().examine({
            answerFor: async (item) => record(usage, await liveModel.answerExam(item)),
            correlationId: req.correlationId || body.correlationId,
            gradingWaitMs: 90_000,
          });
          const status = result.outcome === 'not_started' && result.status >= 500 ? 503 : 200;
          return res.status(status).json({ apiVersion: 'v1', scenarioId, ...result, credentialIssued: false,
            live: liveSummary(liveModel, usage), evidence: canonicalEvidence('live') });
        } catch (error) {
          if (!(error instanceof LiveModelError)) throw error;
          telemetry.log(SERVICE_NAME, 'live_model_failed', { correlationId: req.correlationId, dependency: 'live-model', outcome: error.code });
          return res.status(503).json({ apiVersion: 'v1', scenarioId, outcome: 'system_aborted', reason: error.code,
            live: liveSummary(liveModel, usage), evidence: canonicalEvidence('live') });
        }
      }
      if (!listExamScenarios().includes(scenarioId)) {
        return res.status(400).json({ apiVersion: 'v1', outcome: 'rejected', reason: 'unsupported_exam_scenario',
          evidence: canonicalEvidence('synthetic') });
      }
      const result = await runner().examine({
        answerFor: (item, index) => examAnswer(scenarioId, item, index),
        correlationId: req.correlationId || body.correlationId,
      });
      const status = result.outcome === 'not_started' && result.status >= 500 ? 503 : 200;
      return res.status(status).json({ apiVersion: 'v1', scenarioId, ...result, credentialIssued: false,
        evidence: canonicalEvidence('synthetic') });
    } catch (error) { return next(error); }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        apiVersion: 'v1',
        error: 'invalid_request',
        message: 'Request body must contain valid JSON',
        correlationId: req.correlationId,
      });
    }
    telemetry.log(SERVICE_NAME, 'request_failed', { correlationId: req.correlationId, statusCode: 500, outcome: 'error' });
    return res.status(500).json({
      apiVersion: 'v1',
      error: 'internal_error',
      correlationId: req.correlationId,
    });
  });

  return app;
}

function createDefaultLearner(clientId = AGENT_CLIENT_ID, clientSecret = AGENT_CLIENT_SECRET) {
  return createSyntheticAgentLearner({
    gatewayClient: new GatewayProtocolClient({
      gatewayUrl: GATEWAY_URL,
      clientId,
      clientSecret,
    }),
  });
}

function createDefaultLiveModel() {
  return createLiveModel({ apiKey: process.env.OPENCODE_API_KEY, model: LIVE_MODEL, url: LIVE_MODEL_URL });
}

// Token counts only. Answers are restricted examination material (#17) and are
// never returned.
const newUsage = () => ({ calls: 0, promptTokens: 0, completionTokens: 0 });
function record(usage, { answer, usage: used }) {
  usage.calls += 1;
  usage.promptTokens += used.promptTokens || 0;
  usage.completionTokens += used.completionTokens || 0;
  return answer;
}
const liveSummary = (liveModel, usage) => ({ provider: liveModel.provider, model: liveModel.model, ...usage });

function createDefaultExamRunner(clientId = AGENT_CLIENT_ID, clientSecret = AGENT_CLIENT_SECRET) {
  return createExamRunner({
    gatewayClient: new GatewayProtocolClient({
      gatewayUrl: GATEWAY_URL,
      clientId,
      clientSecret,
    }),
  });
}

function statusForOutcome(outcome) {
  if (outcome === 'rejected') return 400;
  if (outcome === 'system_aborted') return 503;
  return 200;
}

if (require.main === module) {
  if (!AGENT_CLIENT_SECRET) {
    console.error(`[${SERVICE_NAME}] AGENT_CLIENT_SECRET is required`);
    process.exit(1);
  }
  createApp().listen(PORT, () => {
    console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
  });
}

module.exports = { createApp, createDefaultLearner, createDefaultExamRunner, createDefaultLiveModel, statusForOutcome,
  DEFAULT_EXAM_SCENARIO, LIVE_SCENARIO };
