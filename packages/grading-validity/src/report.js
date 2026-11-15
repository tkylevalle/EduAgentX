'use strict';

// The grading validity report. Measures and their limits come from
// docs/blueprint/spec.md ("Acceptance measures"):
//   labelled dataset           >= 100 responses (Floor), >= 150 (Target)
//   pass/fail agreement        >= 85% (Floor), >= 90% (Target)
//   mean score error           <= 8 points (Floor), <= 5 (Target)
//   repeat grading variance    <= 8 points (Floor), <= 5 (Target)
//   mandatory-safety false passes  0 (Invariant)
// The status uses only labels from people: two distinct labellers who agree
// on whether the response is acceptable. The author's provisional labels are
// reported beside it and never decide the status.

const LIMITS = Object.freeze({
  datasetSize: { floor: 100, target: 150, higherIsBetter: true },
  passFailAgreement: { floor: 0.85, target: 0.9, higherIsBetter: true },
  meanScoreError: { floor: 8, target: 5, higherIsBetter: false },
  repeatVariance: { floor: 8, target: 5, higherIsBetter: false },
});
const MIN_LABELLERS = 2;
const SCHEMA_VERSION = 'grading-validity-report/1.0.0';

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value) => (value === null ? null : Math.round(value * 10000) / 10000);

// The consensus of two or more people per response, or 'disputed' when they
// disagree on acceptability. Any labeller's safety violation counts.
function humanConsensus(humanLabels) {
  const byResponse = new Map();
  for (const label of humanLabels) {
    const labels = byResponse.get(label.responseId) || new Map();
    labels.set(label.labeller, label);
    byResponse.set(label.responseId, labels);
  }
  const consensus = new Map();
  for (const [responseId, labels] of byResponse) {
    if (labels.size < MIN_LABELLERS) continue;
    const values = [...labels.values()];
    const acceptable = values.every((label) => label.acceptable) ? true : values.every((label) => !label.acceptable) ? false : 'disputed';
    consensus.set(responseId, acceptable === 'disputed' ? 'disputed' : { acceptable,
      score: mean(values.map((label) => label.score)), safetyViolation: values.some((label) => label.safetyViolation) });
  }
  return consensus;
}

// The grader accepts a response when it scores at least the exam's overall
// pass mark with no critical violation.
function measuresFor(labelled, grades, repeatGrades, acceptPercent) {
  const accepted = (grade) => grade.score >= acceptPercent && grade.criticalViolationRuleIds.length === 0;
  const pairs = labelled.map(({ id, label }) => ({ label, grade: grades.get(id), repeat: repeatGrades.get(id) }));
  return {
    datasetSize: pairs.length,
    passFailAgreement: round(mean(pairs.map(({ label, grade }) => (accepted(grade) === label.acceptable ? 1 : 0)))),
    meanScoreError: round(mean(pairs.map(({ label, grade }) => Math.abs(grade.score - label.score)))),
    repeatVariance: round(mean(pairs.map(({ grade, repeat }) => Math.abs(grade.score - repeat.score)))),
    mandatorySafetyFalsePasses: pairs.filter(({ label, grade }) => label.safetyViolation && grade.criticalViolationRuleIds.length === 0).length,
  };
}

function statusOf(measures) {
  const levels = Object.entries(LIMITS).map(([name, limit]) => {
    const value = measures[name];
    if (value === null) return 'Red';
    const meets = (bound) => (limit.higherIsBetter ? value >= bound : value <= bound);
    return meets(limit.target) ? 'Green' : meets(limit.floor) ? 'Amber' : 'Red';
  });
  if (measures.mandatorySafetyFalsePasses > 0 || levels.includes('Red')) return 'Red';
  return levels.includes('Amber') ? 'Amber' : 'Green';
}

function reasonsFor({ stale, human, humanStatus, probeResults }) {
  return [
    ...(stale.length ? ['dataset_stale'] : []),
    ...(human.datasetSize < LIMITS.datasetSize.floor ? ['human_labels_insufficient'] : []),
    ...(human.mandatorySafetyFalsePasses > 0 ? ['mandatory_safety_false_pass'] : []),
    ...(humanStatus === 'Red' && human.datasetSize >= LIMITS.datasetSize.floor ? ['human_measures_below_floor'] : []),
    ...probeResults.filter((probe) => !probe.holds).map((probe) => `probe_failed:${probe.id}`),
  ];
}

function computeReport({ entries, currentPromptHashes, grades, repeatGrades, humanLabels, probeResults, acceptPercent }) {
  const stale = entries.filter((entry) => currentPromptHashes.get(entry.slotId) !== entry.promptSha256).map((entry) => entry.id);
  const current = entries.filter((entry) => !stale.includes(entry.id));
  const consensus = humanConsensus(humanLabels);
  const human = measuresFor(current.filter((entry) => consensus.has(entry.id) && consensus.get(entry.id) !== 'disputed')
    .map((entry) => ({ id: entry.id, label: consensus.get(entry.id) })), grades, repeatGrades, acceptPercent);
  const provisional = measuresFor(current.map((entry) => ({ id: entry.id, label: entry.provisionalLabel })),
    grades, repeatGrades, acceptPercent);
  const humanStatus = statusOf(human);
  const reasons = reasonsFor({ stale, human, humanStatus, probeResults });
  return {
    schemaVersion: SCHEMA_VERSION,
    status: reasons.length ? 'Red' : humanStatus,
    reasons,
    dataset: { entries: entries.length, stale, humanLabelled: human.datasetSize,
      disputed: [...consensus.values()].filter((value) => value === 'disputed').length },
    measures: { human: { ...human, status: humanStatus },
      provisional: { ...provisional, status: statusOf(provisional), note: 'Author labels; not evidence.' } },
    limits: LIMITS,
    probes: probeResults,
  };
}

module.exports = { LIMITS, MIN_LABELLERS, computeReport };
