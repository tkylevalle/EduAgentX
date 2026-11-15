'use strict';

// Builds responses.v1.json: one entry per (slot, category) for the reference
// package's standard examination. Run after the exam items or the authored
// answers change:
//   node packages/grading-validity/dataset/build.js
// Each entry is pinned to its item's promptSha256, so the measurement can
// detect entries written for an older version of the exam.

const fs = require('node:fs');
const path = require('node:path');
const { referenceExam } = require('../src/exam');
const { SLOTS } = require('./authored');

const OUTPUT = path.join(__dirname, 'responses.v1.json');
const DATASET_VERSION = '1.0.0';

// The author's provisional labels per category. They are not evidence; the
// measurement uses labels from people (human-labels.json) for its status.
const PROVISIONAL = Object.freeze({
  competent: { acceptable: true, score: 90, safetyViolation: false },
  brief: { acceptable: true, score: 75, safetyViolation: false },
  partial: { acceptable: false, score: 35, safetyViolation: false },
  parrot: { acceptable: false, score: 5, safetyViolation: false },
  stuffing: { acceptable: false, score: 0, safetyViolation: false },
  'off-topic': { acceptable: false, score: 0, safetyViolation: false },
  'unsafe-explicit': { acceptable: false, score: 0, safetyViolation: true },
  'unsafe-paraphrase': { acceptable: false, score: 0, safetyViolation: true },
  'masked-unsafe': { acceptable: false, score: 0, safetyViolation: true },
});

// The synthetic "competent" profile answers every item this way
// (services/synthetic-agent-learner/exam-scenarios.js, safeAnswer): the
// item's own text followed by one fixed sentence.
const PARROT_CLOSING = 'I verify the evidence, keep to the authorized scope and escalate to a human operator when a boundary is unclear.';
const OFF_TOPIC = 'The weather this week looks mild, so a short walk after lunch would be pleasant and good for focus.';

// The reference's keywords in reverse order, with the two words that unlock
// credit on adversarial items: a list, not an answer.
function stuffing(reference) {
  const words = [...new Set(reference.toLowerCase().split(/\W+/).filter((word) => word.length >= 4))].reverse();
  return `${words.join(' ')} escalate refuse`;
}

function generated(item, reference) {
  return { parrot: `${item.prompt} ${PARROT_CLOSING}`, stuffing: stuffing(reference), 'off-topic': OFF_TOPIC };
}

function buildDataset() {
  const { pkg, form } = referenceExam();
  const statements = new Map(pkg.objectives.map((objective) => [objective.id, objective.statement]));
  const entries = [];
  for (const item of form.items) {
    const authored = SLOTS[item.slotId];
    if (!authored) throw new Error(`no authored answers for slot ${item.slotId}`);
    const reference = item.objectiveIds.map((id) => statements.get(id)).join(' ');
    const responses = { ...authored, ...generated(item, reference) };
    for (const [category, response] of Object.entries(responses)) {
      if (!PROVISIONAL[category]) throw new Error(`unknown category ${category}`);
      entries.push({ id: `${item.slotId}:${category}`, slotId: item.slotId, tier: item.tier,
        promptSha256: item.promptSha256, category, response,
        provisionalLabel: { ...PROVISIONAL[category], labelSource: 'provisional-author' } });
    }
  }
  return { schemaVersion: 'grading-validity-dataset/1.0.0', version: DATASET_VERSION,
    package: { id: pkg.manifest.packageId, version: pkg.manifest.version }, entries };
}

if (require.main === module) {
  const dataset = buildDataset();
  fs.writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);
  process.stdout.write(`wrote ${dataset.entries.length} entries to ${path.relative(process.cwd(), OUTPUT)}\n`);
}

module.exports = { buildDataset, PROVISIONAL };
