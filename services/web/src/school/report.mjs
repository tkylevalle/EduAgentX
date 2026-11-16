// What the school's panels show, worked out from platform records. A record
// that did not load gives null ("unknown"); nothing here supplies a default.

/** The three parts of the exam, in the school's words. */
export const TIERS = Object.freeze([
  { id: 'recall', name: 'Knowledge' },
  { id: 'applied', name: 'Applied' },
  { id: 'adversarial', name: 'Under attack' },
]);

const STOP_COPY = {
  run_in_progress: 'Another run is in progress',
  stream_ended: 'The connection closed before the run finished',
};

/** A stop code from the platform, in plain words. An unknown code is shown as it is. */
export const stopReason = (code) => STOP_COPY[code] || String(code || 'unknown').replaceAll('_', ' ');

/**
 * The exam paper: how many questions each part has, and its pass line.
 * @returns {Array<{ id: string, name: string, slots: number, line: number|null }>}
 */
export function paperOf(pkg) {
  const slots = pkg?.exam?.slots;
  if (!slots) return [];
  return TIERS.map((tier) => ({
    ...tier,
    slots: slots.filter((slot) => slot.tier === tier.id).length,
    line: tier.id === 'adversarial' ? pkg.exam.adversarialPassPercent ?? null : null,
  }));
}

/**
 * One exam attempt as a report card.
 * @param {object|null} attempt the examination record
 * @param {object|null} remediation the remediation trace of the same attempt
 * @param {object|null} pkg the course, for objective wording and pass lines
 */
export function reportOf(attempt, remediation, pkg) {
  const result = attempt?.assessment;
  if (!result) return null;
  const objectiveOf = (id) => pkg?.objectives?.find((entry) => entry.id === id);
  const objectives = (result.objectiveOutcomes || []).map((outcome) => ({
    id: outcome.objectiveId, percent: outcome.percent, passed: outcome.passed === true,
    statement: objectiveOf(outcome.objectiveId)?.statement || outcome.objectiveId,
    safetyCritical: objectiveOf(outcome.objectiveId)?.safetyCritical === true,
  }));
  const trace = remediation?.trace;
  const episodes = result.behaviour?.allEpisodes;
  return {
    passed: result.passed === true,
    overall: result.overallPercent,
    overallLine: pkg?.exam?.overallPassPercent ?? null,
    tiers: TIERS.map((tier) => ({ ...tier, percent: result.tierPercents?.[tier.id] ?? null,
      line: tier.id === 'adversarial' ? pkg?.exam?.adversarialPassPercent ?? null : null })),
    strengths: objectives.filter((entry) => entry.passed),
    weaknesses: objectives.filter((entry) => !entry.passed),
    items: (result.itemOutcomes || []).map((item) => ({ id: item.itemId, tier: item.tier, score: item.score,
      malformed: item.malformed === true, critical: (item.criticalViolationRuleIds || []).length > 0 })),
    rules: result.criticalViolationRuleIds || [],
    reasons: result.failureReasons || [],
    sandbox: episodes ? { episodes: episodes.episodes, violations: episodes.violations } : null,
    catchUp: result.passed === true || !trace?.gap ? null : {
      objectives: (trace.gap.objectiveIds || []).map((id) => objectiveOf(id)?.statement || id),
      sessionId: trace.remediation?.delivery?.trainingSessionId || null,
    },
  };
}

/** The school's counters, from the credential list and the overview. */
export function schoolNumbers(overview, credentials) {
  return {
    diplomas: credentials ? credentials.length : null,
    inGoodStanding: credentials ? credentials.filter((entry) => entry.status === 'active').length : null,
    classes: overview?.training?.counts?.completed ?? null,
    catchUp: overview?.training?.byKind?.remediation?.completed ?? null,
    signingMs: overview?.issuanceKpi?.p95Ms ?? null,
  };
}
