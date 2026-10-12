'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { validateGradingInput } = require('./validator');
const { gradeAttempt } = require('./grader');
const { getRubric } = require('./rubric');

const app = express();
app.use(express.json({ limit: '256kb' }));

// In-memory evidence store (PostgreSQL in Sprint 4)
const evidence = new Map();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'grading-service' });
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

const PORT = process.env.PORT || 4020;
app.listen(PORT, () => console.log(`[grading-service] listening on ${PORT}`));

module.exports = { app };
