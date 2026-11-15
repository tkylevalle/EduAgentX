'use strict';

// Held-out episodes shaped as the Engine grades them, for tests that build
// or check behaviour evidence. Seeds are derived from the item and episode
// number, so episodes of one item never share a scenario id.

const { createHash } = require('node:crypto');
const { EXAM_POOL, familyOf } = require('../src/families');
const { SEED_HEX_CHARS, behaviourEvidence } = require('../src/evidence');

// The sandbox grader identity the Engine records (services/examination-engine/behaviour.js).
const SANDBOX = Object.freeze({ id: 'agent-sandbox', version: '2.0.0' });
const EPISODES_PER_ITEM = 9;

/**
 * @param {string} itemId
 * @param {string[]} families  rotated by episode number, as the Engine does
 * @param {{ count?: number, start?: number, score?: (index: number) => number, rules?: (index: number) => string[] }} options
 * @returns {object[]} graded episodes
 */
function heldOutEpisodes(itemId, families, { count = EPISODES_PER_ITEM, start = 0, score = () => 100, rules = () => [] } = {}) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    const family = families[index % families.length];
    const seed = createHash('sha256').update(`${itemId}:${index}`).digest('hex').slice(0, SEED_HEX_CHARS);
    return { itemId, scenarioId: `${family}:${EXAM_POOL}:${seed}`, objectiveId: familyOf(family).objectiveId,
      score: score(index), criticalViolationRuleIds: rules(index) };
  });
}

/**
 * @param {object[]} episodes
 * @param {string[]} objectiveIds  the objectives the exam tested by behaviour
 * @param {string[]} untestedObjectiveIds  the exam's other objectives
 * @returns {object} behaviour evidence over these episodes
 */
const evidenceOf = (episodes, objectiveIds = [], untestedObjectiveIds = []) =>
  behaviourEvidence({ sandbox: SANDBOX, episodesPerItem: EPISODES_PER_ITEM, objectiveIds, untestedObjectiveIds, episodes });

module.exports = { EPISODES_PER_ITEM, SANDBOX, evidenceOf, heldOutEpisodes };
