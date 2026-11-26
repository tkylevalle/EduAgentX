'use strict';

// Rubric-judge verdicts by input. A judge at temperature 0 can still vary
// between calls, so a verdict is kept and reused: the same answer to the same
// item under the same judge, prompt and rubric gets the same verdict, and a
// retried grading request does not pay for items already judged.

const { createHash } = require('node:crypto');

// About 1 KB per verdict (a rationale of at most 1,000 characters), so the
// cache stays near 10 MB, well inside the service's 256 MB container limit.
const MAX_CACHED_VERDICTS = 10_000;

/**
 * The sha256 of everything the judge sees and everything that names it. The
 * item id is left out: the same answer to the same item is the same input.
 * @param {{ graderVersion: string, model: string, promptSha256: string,
 *   rubric: { id: string, version: string, criticalViolationRules: { id: string, violation: string }[] },
 *   item: { tier: string, prompt: string, reference: string, response: string } }} input
 * @returns {string} 64 hex characters
 */
function verdictKey({ graderVersion, model, promptSha256, rubric, item }) {
  const judged = [graderVersion, model, promptSha256, rubric.id, rubric.version,
    rubric.criticalViolationRules.map((rule) => [rule.id, rule.violation]),
    item.tier, item.prompt, item.reference, item.response];
  return createHash('sha256').update(JSON.stringify(judged)).digest('hex');
}

/**
 * A bounded in-memory cache; the oldest verdict is dropped first.
 * @param {{ entries?: Record<string, object>, maxEntries?: number }} options  entries: verdicts to start with
 * @returns {{ get: (key: string) => object|undefined, set: (key: string, verdict: object) => void,
 *   entries: () => Record<string, object> }}
 */
function createMemoryCache({ entries = {}, maxEntries = MAX_CACHED_VERDICTS } = {}) {
  const verdicts = new Map(Object.entries(entries).map(([key, verdict]) => [key, structuredClone(verdict)]));
  return {
    get: (key) => (verdicts.has(key) ? structuredClone(verdicts.get(key)) : undefined),
    set(key, verdict) {
      verdicts.delete(key);
      verdicts.set(key, structuredClone(verdict));
      while (verdicts.size > maxEntries) verdicts.delete(verdicts.keys().next().value);
    },
    entries: () => Object.fromEntries([...verdicts].map(([key, verdict]) => [key, structuredClone(verdict)])),
  };
}

module.exports = { MAX_CACHED_VERDICTS, createMemoryCache, verdictKey };
