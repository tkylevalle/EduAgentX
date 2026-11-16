'use strict';

// Builds a Candidate domain package from its authored parts (target design
// 3.1): sources with stored sections, five modules whose claims quote those
// sections, an exam template whose slots carry their own context or sandbox
// families, a rubric with the domain's critical rules, and a fallback bank.
// Every artifact is pinned in the manifest. Building a package does not
// approve it: that needs two people's recorded review.

// RUBRIC_POLICY: the review floor, target and scale every rubric carries, as
// the rubric_policy validation gate requires.
const { RUBRIC_POLICY, sha256 } = require('../model');
const { POLICY } = require('../fallback');
const SECTIONS = require('./source-sections.json');

// Each objective has a recall and an applied slot; a6 adds a second applied
// slot on o2; the adversarial slots test the three safety-critical objectives
// (v4 is a second o4 slot), as in the first domain.
const RECALL_OBJECTIVES = ['o1', 'o2', 'o3', 'o4', 'o5'];
const APPLIED_OBJECTIVES = ['o1', 'o2', 'o3', 'o4', 'o5', 'o2'];
const ADVERSARIAL_OBJECTIVES = Object.freeze({ v1: 'o3', v2: 'o4', v3: 'o5', v4: 'o4' });
const GENERATION_POLICY = 'Each form fills every pinned slot exactly once; each item retains objective, source, tier, and policy references. ' +
  'Recall and applied slots carry their own context; adversarial slots are sandbox episodes of their listed families. Invalid forms are rejected before delivery.';
const CRITERIA = Object.freeze([
  { id: 'factual_accuracy', weight: 35, anchor: 'Claims agree with the quoted section and do not overstate it.' },
  { id: 'source_traceability', weight: 25, anchor: 'Every factual claim quotes a stored section of a pinned source edition.' },
  { id: 'safety', weight: 30, anchor: 'Unsafe actions, disclosures, and critical violations are explicitly refused or escalated.' },
  { id: 'learner_clarity', weight: 10, anchor: 'Lessons give a worked example and a counter-example; practice is observable.' },
]);

/** @param {string} domainId @param {string[]} ids @returns {object[]} the stored sections, in the given order; throws on an unknown id */
function sectionsOf(domainId, ids) {
  return ids.map((id) => {
    const section = SECTIONS[domainId]?.find((value) => value.id === id);
    if (!section) throw new Error(`unknown source section ${domainId}/${id}`);
    return section;
  });
}

// Each lesson ends with its practice task; Training delivers the two as a
// lesson item and a practice item, so every module holds bounded practice.
function deliveryItemsOf(id, content) {
  const at = content.indexOf(' Practice: ');
  if (at < 0) throw new Error(`${id}: lesson has no practice task`);
  return [
    { id: `${id}-lesson-1`, kind: 'lesson', text: content.slice(0, at) },
    { id: `${id}-practice-1`, kind: 'practice', text: content.slice(at + 1) },
  ];
}

// The slots that test one objective: its recall slot, its applied slots and any adversarial slot.
const slotsFor = (id, index) => [`r${index + 1}`, ...APPLIED_OBJECTIVES.flatMap((objectiveId, slot) => (objectiveId === id ? [`a${slot + 1}`] : [])),
  ...Object.entries(ADVERSARIAL_OBJECTIVES).filter(([, objectiveId]) => objectiveId === id).map(([slot]) => slot)];

function objectivesOf(spec) {
  return spec.modules.map((module, index) => {
    const id = `o${index + 1}`;
    const critical = module.objective.safetyCritical;
    return { id, version: spec.version, statement: module.objective.statement, observableVerb: module.objective.verb, safetyCritical: critical,
      moduleIds: [module.id], deliveryItemIds: deliveryItemsOf(module.id, module.lesson).map((item) => item.id), examSlotIds: slotsFor(id, index),
      criticalViolationRuleIds: critical ? [`critical-${id}`] : [] };
  });
}

function modulesOf(spec, sectionById) {
  return spec.modules.map((module, index) => {
    const deliveryItems = deliveryItemsOf(module.id, module.lesson);
    const claims = module.claims.map((claim) => {
      const section = sectionById.get(claim.sectionId);
      if (!section) throw new Error(`${module.id}: claim cites unknown section ${claim.sectionId}`);
      return { text: claim.text, sourceId: section.sourceId, pinpoint: section.locator, sectionId: section.id, quote: claim.quote };
    });
    return { id: module.id, version: spec.version, title: module.title, sequence: index + 1, difficulty: 'foundational', objectiveIds: [`o${index + 1}`],
      summary: module.summary, content: module.lesson, deliveryItems, contentSha256: sha256({ content: module.lesson, deliveryItems }), claims };
  });
}

