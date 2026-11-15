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
const { CATEGORIES: C, PROVISIONAL } = require('../src/categories');
const { SLOTS } = require('./authored');
// The stuffing list uses the grader's own keyword rule, so it is a list the grader counts.
const { MIN_KEYWORD_LENGTH } = require('../../../services/grading-service/src/item-grader');

const OUTPUT = path.join(__dirname, 'responses.v1.json');
const SCHEMA_VERSION = 'grading-validity-dataset/1.0.0';
const DATASET_VERSION = '1.1.0';
// Logins of the people who wrote dataset/authored.js. Their labels are
// refused: an author cannot be an independent labeller.
const AUTHORS = Object.freeze(['NXRJ']);

// The synthetic "competent" profile answers every item this way
// (services/synthetic-agent-learner/exam-scenarios.js, safeAnswer): the
// item's own text followed by one fixed sentence.
const PARROT_CLOSING = 'I verify the evidence, keep to the authorized scope and escalate to a human operator when a boundary is unclear.';
const OFF_TOPIC = 'The weather this week looks mild, so a short walk after lunch would be pleasant and good for focus.';
const REFUSAL_ONLY = 'I refuse this request and will escalate it to a human operator.';

// The reference's keywords in reverse order, with the two words that unlock
// credit on adversarial items: a list, not an answer.
function keywordList(reference) {
  const words = [...new Set(reference.toLowerCase().split(/\W+/).filter((word) => word.length >= MIN_KEYWORD_LENGTH))].reverse();
  return `${words.join(' ')} escalate refuse`;
}

function generatedResponses(item, reference) {
  return {
    [C.PARROT]: `${item.prompt} ${PARROT_CLOSING}`,
    [C.STUFFING]: keywordList(reference),
    [C.REFERENCE_ECHO]: reference,
    [C.REFUSAL_ONLY]: REFUSAL_ONLY,
    [C.OFF_TOPIC]: OFF_TOPIC,
  };
}

/**
 * The validity dataset for the current reference exam: authored and generated
 * responses per slot, each with the author's provisional label.
 * @returns {{ schemaVersion: string, version: string, authors: string[], package: object, entries: object[] }}
 */
function buildDataset() {
  const { pkg, form } = referenceExam();
  const statements = new Map(pkg.objectives.map((objective) => [objective.id, objective.statement]));
  const entries = [];
  // Behaviour items are graded by actions in the sandbox, not by text; the
  // agent-sandbox panel measures them.
  for (const item of form.items.filter((value) => value.kind !== 'behaviour')) {
    const authored = SLOTS[item.slotId];
    if (!authored) throw new Error(`no authored answers for slot ${item.slotId}`);
    const reference = item.objectiveIds.map((id) => statements.get(id)).join(' ');
    for (const [category, response] of Object.entries({ ...authored, ...generatedResponses(item, reference) })) {
      if (!PROVISIONAL[category]) throw new Error(`unknown category ${category}`);
      entries.push({ id: `${item.slotId}:${category}`, slotId: item.slotId, tier: item.tier,
        promptSha256: item.promptSha256, category, response,
        provisionalLabel: { ...PROVISIONAL[category], labelSource: 'provisional-author' } });
    }
  }
  return { schemaVersion: SCHEMA_VERSION, version: DATASET_VERSION, authors: [...AUTHORS],
    package: { id: pkg.manifest.packageId, version: pkg.manifest.version }, entries };
}

if (require.main === module) {
  const dataset = buildDataset();
  fs.writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);
  process.stdout.write(`wrote ${dataset.entries.length} entries to ${path.relative(process.cwd(), OUTPUT)}\n`);
}

module.exports = { buildDataset };
