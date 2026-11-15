'use strict';
// One check per release record type. Each returns problem messages, empty when the record passes.
// These records are written by people. The gate only reads them and never creates a passing one.

const SECOND_MACHINE_STEPS = ['setup', 'tests', 'demonstration', 'evidenceBundle'];
// Targets are reported honestly as Green or Amber; Red or Unmeasured blocks the release.
const REPORTABLE_STATUSES = new Set(['Green', 'Amber']);

/** @param {unknown} value @returns {boolean} true for a non-blank string */
const isFilled = (value) => typeof value === 'string' && value.trim() !== '';
/** @param {unknown} value @returns {boolean} true for an array with at least one item */
const isNonEmptyList = (value) => Array.isArray(value) && value.length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const samePerson = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const missingFields = (record, fields) => fields.filter((field) => !isFilled(record[field])).map((field) => `${field} missing`);

function secondMachine(record) {
  const problems = SECOND_MACHINE_STEPS
    .filter((step) => record.steps?.[step] !== 'PASS')
    .map((step) => `step ${step} is not PASS`);
  if (record.paidApiCalls !== 0) problems.push('zero-paid path made paid API calls');
  return [...problems, ...missingFields(record, ['machine', 'operator'])];
}

// The drill runs on the second machine (blueprint 09, "Continuity and final verification").
function handoffDrill(record) {
  const missing = missingFields(record, ['backup', 'scenarioOwner', 'scenario']);
  if (missing.length > 0) return missing;
  const problems = [];
  if (samePerson(record.backup, record.scenarioOwner)) problems.push('backup must differ from the scenario owner');
  if (record.onSecondMachine !== true) problems.push('drill was not run on the second machine');
  if (record.result !== 'PASS') problems.push('result is not PASS');
  return problems;
}

function incidents(record) {
  if (!Array.isArray(record.openCriticalOrMajor)) return ['openCriticalOrMajor must be a list'];
  const openCount = record.openCriticalOrMajor.length;
  return openCount === 0 ? [] : [`${openCount} Critical or Major incident${openCount === 1 ? '' : 's'} open`];
}

// floorMet is true when the Acceptance Floor passes and null when no Floor applies.
function metricProblems(result, index) {
  if (!isObject(result)) return [`result ${index + 1} is not an object`];
  const name = isFilled(result.name) ? result.name : `result ${index + 1}`;
  const problems = [];
  if (!REPORTABLE_STATUSES.has(result.status)) problems.push(`${name} is ${result.status ?? 'missing a status'}`);
  if (result.floorMet !== true && result.floorMet !== null) problems.push(`${name} misses its Acceptance Floor`);
  return problems;
}

function metrics(record) {
  if (!Array.isArray(record.invariantsRelaxed)) return ['invariantsRelaxed must be a list, empty when none'];
  if (!isNonEmptyList(record.results)) return ['no results recorded'];
  return [
    ...record.invariantsRelaxed.map((invariant) => `Invariant relaxed: ${invariant}`),
    ...record.results.flatMap(metricProblems),
  ];
}

function liveCost(record) {
  if (typeof record.paidApiUsed !== 'boolean') return ['paidApiUsed must be true or false'];
  const isAmountReported = Number.isFinite(record.amountAed) && record.amountAed >= 0;
  return record.paidApiUsed && !isAmountReported ? ['paid usage reported without an AED amount'] : [];
}

function reviewProblems(record) {
  if (!isNonEmptyList(record.requiredReviews)) return ['requiredReviews must list the mandatory independent reviews'];
  const reviews = Array.isArray(record.independentReviews) ? record.independentReviews.filter(isObject) : [];
  return record.requiredReviews
    .filter((capability) => !reviews.some((review) => review.capability === capability && isFilled(review.reviewer)))
    .map((capability) => `required review "${capability}" not recorded`);
}

// decisionReference points at the minutes of the team's collective decision.
function approval(record) {
  const problems = [];
  if (record.outcome !== 'APPROVED') problems.push('outcome is not APPROVED');
  if (!isNonEmptyList(record.approvedBy)) problems.push('approvedBy is empty');
  return [...problems, ...missingFields(record, ['decisionReference', 'demoPasswordCheck']), ...reviewProblems(record)];
}

// Order is the order blockers are reported in.
const CURRENT_RECORD_CHECKS = {
  'second-machine': secondMachine,
  'handoff-drill': handoffDrill,
  incidents,
  metrics,
  'live-cost': liveCost,
  approval,
};

module.exports = { CURRENT_RECORD_CHECKS, isFilled, isNonEmptyList, missingFields };
