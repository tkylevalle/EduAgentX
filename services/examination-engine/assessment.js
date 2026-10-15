'use strict';

// The assessment of one complete standard attempt. Pure: the grader's per-item
// output is checked against the pinned rubric's graderOutputSchema, then
// aggregated with the form's pinned tier weights and the template's pass rule.
// Objective outcomes are diagnostic: they name the gap for remediation and
// never add a pass condition the pinned policy does not have.

const SCHEMA_VERSION = 'examination-assessment/1.0.0';
const TIERS = Object.freeze(['recall', 'applied', 'adversarial']);
const FAILURE_REASONS = Object.freeze(['insufficient_overall_score', 'insufficient_adversarial_score',
  'critical_violation', 'malformed_response']);
const RESULT_FIELDS = Object.freeze(['itemId', 'score', 'criticalViolationRuleIds', 'rationale', 'citedItemIds']);
const ASSESSMENT_FIELDS = Object.freeze(['schemaVersion', 'grader', 'overallPercent', 'tierPercents',
  'criticalViolationRuleIds', 'malformedItemIds', 'failureReasons', 'passed', 'objectiveOutcomes',
  'failedObjectiveIds', 'itemOutcomes']);
const OUTCOME_FIELDS = Object.freeze(['itemId', 'tier', 'score', 'criticalViolationRuleIds', 'malformed']);
const IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const MAX_RATIONALE_CHARS = 2000;
const MIN_WORDS = 3;

const round = (value) => Math.round(value * 100) / 100;
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, fields) => isObject(value) && Object.keys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key));
const unique = (values) => [...new Set(values)];
const isScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

// The examination asks for a natural-language answer. A JSON value, or fewer
// than three words, is malformed learner output, not an answer to grade.
function isMalformedResponse(response) {
  const trimmed = String(response).trim();
  try { JSON.parse(trimmed); return true; } catch { /* not JSON: a candidate answer */ }
  return (trimmed.match(/[A-Za-z]{2,}/g) || []).length < MIN_WORDS;
}

// Returns { grader, results } with results in item order, or null when the
// reply is not exactly one valid result per requested item.
function validateGraderReply(reply, itemIds, allowedRules) {
  if (!isObject(reply) || !isObject(reply.grader) || !IDENTIFIER.test(reply.grader.id || '') ||
    !IDENTIFIER.test(reply.grader.version || '') || !Array.isArray(reply.results) ||
    reply.results.length !== itemIds.length) return null;
  const byId = new Map();
  for (const result of reply.results) {
    if (!exactKeys(result, RESULT_FIELDS) || !itemIds.includes(result.itemId) || byId.has(result.itemId) ||
      !isScore(result.score) || !Array.isArray(result.criticalViolationRuleIds) ||
      unique(result.criticalViolationRuleIds).length !== result.criticalViolationRuleIds.length ||
      result.criticalViolationRuleIds.some((rule) => !allowedRules.includes(rule)) ||
      typeof result.rationale !== 'string' || !result.rationale.trim() || result.rationale.length > MAX_RATIONALE_CHARS ||
      !Array.isArray(result.citedItemIds) || !result.citedItemIds.includes(result.itemId) ||
      result.citedItemIds.some((id) => !itemIds.includes(id))) return null;
    byId.set(result.itemId, result);
  }
  return { grader: { id: reply.grader.id, version: reply.grader.version }, results: itemIds.map((id) => byId.get(id)) };
}

function itemOutcomesOf(form, results, malformedItemIds) {
  const byId = new Map(results.map((result) => [result.itemId, result]));
  return form.items.map((item) => {
    const malformed = malformedItemIds.includes(item.id);
    const result = byId.get(item.id);
    return { itemId: item.id, tier: item.tier, score: malformed ? 0 : result.score,
      criticalViolationRuleIds: [...result.criticalViolationRuleIds], malformed };
  });
}

function scoresOf(form, itemOutcomes) {
  const tierPercents = Object.fromEntries(TIERS.map((tier) =>
    [tier, round(mean(itemOutcomes.filter((item) => item.tier === tier).map((item) => item.score)))]));
  const overallPercent = round(TIERS.reduce((sum, tier) => sum + (form.tierWeights[tier] * tierPercents[tier]) / 100, 0));
  return { tierPercents, overallPercent };
}

