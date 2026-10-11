'use strict';
const { sha256 } = require('./model');

// These are mechanical coverage measurements. They do not assert that cited
// claims are factually true; that requires the recorded independent review.
function measureCurriculum(pkg, reviews = []) {
  const sources = new Map((pkg.sources || []).map(source => [source.id, source]));
  const modules = new Map((pkg.modules || []).map(module => [module.id, module]));
  const slots = new Map((pkg.examTemplate?.slots || []).map(slot => [slot.id, slot]));
  const references = [
    ...(pkg.modules || []).flatMap(module => (module.claims || []).map(claim => ({ ...claim, owner: module.id }))),
    ...(pkg.fallbackBank?.items || []).flatMap(item => (item.sourceLinks || []).map(link => ({ ...link, owner: item.id }))),
  ];
  const traced = references.filter(link => {
    const source = sources.get(link.sourceId);
    return source && typeof link.pinpoint === 'string' && link.pinpoint.trim() &&
      typeof source.edition === 'string' && source.edition.trim() &&
      pkg.manifest?.sourcePins?.some(pin => pin.id === source.id && pin.sha256 === sha256(source));
  });
  const objectives = pkg.objectives || [];
  const covered = objectives.filter(objective => {
    const moduleLinked = objective.moduleIds?.some(id => modules.get(id)?.objectiveIds?.includes(objective.id));
    const linkedSlots = (objective.examSlotIds || []).map(id => slots.get(id))
      .filter(slot => slot?.objectiveIds?.includes(objective.id));
    return moduleLinked && linkedSlots.length >= 2 && new Set(linkedSlots.map(slot => slot.tier)).size >= 2 &&
      (!objective.safetyCritical || (linkedSlots.some(slot => slot.tier === 'adversarial') &&
        objective.criticalViolationRuleIds?.some(id => pkg.rubric?.criticalViolationRuleIds?.includes(id))));
  });
  const approvals = reviews.filter(review => review.approved === true &&
    review.reviewer_id !== pkg.createdBy && Number.isFinite(review.score) && review.score >= 3.5 && review.score <= 5);
  const distinct = new Set(approvals.map(review => review.reviewer_id));
  const reviewerMean = distinct.size >= 2
    ? approvals.reduce((sum, review) => sum + review.score, 0) / approvals.length : null;
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  return {
    schemaVersion: '1.0.0', packageId: pkg.manifest?.packageId, version: pkg.manifest?.version,
    sourceTraceability: { numerator: traced.length, denominator: references.length,
      ratio: ratio(traced.length, references.length), invariantMet: references.length > 0 && traced.length === references.length },
    objectiveCoverage: { numerator: covered.length, denominator: objectives.length,
      ratio: ratio(covered.length, objectives.length), floorMet: objectives.length > 0 && covered.length / objectives.length >= 0.85,
      targetMet: objectives.length > 0 && covered.length / objectives.length >= 0.90 },
    reviewerQuality: { independentApprovals: distinct.size, mean: reviewerMean,
      floorMet: reviewerMean !== null && reviewerMean >= 3.5,
      targetMet: reviewerMean !== null && reviewerMean >= 4 },
    knownCriticalFactualErrors: null,
    criticalErrorStatus: 'human_review_required',
  };
}

module.exports = { measureCurriculum };
