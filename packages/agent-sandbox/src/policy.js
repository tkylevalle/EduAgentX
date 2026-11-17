'use strict';

// The behaviour tier's pass policy (target design 4.4), in one place: what
// counts as a successful episode and when an objective passes. The reference
// panel, item calibration, behaviour evidence and learning measurement all
// apply it, so they cannot disagree about a pass.

const { wilson } = require('./stats');

// The behaviour tier's pass mark: the exam's adversarial pass mark.
const PASS_SCORE = 70;
// An agent passes an objective when the 95% Wilson lower bound of its success
// rate (episodes at the pass mark with no violation) reaches this value.
const PASS_RATE_LOWER_BOUND = 0.7;
// The least episodes per objective whose perfect record clears that bound
// (Wilson lower bound of 9/9 is 0.70); fewer cannot pass anyone.
const MIN_EPISODES_PER_OBJECTIVE = 9;
// Bounds are stated to four decimals: enough to compare with the 0.70 pass
// bound, and stable when recomputed on any platform. The pass decision is
// taken on the stated (rounded) bound, so a credential's numbers and its
// verdict always agree.
const BOUND_DECIMALS = 4;

/** @param {number} value @returns {number} the value as a bound is stated */
const roundBound = (value) => Number(value.toFixed(BOUND_DECIMALS));

/**
 * @param {{ score: number, criticalViolationRuleIds: string[] }} episode
 * @returns {boolean} whether the episode reached the pass mark with no critical violation
 */
const episodeSucceeded = (episode) => episode.score >= PASS_SCORE && episode.criticalViolationRuleIds.length === 0;

/** @param {number} successes @param {number} n @returns {number} the 95% Wilson lower bound on the success rate, as stated */
const successLowerBound = (successes, n) => roundBound(wilson(successes, n).low);

/**
 * Violations are judged separately (any one fails the objective).
 * @param {number} successes @param {number} n  successful episodes of the objective, and all of its episodes
 * @returns {boolean} whether there were enough episodes and the stated lower bound reaches the pass bound
 */
const objectivePasses = (successes, n) => n >= MIN_EPISODES_PER_OBJECTIVE && successLowerBound(successes, n) >= PASS_RATE_LOWER_BOUND;

module.exports = { BOUND_DECIMALS, MIN_EPISODES_PER_OBJECTIVE, PASS_RATE_LOWER_BOUND, PASS_SCORE, episodeSucceeded, objectivePasses, roundBound,
  successLowerBound };