function objectiveOutcomesOf({ form, objectives, policy, itemOutcomes, violated }) {
  const outcomeById = new Map(itemOutcomes.map((outcome) => [outcome.itemId, outcome]));
  return objectives.map((objective) => {
    const linked = form.items.filter((item) => item.objectiveIds.includes(objective.id)).map((item) => outcomeById.get(item.id));
    const percent = round(mean(linked.map((outcome) => outcome.score)));
    const failed = percent < policy.overallPassPercent ||
      linked.some((outcome) => outcome.malformed || outcome.criticalViolationRuleIds.length) ||
      (objective.criticalViolationRuleIds || []).some((rule) => violated.includes(rule));
    return { objectiveId: objective.id, percent, passed: !failed };
  });
}

function assess({ form, objectives, policy, grader, results, malformedItemIds = [] }) {
  const itemOutcomes = itemOutcomesOf(form, results, malformedItemIds);
  const { tierPercents, overallPercent } = scoresOf(form, itemOutcomes);
  const violated = unique(itemOutcomes.flatMap((outcome) => outcome.criticalViolationRuleIds)).sort();
  const malformed = itemOutcomes.filter((outcome) => outcome.malformed).map((outcome) => outcome.itemId);
  const failureReasons = FAILURE_REASONS.filter((reason) => ({
    insufficient_overall_score: overallPercent < policy.overallPassPercent,
    insufficient_adversarial_score: tierPercents.adversarial < policy.adversarialPassPercent,
    critical_violation: policy.failOnCriticalViolation && violated.length > 0,
    malformed_response: malformed.length > 0,
  })[reason]);
  const objectiveOutcomes = objectiveOutcomesOf({ form, objectives, policy, itemOutcomes, violated });
  return { schemaVersion: SCHEMA_VERSION, grader: { ...grader }, overallPercent, tierPercents,
    criticalViolationRuleIds: violated, malformedItemIds: malformed, failureReasons, passed: failureReasons.length === 0,
    objectiveOutcomes, failedObjectiveIds: objectiveOutcomes.filter((o) => !o.passed).map((o) => o.objectiveId), itemOutcomes };
}

// A stored assessment must be internally consistent, cover exactly the form's
// items, and agree with the recorded pass/fail result.
function checkAssessment(assessment, form, passed) {
  if (!exactKeys(assessment, ASSESSMENT_FIELDS) || assessment.schemaVersion !== SCHEMA_VERSION ||
    !exactKeys(assessment.grader, ['id', 'version']) || !IDENTIFIER.test(assessment.grader.id || '') ||
    !IDENTIFIER.test(assessment.grader.version || '') || assessment.passed !== passed ||
    !Array.isArray(assessment.failureReasons) || assessment.failureReasons.some((r) => !FAILURE_REASONS.includes(r)) ||
    (assessment.failureReasons.length === 0) !== passed || !Array.isArray(assessment.itemOutcomes) ||
    assessment.itemOutcomes.length !== form.items.length) return false;
  const outcomesValid = assessment.itemOutcomes.every((outcome, index) => exactKeys(outcome, OUTCOME_FIELDS) &&
    outcome.itemId === form.items[index].id && outcome.tier === form.items[index].tier && isScore(outcome.score) &&
    typeof outcome.malformed === 'boolean' && Array.isArray(outcome.criticalViolationRuleIds));
  if (!outcomesValid) return false;
  const { tierPercents, overallPercent } = scoresOf(form, assessment.itemOutcomes);
  const violated = unique(assessment.itemOutcomes.flatMap((outcome) => outcome.criticalViolationRuleIds)).sort();
  const malformed = assessment.itemOutcomes.filter((outcome) => outcome.malformed).map((outcome) => outcome.itemId);
  return overallPercent === assessment.overallPercent &&
    TIERS.every((tier) => tierPercents[tier] === assessment.tierPercents?.[tier]) &&
    JSON.stringify(violated) === JSON.stringify(assessment.criticalViolationRuleIds) &&
    JSON.stringify(malformed) === JSON.stringify(assessment.malformedItemIds) &&
    Array.isArray(assessment.objectiveOutcomes) && Array.isArray(assessment.failedObjectiveIds) &&
    JSON.stringify(assessment.objectiveOutcomes.filter((o) => !o.passed).map((o) => o.objectiveId)) ===
      JSON.stringify(assessment.failedObjectiveIds);
}

module.exports = { FAILURE_REASONS, SCHEMA_VERSION, assess, checkAssessment, isMalformedResponse, validateGraderReply };
