'use strict';

// The layered text grader behind POST /v1/item-grades (target design 4.3).
//   Layer 1, deterministic: the critical-phrase check (item-grader.js
//     violatedRules). Authoritative: nothing below can clear what it finds.
//   Layer 4, the rubric judge (judge.js): scores each answer 0-100 against
//     the item and its objective, and names the critical rules the answer
//     violates, including paraphrased or masked violations.
// An item's critical violations are the union of both layers; its score is
// the judge's. A missing, failed or malformed verdict makes the whole request
// ungradeable (GradingUnavailableError): there is no keyword fallback, and the
// Examination Engine aborts the attempt as grading_unavailable.

const { PROMPT_SHA256, PROMPT_VERSION } = require('./judge');
const { createMemoryCache, verdictKey } = require('./verdict-cache');
const { validateItemGradingRequest, violatedRules } = require('./item-grader');

const GRADER_ID = 'rubric-judge';
// The grader code's own version; the judge model and prompt are added to it.
const GRADER_CODE_VERSION = '1.0.0';
// Judge calls in flight for one request. A form has 11 text items (15 at
// most), so 5 judges it in three rounds without sending a whole attempt to
// the provider at once. The Engine's grading-call timeout is sized from
// ceil(15 / JUDGE_CONCURRENCY) rounds of JUDGE_TIMEOUT_MS (grading-client.js).
const JUDGE_CONCURRENCY = 5;
const MAX_RULE_CHARS = 1000;

class GradingUnavailableError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GradingUnavailableError';
    this.code = code;
  }
}

/**
 * The identity a credential records: the version names the judge model and
 * the prompt version and hash, so a change to either is a new grader version.
 * @param {string} model
 * @returns {{ id: string, version: string }}
 */
const graderIdentity = (model) => Object.freeze({ id: GRADER_ID,
  version: `${GRADER_CODE_VERSION}:${model}:prompt-${PROMPT_VERSION}-${PROMPT_SHA256.slice(0, 12)}` });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Each rule id has exactly one definition with text, and nothing else.
function rulesDefined(rubric) {
  const rules = rubric.criticalViolationRules;
  if (!Array.isArray(rules) || rules.length !== rubric.criticalViolationRuleIds.length) return false;
  const byId = new Map(rules.filter(isObject).map((rule) => [rule.id, rule]));
  return byId.size === rules.length && rubric.criticalViolationRuleIds.every((id) => byId.has(id) &&
    typeof byId.get(id).violation === 'string' && byId.get(id).violation.trim().length > 0 &&
    byId.get(id).violation.length <= MAX_RULE_CHARS);
}

/**
 * The shared request checks, plus what the judge needs: each item's prompt
 * and the definition of each critical rule.
 * @param {unknown} body
 * @returns {string[]} the problems; empty when the request can be graded
 */
function validateJudgedRequest(body) {
  const errors = validateItemGradingRequest(body);
  if (errors.length) return errors;
  if (!rulesDefined(body.rubric)) errors.push('rubric.criticalViolationRules');
  body.items.forEach((item, index) => { if (item.prompt === undefined) errors.push(`items[${index}].prompt`); });
  return errors;
}

// Runs task(value) for every value, at most `limit` at once. After a failure
// no new task starts; the running ones settle and the first error is thrown.
async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (failure === null && next < values.length) {
      const index = next++;
      try { results[index] = await task(values[index]); }
      catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  if (failure) throw failure;
  return results;
}

function rationaleOf(identity, verdict, layerOne) {
  const deterministic = layerOne.length ? `deterministic layer matched ${layerOne.join(', ')}` : 'deterministic layer matched no critical rule';
  return `${identity.id}/${identity.version}: judge: ${verdict.rationale.trim()} | ${deterministic}.`;
}

/**
 * @param {{ judge: { model: string, available: boolean, reason: string|null, verdict: (input: object) => Promise<object> },
 *   cache?: { get: Function, set: Function } }} options
 * @returns {{ identity: { id: string, version: string }, gradeItems: (request: object) => Promise<object[]> }}
 */
function createRubricGrader({ judge, cache = createMemoryCache() }) {
  const identity = graderIdentity(judge.model);

  // The cached verdict, or a new one from the judge, which is then cached.
  async function verdictFor(rubric, item) {
    const key = verdictKey({ graderVersion: identity.version, model: judge.model, promptSha256: PROMPT_SHA256, rubric, item });
    const cached = cache.get(key);
    if (cached) return cached;
    // A miss with no judge configured is never answered by inventing a verdict.
    if (!judge.available) throw new GradingUnavailableError(judge.reason || 'judge_not_configured');
    let verdict;
    try {
      verdict = await judge.verdict({ tier: item.tier, prompt: item.prompt, reference: item.reference,
        rules: rubric.criticalViolationRules, response: item.response });
    } catch (error) {
      throw new GradingUnavailableError(typeof error?.code === 'string' && error.code.startsWith('judge_') ? error.code : 'judge_failed');
    }
    cache.set(key, verdict);
    return verdict;
  }

  // Grades a request that validateJudgedRequest accepted.
  async function gradeItems({ rubric, items }) {
    return mapLimit(items, JUDGE_CONCURRENCY, async (item) => {
      const verdict = await verdictFor(rubric, item);
      const layerOne = violatedRules(item.response, rubric.criticalViolationRuleIds);
      const flagged = new Set([...layerOne, ...verdict.criticalViolationRuleIds]);
      return { itemId: item.itemId, score: verdict.score,
        criticalViolationRuleIds: rubric.criticalViolationRuleIds.filter((id) => flagged.has(id)),
        rationale: rationaleOf(identity, verdict, layerOne), citedItemIds: [item.itemId] };
    });
  }

  return { identity, gradeItems };
}

module.exports = { GRADER_ID, JUDGE_CONCURRENCY, GradingUnavailableError, createRubricGrader, graderIdentity, validateJudgedRequest };
