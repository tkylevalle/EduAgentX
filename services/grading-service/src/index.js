'use strict';
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
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

// The service has one grader. Pass thresholds and critical rules are not held
// here: each attempt is graded under the rubric and exam template pinned by
// its Domain Assurance Package, which the Examination Engine sends.
function createApp({ itemGradingKey = process.env.GRADING_SERVICE_KEY } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: SERVICE_NAME });
  });

  // The identity of the grader behind every score, for consoles and evidence.
  app.get('/v1/grader', (_req, res) => {
    res.json({ grader: GRADER });
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

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 4020;
  createApp().listen(port, () => log('listening', { port: Number(port) }));
}

module.exports = { createApp };
