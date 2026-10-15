'use strict';
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { validateGradingInput } = require('./validator');
const { gradeAttempt } = require('./grader');
const { getRubric } = require('./rubric');
const { GRADER, gradeItems, validateItemGradingRequest } = require('./item-grader');

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

function createApp({ itemGradingKey = process.env.GRADING_SERVICE_KEY } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // In-memory evidence store (PostgreSQL in Sprint 4)
  const evidence = new Map();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: SERVICE_NAME });
  });

  // GET /rubric — return the locked rubric
  app.get('/rubric', (_req, res) => {
    res.json(getRubric());
  });

  // POST /grade — grade an attempt
  // Fails closed: any validation error returns 422 with no score
  app.post('/grade', (req, res) => {
    const errors = validateGradingInput(req.body);
    if (errors.length) {
      return res.status(422).json({
        error: 'invalid_grading_input',
        details: errors,
        score: null,
        passed: null,
      });
    }

    let result;
    try {
      result = gradeAttempt(req.body);
    } catch (err) {
      return res.status(422).json({
        error: 'grading_failed',
        message: err.message,
        score: null,
        passed: null,
      });
    }

    // Store immutable evidence
    evidence.set(result.attemptId, result);

    res.status(200).json(result);
  });

  // POST /v1/item-grades — the Examination Engine's grading call. Stateless:
  // the Engine records the outcome with the attempt, so no response is kept here.
  app.post('/v1/item-grades', (req, res) => {
    if (!itemGradingKey) return res.status(503).json({ error: 'grading_not_configured' });
    if (!matchesKey(req.header('x-grading-service-key'), itemGradingKey)) return res.status(403).json({ error: 'forbidden' });
    const errors = validateItemGradingRequest(req.body);
    if (errors.length) return res.status(422).json({ error: 'invalid_item_grading_input', details: errors });
    const results = gradeItems(req.body);
    log('items_graded', { correlationId: req.header('x-correlation-id') || null, items: results.length });
    return res.status(200).json({ grader: GRADER, results });
  });

  // GET /evidence/:attemptId — retrieve immutable grading evidence
  app.get('/evidence/:attemptId', (req, res) => {
    const record = evidence.get(req.params.attemptId);
    if (!record) return res.status(404).json({ error: 'not_found' });
    res.json(record);
  });

  // GET /evidence — list all grading records
  app.get('/evidence', (_req, res) => {
    const records = [...evidence.values()].map(r => ({
      attemptId: r.attemptId,
      subject: r.subject,
      passed: r.passed,
      overallScore: r.overallScore,
      gradedAt: r.gradedAt,
    }));
    res.json(records);
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 4020;
  createApp().listen(port, () => log('listening', { port: Number(port) }));
}

module.exports = { createApp };
