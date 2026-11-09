'use strict';
// One check per release record type. Each returns problem messages, empty when the record passes.
// These records are written by people. The gate only reads them and never creates a passing one.

const SECOND_MACHINE_STEPS = ['setup', 'tests', 'demonstration', 'evidenceBundle'];
const REPORTABLE_STATUSES = new Set(['Green', 'Amber']);

const filled = (value) => typeof value === 'string' && value.trim() !== '';
const filledList = (value) => Array.isArray(value) && value.length > 0;

function secondMachine(record) {
  const problems = SECOND_MACHINE_STEPS
    .filter((step) => record.steps?.[step] !== 'PASS')
    .map((step) => `step ${step} is not PASS`);
  if (record.paidApiCalls !== 0) problems.push('zero-paid path made paid API calls');
  if (!filled(record.machine) || !filled(record.operator)) problems.push('machine or operator missing');
  return problems;
}

function handoffDrill(record) {
  if (!filled(record.backup) || !filled(record.scenarioOwner) || !filled(record.scenario)) {
    return ['backup, scenario owner or scenario missing'];
  }
  const problems = [];
  if (record.backup.toLowerCase() === record.scenarioOwner.toLowerCase()) {
    problems.push('backup must differ from the scenario owner');
  }
  if (record.onSecondMachine !== true) problems.push('drill was not run on the second machine');
  if (record.result !== 'PASS') problems.push('result is not PASS');
  return problems;
}

function incidents(record) {
  if (!Array.isArray(record.openCriticalOrMajor)) return ['openCriticalOrMajor must be a list'];
  const open = record.openCriticalOrMajor.length;
  return open === 0 ? [] : [`${open} Critical or Major incident${open === 1 ? '' : 's'} open`];
}

function metrics(record) {
  if (!filledList(record.results)) return ['no results recorded'];
  return record.results.flatMap((result) => {
    const name = filled(result.name) ? result.name : 'unnamed metric';
    const problems = [];
    if (!REPORTABLE_STATUSES.has(result.status)) problems.push(`${name} is ${result.status ?? 'missing a status'}`);
    if (result.floorMet !== true) problems.push(`${name} misses its Acceptance Floor`);
    return problems;
  });
}

function liveCost(record) {
  if (typeof record.paidApiUsed !== 'boolean') return ['paidApiUsed must be true or false'];
  const reported = Number.isFinite(record.amountAed) && record.amountAed >= 0;
  return record.paidApiUsed && !reported ? ['paid usage reported without an AED amount'] : [];
}

function approval(record) {
  const problems = [];
  if (record.outcome !== 'APPROVED') problems.push('outcome is not APPROVED');
  if (!filledList(record.approvedBy)) problems.push('approvedBy is empty');
  const reviews = Array.isArray(record.independentReviews) ? record.independentReviews : [];
  if (!reviews.some((review) => filled(review?.capability) && filled(review?.reviewer))) {
    problems.push('no independent review recorded');
  }
  return problems;
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

module.exports = { CURRENT_RECORD_CHECKS, filled, filledList };
