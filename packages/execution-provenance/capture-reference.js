'use strict';

// Maintainer-only capture, never exposed as an HTTP upload. The original
// framework is the deterministic EduAgentX adapter, not a live model/provider.
const fs = require('node:fs');
const { context, hash, responseHash, source } = require('./index');
const reference = require('./reference');
const candidate = require('../../services/curriculum-engine/examples/ai-safety-candidate');
const { deliveryPlan } = require('../../services/training-service/plan');
const { createStandardItems } = require('../../services/examination-engine/standard-generator');
const capturedBy = process.argv[2];
if (!capturedBy) throw new Error('usage: node capture-reference.js <github-login>');
const capturedAt = new Date().toISOString();
const training = deliveryPlan(candidate);
const examination = createStandardItems({ packageDigest: 'capture-context', template: candidate.examTemplate,
  objectives: candidate.objectives, modules: candidate.modules, sources: candidate.sources, rubric: candidate.rubric });
const fallback = candidate.fallbackBank.items.map(({ expectedAnswer, scoringRule, ...item }) => item);
const entries = [...training.map((item) => ['training', item]), ...examination.map((item) => ['examination', item]), ...fallback.map((item) => ['examination', item])]
  .map(([phase, item], index) => {
    // Capture the reference framework's actual return value. These public demo
    // scenarios contain no user/provider secrets; no request prompt is stored.
    const response = phase === 'training' ? reference.getSyntheticProfile('competent').response
      : (item.answerType ? reference.fallbackAnswer(item) : reference.examAnswer('safe-escalation', item, index));
    return { id: `reference-${index + 1}`, phase, requestHash: hash(context(phase, item)), response,
      responseDigest: responseHash(response), capture: { framework: 'eduagentx-deterministic-reference-adapter',
        originalEvidenceMode: 'synthetic', promptTemplateVersion: 'standard-reference/1.0.0',
        capturedAt, fixtureVersion: '1.0.0', sanitization: 'public-reference-data-only/1.0.0' } };
  });
fs.writeFileSync(`${__dirname}/replay.json`, `${JSON.stringify({ schemaVersion: 'execution-replay/1.0.0',
  id: 'reference-safe', version: '1.0.0', entries }, null, 2)}\n`);
// A new capture has a new digest, so it starts with no reviews.
fs.writeFileSync(`${__dirname}/replay.review.json`, `${JSON.stringify({ schemaVersion: 'execution-replay-review/1.0.0',
  manifest: source('replay:reference-safe'), capturedBy, reviews: [] }, null, 2)}\n`);
