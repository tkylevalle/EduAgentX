'use strict';

// Learning measurement (target design section 5, assurance audit B7): does
// training change measured behaviour? The same held-out behaviour items are
// run repeatedly in arms that differ only in the notes the agent carries: no
// notes, its own notes from training, and control notes from an unrelated
// module. Each arm's episode success rate gets a 95% Wilson interval, and the
// gain between two arms a 95% Newcombe interval. A gain whose interval holds
// zero is reported as no measured gain.
//
// Items are played the way the Examination Engine records them: one action
// at a time against stepEpisode, then graded by behaviourGrade over the
// recorded steps, in held-out worlds seeded per run.

const { randomBytes } = require('node:crypto');
const { actionsResponse, behaviourGrade, episodesOf, stepEpisode } = require('../../../services/examination-engine/behaviour');
const { PASS_SCORE } = require('../../agent-sandbox/src/panel');
const { wilson } = require('../../agent-sandbox/src/stats');

const DECIMALS = 4;
const round = (value) => Number(value.toFixed(DECIMALS));

/**
 * Plays one behaviour item to its end, as the Engine's step route records it.
 * @param {(observation: object) => object | Promise<object>} policy
 * @returns {Promise<{ result: object, episodes: object[] }>} the graded item
 */
async function playItem(attemptId, item, seedKey, policy) {
  const taken = [];
  for (;;) {
    const view = stepEpisode(attemptId, item, taken, seedKey);
    if (view.done) break;
    const action = await policy(view.observation);
    taken.push(action?.finish || !action ? { finish: { message: String(action?.finish?.message ?? '') } } : action);
  }
  return behaviourGrade(attemptId, item, actionsResponse(episodesOf(taken)), seedKey);
}

const succeeded = (episode) => episode.score >= PASS_SCORE && episode.criticalViolationRuleIds.length === 0;

/**
 * @param {{ items: object[] }} form  an exam form; only its behaviour items are played
 * @param {(item: object) => Function} policyFor  the arm's policy for one item
 * @param {number} runs  repeated runs, each a fresh set of worlds
 * @returns {Promise<object>} the arm's episode count, successes, violations and 95% interval
 */
async function runArm({ form, policyFor, runs, seedKey = randomBytes(32).toString('hex') }) {
  const items = form.items.filter((item) => item.kind === 'behaviour');
  const episodes = [];
  for (let run = 0; run < runs; run += 1) {
    const attemptId = `learning-${run}-${randomBytes(6).toString('hex')}`;
    for (const item of items) episodes.push(...(await playItem(attemptId, item, seedKey, policyFor(item))).episodes);
  }
  const successes = episodes.filter(succeeded).length;
  const interval = wilson(successes, episodes.length);
  return { runs, episodes: episodes.length, successes, violations: episodes.filter((e) => e.criticalViolationRuleIds.length).length,
    rate: episodes.length ? round(successes / episodes.length) : 0, low: round(interval.low), high: round(interval.high) };
}

/**
 * Newcombe's hybrid score interval for the difference of two proportions.
 * @param {{ successes: number, episodes: number }} treated @param {{ successes: number, episodes: number }} baseline
 * @returns {{ difference: number, low: number, high: number, measured: boolean }} measured is false when the interval holds zero
 */
function gainOf(treated, baseline) {
  const p1 = treated.episodes ? treated.successes / treated.episodes : 0;
  const p2 = baseline.episodes ? baseline.successes / baseline.episodes : 0;
  const a = wilson(treated.successes, treated.episodes);
  const b = wilson(baseline.successes, baseline.episodes);
  const difference = p1 - p2;
  const low = difference - Math.sqrt((p1 - a.low) ** 2 + (b.high - p2) ** 2);
  const high = difference + Math.sqrt((a.high - p1) ** 2 + (p2 - b.low) ** 2);
  return { difference: round(difference), low: round(low), high: round(high), measured: low > 0 || high < 0 };
}

/**
 * @param {{ form: object, arms: Record<string, (item: object) => Function>, runs: number, baseline?: string, seedKey?: string }} input
 * @returns {Promise<{ arms: Record<string, object>, gains: Record<string, object> }>} every arm, and each arm's gain over the baseline
 */
async function measureLearning({ form, arms, runs, baseline = 'no-notes', seedKey }) {
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError('runs must be a positive integer');
  if (!arms[baseline]) throw new RangeError(`no baseline arm ${baseline}`);
  const results = {};
  for (const [name, policyFor] of Object.entries(arms)) results[name] = await runArm({ form, policyFor, runs, seedKey });
  const gains = Object.fromEntries(Object.keys(arms).filter((name) => name !== baseline)
    .map((name) => [name, gainOf(results[name], results[baseline])]));
  return { baseline, arms: results, gains };
}

module.exports = { gainOf, measureLearning, playItem, runArm };
