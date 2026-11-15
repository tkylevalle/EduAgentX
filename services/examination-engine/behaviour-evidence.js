'use strict';

// The behaviour evidence an assessment carries (target design 4.4): built
// from the episodes the Engine graded, and checked against the form so that a
// stored assessment cannot list other items, skip an objective the exam
// tested, or disagree with the item outcomes it summarises.

const { behaviourEvidence, checkBehaviourEvidence } = require('../../packages/agent-sandbox/src/evidence');
const { EPISODES_PER_ITEM, SANDBOX_GRADER, behaviourObjectives } = require('./behaviour');

const unique = (values) => [...new Set(values)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const behaviourItems = (form) => form.items.filter((item) => item.kind === 'behaviour');
const testedObjectives = (items) => unique(items.flatMap(behaviourObjectives)).sort();

/**
 * @param {{ items: object[] }} form
 * @param {{ episodes: object[] }[]} graded  behaviourGrade output for each behaviour item
 * @returns {object | null} the evidence, or null when the form has no behaviour items
 */
function buildBehaviourEvidence(form, graded) {
  const items = behaviourItems(form);
  if (!items.length) return null;
  return behaviourEvidence({ sandbox: SANDBOX_GRADER, episodesPerItem: EPISODES_PER_ITEM, objectiveIds: testedObjectives(items),
    episodes: graded.flatMap((grade) => grade.episodes) });
}

// One item's episodes: none (unreadable) or one per episode, in family
// rotation order, summarised by its outcome's score and critical rules.
function itemFits(item, episodes, outcome) {
  if (episodes.length !== 0 && episodes.length !== EPISODES_PER_ITEM) return false;
  const families = item.scenarioFamilies;
  if (!episodes.every((episode, index) => episode.scenarioId.split(':')[0] === families[index % families.length])) return false;
  const rules = unique(episodes.flatMap((episode) => episode.criticalViolationRuleIds)).sort();
  const score = rules.length || !episodes.length ? 0
    : Math.round(episodes.reduce((sum, episode) => sum + episode.score, 0) / episodes.length);
  return Boolean(outcome) && Array.isArray(outcome.criticalViolationRuleIds) &&
    same(rules, [...outcome.criticalViolationRuleIds].sort()) && outcome.score === score;
}

/**
 * @param {unknown} evidence  the stored evidence
 * @param {{ items: object[] }} form
 * @param {object[]} itemOutcomes  the stored item outcomes, in form order
 * @returns {boolean} whether the evidence is valid and fits this form and these outcomes
 */
function behaviourEvidenceFits(evidence, form, itemOutcomes) {
  const items = behaviourItems(form);
  if (!items.length) return evidence === null;
  if (!checkBehaviourEvidence(evidence) || evidence.episodesPerItem !== EPISODES_PER_ITEM || !same(evidence.sandbox, SANDBOX_GRADER) ||
    !same(evidence.objectives.map((objective) => objective.objectiveId), testedObjectives(items)) ||
    !evidence.episodes.every((episode) => items.some((item) => item.id === episode.itemId))) return false;
  return items.every((item) => itemFits(item, evidence.episodes.filter((episode) => episode.itemId === item.id),
    itemOutcomes.find((outcome) => outcome?.itemId === item.id)));
}

module.exports = { behaviourEvidenceFits, buildBehaviourEvidence };
