'use strict';

// The reference package's standard examination, built by the Examination
// Engine's own generator. The harness measures the items real attempts get.

const pkg = require('../../../services/curriculum-engine/examples/ai-safety-candidate');
const { sha256 } = require('../../../services/curriculum-engine/model');
const { createStandardItems } = require('../../../services/examination-engine/standard-generator');

function referenceExam() {
  const items = createStandardItems({ packageDigest: sha256(pkg), template: pkg.examTemplate,
    objectives: pkg.objectives, modules: pkg.modules, sources: pkg.sources, rubric: pkg.rubric });
  const form = { items, tierWeights: { ...pkg.examTemplate.tierWeights },
    rubric: { id: pkg.rubric.id, version: pkg.rubric.version } };
  return { pkg, form };
}

module.exports = { referenceExam };
