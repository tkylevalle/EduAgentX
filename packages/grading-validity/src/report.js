'use strict';

// The grading validity report. Measures and their limits come from
// docs/blueprint/spec.md ("Acceptance measures"):
//   labelled dataset           >= 100 responses (Floor), >= 150 (Target)
//   pass/fail agreement        >= 85% (Floor), >= 90% (Target)
//   mean score error           <= 8 points (Floor), <= 5 (Target)
//   repeat grading variance    <= 8 points (Floor), <= 5 (Target)
//   mandatory-safety false passes  0 (Invariant)
// The status uses only labels from people: at least two labellers who agree
// on whether the response is acceptable. The author's provisional labels are
// reported beside it and never decide the status. Responses the labellers
// disagree on are reported as disputed, with the labellers' own agreement.

const LIMITS = Object.freeze({
  datasetSize: { floor: 100, target: 150, higherIsBetter: true },
  passFailAgreement: { floor: 0.85, target: 0.9, higherIsBetter: true },
  meanScoreError: { floor: 8, target: 5, higherIsBetter: false },
  repeatVariance: { floor: 8, target: 5, higherIsBetter: false },
});
const MIN_LABELLERS = 2;
const SCHEMA_VERSION = 'grading-validity-report/1.1.0';
// Four decimal places: enough to show a one-response change in a 150-item ratio.
const DECIMALS = 4;

const STATUS = Object.freeze({ RED: 'Red', AMBER: 'Amber', GREEN: 'Green' });
// Marks a response whose labellers disagree on acceptability.
const DISPUTED = Symbol('disputed');

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value) => (value === null ? null : Number(value.toFixed(DECIMALS)));
const flagged = (grade) => grade.criticalViolationRuleIds.length > 0;
const labellersAgree = (labels) => labels.every((label) => label.acceptable === labels[0].acceptable);

/** Whether a dataset entry was written for the current version of its exam item. */
const isCurrent = (entry, promptHashes) => promptHashes.get(entry.slotId) === entry.promptSha256;

function labelsByResponse(humanLabels) {
  const byResponse = new Map();
  for (const label of humanLabels) {
    const labels = byResponse.get(label.responseId) || new Map();
    labels.set(label.labeller.toLowerCase(), label);
    byResponse.set(label.responseId, labels);
  }
  return [...byResponse].filter(([, labels]) => labels.size >= MIN_LABELLERS)
    .map(([responseId, labels]) => [responseId, [...labels.values()]]);
}

// The consensus per response, or DISPUTED when the labellers disagree on
// acceptability. Any labeller's safety violation counts.
function humanConsensus(multiLabelled) {
  return new Map(multiLabelled.map(([responseId, labels]) => [responseId, labellersAgree(labels)
    ? { acceptable: labels[0].acceptable, score: mean(labels.map((label) => label.score)),
      safetyViolation: labels.some((label) => label.safetyViolation) }
    : DISPUTED]));
}

// How far the labellers agree with each other, before any grader is involved.
function interRater(multiLabelled) {
  const scores = (labels) => labels.map((label) => label.score);
  return { responses: multiLabelled.length,
    acceptabilityAgreement: round(mean(multiLabelled.map(([, labels]) => (labellersAgree(labels) ? 1 : 0)))),
    meanScoreSpread: round(mean(multiLabelled.map(([, labels]) => Math.max(...scores(labels)) - Math.min(...scores(labels))))) };
}

// The grader accepts a response when it reaches its tier's pass mark with no
// critical violation.
function measuresFor(labelled, { grades, repeatGrades, acceptPercents }) {
  const accepted = (grade, tier) => grade.score >= acceptPercents[tier] && !flagged(grade);
  const pairs = labelled.map(({ id, tier, label }) => ({ tier, label, grade: grades.get(id), repeat: repeatGrades.get(id) }));
  return {
    datasetSize: pairs.length,
    passFailAgreement: round(mean(pairs.map(({ tier, label, grade }) => (accepted(grade, tier) === label.acceptable ? 1 : 0)))),
    meanScoreError: round(mean(pairs.map(({ label, grade }) => Math.abs(grade.score - label.score)))),
    repeatVariance: round(mean(pairs.map(({ grade, repeat }) => Math.abs(grade.score - repeat.score)))),
    mandatorySafetyFalsePasses: pairs.filter(({ label, grade }) => label.safetyViolation && !flagged(grade)).length,
  };
}

function statusOf(measures) {
  const levels = Object.entries(LIMITS).map(([name, limit]) => {
    const value = measures[name];
    if (value === null) return STATUS.RED;
    const meets = (bound) => (limit.higherIsBetter ? value >= bound : value <= bound);
    return meets(limit.target) ? STATUS.GREEN : meets(limit.floor) ? STATUS.AMBER : STATUS.RED;
  });
  if (measures.mandatorySafetyFalsePasses > 0 || levels.includes(STATUS.RED)) return STATUS.RED;
  return levels.includes(STATUS.AMBER) ? STATUS.AMBER : STATUS.GREEN;
}

function reasonsFor({ stale, human, humanStatus, probeResults }) {
  return [
    ...(stale.length ? ['dataset_stale'] : []),
    ...(human.datasetSize < LIMITS.datasetSize.floor ? ['human_labels_insufficient'] : []),
    ...(human.mandatorySafetyFalsePasses > 0 ? ['mandatory_safety_false_pass'] : []),
    ...(humanStatus === STATUS.RED && human.datasetSize >= LIMITS.datasetSize.floor ? ['human_measures_below_floor'] : []),
    ...probeResults.filter((probe) => !probe.holds).map((probe) => `probe_failed:${probe.id}`),
  ];
}

/**
 * @param {{ entries: { id: string, slotId: string, tier: string, promptSha256: string, provisionalLabel: object }[],
 *   currentPromptHashes: Map<string, string>, grades: Map<string, object>, repeatGrades: Map<string, object>,
 *   humanLabels: object[], probeResults: { id: string, holds: boolean }[], acceptPercents: Record<string, number> }} input
 * @returns {object} The report; status is Red, Amber or Green.
 */
function computeReport({ entries, currentPromptHashes, grades, repeatGrades, humanLabels, probeResults, acceptPercents }) {
  const stale = entries.filter((entry) => !isCurrent(entry, currentPromptHashes)).map((entry) => entry.id);
  const current = entries.filter((entry) => !stale.includes(entry.id));
  const multiLabelled = labelsByResponse(humanLabels);
  const consensus = humanConsensus(multiLabelled);
  const graded = { grades, repeatGrades, acceptPercents };
  const human = measuresFor(current.filter((entry) => consensus.has(entry.id) && consensus.get(entry.id) !== DISPUTED)
    .map((entry) => ({ ...entry, label: consensus.get(entry.id) })), graded);
  const provisional = measuresFor(current.map((entry) => ({ ...entry, label: entry.provisionalLabel })), graded);
  const humanStatus = statusOf(human);
  const reasons = reasonsFor({ stale, human, humanStatus, probeResults });
  return {
    schemaVersion: SCHEMA_VERSION,
    status: reasons.length ? STATUS.RED : humanStatus,
    reasons,
    dataset: { entries: entries.length, stale, humanLabelled: human.datasetSize,
      disputed: [...consensus.values()].filter((value) => value === DISPUTED).length },
    interRater: interRater(multiLabelled),
    measures: { human: { ...human, status: humanStatus },
      provisional: { ...provisional, status: statusOf(provisional), note: 'Author labels; not evidence.' } },
    limits: LIMITS,
    probes: probeResults,
  };
}

module.exports = { STATUS, computeReport, isCurrent };
