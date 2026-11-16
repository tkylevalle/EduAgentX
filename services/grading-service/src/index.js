'use strict';
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { DEFAULT_MODEL, DEFAULT_URL, createJudge } = require('./judge');
const { GradingUnavailableError, createRubricGrader, validateJudgedRequest } = require('./rubric-grader');

const SERVICE_NAME = 'grading-service';

// One structured line per event; never a response, answer or key.
function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: SERVICE_NAME, event, ...fields })}\n`);
}

function matchesKey(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The rubric judge from the environment. The key is optional so the service
 * starts without one; every verdict not already cached then fails closed.
 * @param {NodeJS.ProcessEnv} env
 */
function judgeFromEnv(env = process.env) {
  return createJudge({ apiKey: env.JUDGE_API_KEY || env.OPENCODE_API_KEY, url: env.JUDGE_MODEL_URL || DEFAULT_URL,
    model: env.JUDGE_MODEL || DEFAULT_MODEL });
}

// The service has one grader, the layered rubric judge. Pass thresholds and
// critical rules are not held here: each attempt is graded under the rubric
// and exam template pinned by its Domain Assurance Package, which the
// Examination Engine sends with the rule definitions and item prompts.
function createApp({ itemGradingKey = process.env.GRADING_SERVICE_KEY, grader = createRubricGrader({ judge: judgeFromEnv() }),
  logEvent = log } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: SERVICE_NAME });
  });

  // The identity of the grader behind every score, for consoles and evidence.
  app.get('/v1/grader', (_req, res) => {
    res.json({ grader: grader.identity });
  });

  // POST /v1/item-grades — the Examination Engine's grading call. Stateless
  // apart from the verdict cache: the Engine records the outcome with the attempt.
  // A judge that cannot give a verdict is a 503, which the Engine retries
  // within its window and then aborts as grading_unavailable.
  app.post('/v1/item-grades', async (req, res) => {
    if (!itemGradingKey) return res.status(503).json({ error: 'grading_not_configured' });
    if (!matchesKey(req.header('x-grading-service-key'), itemGradingKey)) return res.status(403).json({ error: 'forbidden' });
    const errors = validateJudgedRequest(req.body);
    if (errors.length) return res.status(422).json({ error: 'invalid_item_grading_input', details: errors });
    const correlationId = req.header('x-correlation-id') || null;
    try {
      const results = await grader.gradeItems(req.body);
      logEvent('items_graded', { correlationId, items: results.length });
      return res.status(200).json({ grader: grader.identity, results });
    } catch (error) {
      if (error instanceof GradingUnavailableError) {
        logEvent('items_ungradeable', { correlationId, reason: error.code });
        return res.status(503).json({ error: error.code });
      }
      logEvent('grading_failed', { correlationId, error: error?.name || 'Error' });
      return res.status(500).json({ error: 'grading_failed' });
    }
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 4020;
  const judge = judgeFromEnv();
  createApp({ grader: createRubricGrader({ judge }) }).listen(port, () =>
    log('listening', { port: Number(port), judgeModel: judge.model, judgeAvailable: judge.available, judgeReason: judge.reason }));
}

module.exports = { createApp, judgeFromEnv };
