'use strict';

// The six gates operate on the immutable Curriculum Engine contract. A failed
// gate is reported independently so a reviewer can identify the exact defect.
const { validatePackage, sha256 } = require('../../curriculum-engine/model');
const { validateFallbackBank, POLICY } = require('../../curriculum-engine/fallback');

const result = (name, errors) => ({
  name, passed: errors.length === 0,
  reason: errors.length ? errors.join('; ') : 'Passed',
});

function runValidationGates(pkg) {
  const schemaErrors = validatePackage(pkg);
  const sources = new Map((pkg?.sources || []).map(source => [source.id, source]));
  const modules = new Map((pkg?.modules || []).map(module => [module.id, module]));
  const slots = new Map((pkg?.examTemplate?.slots || []).map(slot => [slot.id, slot]));
  const sourceErrors = [];
  for (const module of pkg?.modules || []) {
    for (const claim of module.claims || []) {
      const source = sources.get(claim.sourceId);
      if (!source || !claim.pinpoint?.trim() || !source.contentSha256 ||
          !pkg.manifest?.sourcePins?.some(pin => pin.id === source.id && pin.sha256 === sha256(source)))
        sourceErrors.push(`${module.id}: claim source/pinpoint is not pinned`);
    }
  }
  for (const item of pkg?.fallbackBank?.items || []) {
    if (!item.sourceLinks?.length || item.sourceLinks.some(link =>
      !sources.has(link.sourceId) || !link.pinpoint?.trim()))
      sourceErrors.push(`${item.id}: fallback source/pinpoint missing`);
  }
  const objectiveErrors = [];
  for (const objective of pkg?.objectives || []) {
    if (!objective.moduleIds?.some(id => modules.get(id)?.objectiveIds?.includes(objective.id)))
      objectiveErrors.push(`${objective.id}: module link missing`);
    const covered = (objective.examSlotIds || []).map(id => slots.get(id))
      .filter(slot => slot?.objectiveIds?.includes(objective.id));
    if (covered.length < 2 || new Set(covered.map(slot => slot.tier)).size < 2)
      objectiveErrors.push(`${objective.id}: two slots in distinct tiers required`);
    if (objective.safetyCritical && (!covered.some(slot => slot.tier === 'adversarial') ||
      !objective.criticalViolationRuleIds?.some(id => pkg.rubric?.criticalViolationRuleIds?.includes(id))))
      objectiveErrors.push(`${objective.id}: adversarial slot and critical rule required`);
  }
  const exam = pkg?.examTemplate || {};
  const tierCounts = ['recall', 'applied', 'adversarial'].map(tier =>
    (exam.slots || []).filter(slot => slot.tier === tier).length);
  const examinationErrors = [];
  if (exam.slots?.length !== 15 || tierCounts.join() !== '5,6,4')
    examinationErrors.push('15 slots with 5/6/4 tiers required');
  if (JSON.stringify(exam.tierWeights) !== JSON.stringify(POLICY.tierWeights) ||
      exam.overallPassPercent !== 80 || exam.adversarialPassPercent !== 70 ||
      exam.failOnCriticalViolation !== true || !exam.generationPolicy?.trim())
    examinationErrors.push('20/40/40 weights, 80 overall, 70 adversarial, critical failure required');
  const rubric = pkg?.rubric || {};
  const rubricErrors = [];
  if (rubric.scoreFloor !== 3.5 || rubric.scoreTarget !== 4 ||
      !Array.isArray(rubric.criteria) || rubric.criteria.length < 3 ||
      !rubric.criticalViolationRuleIds?.length)
    rubricErrors.push('review floor 3.5, target 4, criteria and critical rules required');
  if (rubric.scoreScale?.min !== 0 || rubric.scoreScale?.max !== 5 ||
      (rubric.criteria || []).reduce((sum, criterion) => sum + (criterion.weight || 0), 0) !== 100 ||
      rubric.criteria?.some(criterion => !criterion.id || !criterion.anchor?.trim()) ||
      !rubric.graderOutputSchema?.score ||
      rubric.criticalViolationRuleIds?.some(id => !rubric.criticalViolationRules?.some(rule => rule.id === id && rule.violation?.trim())))
    rubricErrors.push('weighted criteria, anchors, output schema, and critical-violation definitions required');
  const fallbackErrors = validateFallbackBank(pkg?.fallbackBank, {
    sourceIds: new Set(sources.keys()),
    objectiveIds: new Set((pkg?.objectives || []).map(objective => objective.id)),
  });
  const gates = [
    result('schema_manifest', schemaErrors.map(error => `${error.path}: ${error.message}`)),
    result('source_traceability', sourceErrors),
    result('objective_coverage', objectiveErrors),
    result('examination_policy', examinationErrors),
    result('rubric_policy', rubricErrors),
    result('fallback_readiness', fallbackErrors),
  ];
  return { passed: gates.every(gate => gate.passed), gates };
}

module.exports = { runValidationGates };