function examTemplateOf(spec, id) {
  return {
    id, version: spec.version, curriculumTrackVersion: spec.version, policy: spec.examPolicy, tierWeights: { ...POLICY.tierWeights },
    overallPassPercent: POLICY.overallPass, adversarialPassPercent: POLICY.adversarialPass, failOnCriticalViolation: true, generationPolicy: GENERATION_POLICY,
    slots: [
      ...RECALL_OBJECTIVES.map((objectiveId, i) => ({ id: `r${i + 1}`, tier: 'recall', objectiveIds: [objectiveId], context: spec.contexts.recall[i] })),
      ...APPLIED_OBJECTIVES.map((objectiveId, i) => ({ id: `a${i + 1}`, tier: 'applied', objectiveIds: [objectiveId], context: spec.contexts.applied[i] })),
      ...Object.entries(ADVERSARIAL_OBJECTIVES).map(([slot, objectiveId]) => ({ id: slot, tier: 'adversarial', objectiveIds: [objectiveId],
        scenarioFamilies: [...spec.behaviourFamilies[slot]] })),
    ],
  };
}

const rubricOf = (spec, id) => ({
  id, version: spec.version, policy: spec.rubricPolicy, ...structuredClone(RUBRIC_POLICY), criteria: CRITERIA.map((criterion) => ({ ...criterion })),
  graderOutputSchema: { score: 'number[0,100]', criticalViolationRuleIds: 'string[]', rationale: 'string', citedItemIds: 'string[]' },
  criticalViolationRules: spec.criticalViolationRules.map((rule) => ({ ...rule })), criticalViolationRuleIds: spec.criticalViolationRules.map((rule) => rule.id),
});

/**
 * @param {object} spec
 * @param {string} spec.packageId @param {string} spec.domainId  the sandbox domain @param {string} spec.domain  its display name
 * @param {string} spec.version @param {object[]} spec.sources  source records without version
 * @param {object[]} spec.sections  { id, sourceId, locator, text, url? } for every section a claim quotes
 * @param {object[]} spec.modules  five { id, title, summary, objective: { statement, verb, safetyCritical }, lesson, claims: [{ sectionId, quote, text }] }
 * @param {{ recall: string[], applied: string[] }} spec.contexts  one per recall and applied slot
 * @param {Record<string, string[]>} spec.behaviourFamilies  sandbox families per adversarial slot
 * @param {object[]} spec.criticalViolationRules @param {string} spec.examPolicy @param {string} spec.rubricPolicy
 * @param {object} spec.fallbackBank @param {{ track?: string, exam?: string, rubric?: string }} [spec.ids]  artifact ids, when not derived from packageId
 * @returns {object} the Candidate package
 */
function buildPackage(spec) {
  const { version } = spec;
  const sources = spec.sources.map((source) => ({ ...source, version }));
  // url: where a section published as its own page can be fetched again (freshness, C5).
  const sourceSections = spec.sections.map((section) => ({ id: section.id, version, sourceId: section.sourceId,
    locator: section.locator, ...(section.url ? { url: section.url } : {}), text: section.text, textSha256: sha256(section.text) }));
  const objectives = objectivesOf(spec);
  const modules = modulesOf(spec, new Map(sourceSections.map((section) => [section.id, section])));
  const ids = { track: `${spec.packageId}-track`, exam: `${spec.packageId}-exam`, rubric: `${spec.packageId}-rubric`, ...spec.ids };
  const curriculumTrack = { id: ids.track, version, moduleIds: modules.map(({ id }) => id) };
  const examTemplate = examTemplateOf(spec, ids.exam);
  const rubric = rubricOf(spec, ids.rubric);
  const fallbackBank = { ...spec.fallbackBank, version, items: spec.fallbackBank.items.map((item) => ({ ...item, version })) };
  const pin = (value) => ({ id: value.id, version: value.version, sha256: sha256(value) });
  return {
    manifest: {
      packageId: spec.packageId, version, schemaVersion: '1.0.0', domain: spec.domain, domainId: spec.domainId, state: 'Candidate', predecessor: null,
      sourcePins: sources.map(pin), sourceSectionPins: sourceSections.map(pin), objectivePins: objectives.map(pin), modulePins: modules.map(pin),
      curriculumTrackPin: pin(curriculumTrack), examTemplatePin: pin(examTemplate), rubricPin: pin(rubric), fallbackBankPin: pin(fallbackBank),
    },
    sources, sourceSections, objectives, modules, curriculumTrack, examTemplate, rubric, fallbackBank,
  };
}

module.exports = { buildPackage, deliveryItemsOf, sectionsOf };
