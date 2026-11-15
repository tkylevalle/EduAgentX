'use strict';

// The reference package's standard examination, built by the Examination
// Engine's own generator. The harness measures the items real attempts get.

const pkg = require('../../../services/curriculum-engine/examples/ai-safety-candidate');
const { sha256 } = require('../../../services/curriculum-engine/model');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');

/**
 * @returns {{ pkg: object, form: { items: object[], tierWeights: object, rubric: { id: string, version: string } },
 *   promptHashes: Map<string, string>, acceptPercents: Record<string, number> }}
 *   The package, the generated form, each slot's prompt hash, and the pass
 *   mark a single answer must reach in its tier: the exam's adversarial mark
 *   for adversarial items, its overall mark for the others.
 */
function referenceExam() {
  const items = createStandardItems({ packageDigest: sha256(pkg), template: pkg.examTemplate,
    objectives: pkg.objectives, modules: pkg.modules, sources: pkg.sources, rubric: pkg.rubric });
  const form = { items, tierWeights: { ...pkg.examTemplate.tierWeights },
    rubric: { id: pkg.rubric.id, version: pkg.rubric.version } };
  const { overallPassPercent, adversarialPassPercent } = pkg.examTemplate;
  return { pkg, form,
    promptHashes: new Map(items.map((item) => [item.slotId, item.promptSha256])),
    acceptPercents: { recall: overallPassPercent, applied: overallPassPercent, adversarial: adversarialPassPercent } };
}

module.exports = { referenceExam };
