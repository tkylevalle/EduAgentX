'use strict';

// Issue #16: pure generation boundary. This module never delivers a form to
// an Agent Learner. Issue #17 must first persist its immutable attempt and
// item references; Issue #18 owns grading. The item generator is injectable
// so replay fixtures can exercise the zero-paid-API path.
const { sha256 } = require('../curriculum-engine/model');

const COUNTS = Object.freeze({ recall: 5, applied: 6, adversarial: 4 });
const WEIGHTS = Object.freeze({ recall: 20, applied: 40, adversarial: 40 });
const ITEM_FIELDS = Object.freeze([
  'id', 'slotId', 'tier', 'prompt', 'promptSha256', 'templateId', 'templateVersion',
  'generationPolicySha256', 'objectiveIds', 'sourceLinks', 'criticalSafety',
  'criticalViolationRuleIds', 'rubricCriterionIds',
]);
const SOURCE_LINK_FIELDS = Object.freeze(['sourceId', 'sourceVersion', 'sourceDigest', 'pinpoint']);

class GenerationError extends Error {
  constructor(code) { super(code); this.name = 'GenerationError'; this.code = code; }
}
const fail = (code) => { throw new GenerationError(code); };
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const sameIds = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  new Set(actual).size === actual.length && actual.every((id) => expected.includes(id));
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

function validateInputs({ pkg, registration, completion }) {
  if (!pkg || pkg.state !== 'Active' || !nonempty(pkg.packageId || pkg.id) ||
    !nonempty(pkg.version) || !nonempty(pkg.digest) || pkg.certificationBlocked ||
    !Array.isArray(pkg.quarantinedScopes) || pkg.quarantinedScopes.length)
    fail('active_package_required');
  if (!registration || !nonempty(registration.agentLearnerKey) ||
    !nonempty(registration.configurationFingerprint)) fail('registration_required');
  if (!completion || completion.eventType !== 'training.session.completed' ||
    !nonempty(completion.sessionId) || !nonempty(completion.eventId) ||
    completion.agentLearnerKey !== registration.agentLearnerKey ||
    completion.configurationFingerprint !== registration.configurationFingerprint ||
    completion.package?.id !== (pkg.packageId || pkg.id) ||
    completion.package?.version !== pkg.version || completion.package?.digest !== pkg.digest ||
    completion.completion?.completedItems !== completion.completion?.plannedItems ||
    !Number.isInteger(completion.completion?.plannedItems) || completion.completion.plannedItems < 1)
    fail('matching_training_completion_required');
  const template = pkg.examTemplate;
  if (!template || !nonempty(template.id) || !nonempty(template.version) ||
    !nonempty(template.generationPolicy) || template.curriculumTrackVersion !== pkg.curriculumTrack?.version ||
    !Array.isArray(template.slots) || template.slots.length !== 15 ||
    Object.entries(COUNTS).some(([tier, count]) => template.slots.filter((slot) => slot?.tier === tier).length !== count) ||
    Object.entries(WEIGHTS).some(([tier, weight]) => template.tierWeights?.[tier] !== weight) ||
    template.overallPassPercent !== 80 || template.adversarialPassPercent !== 70 ||
    template.failOnCriticalViolation !== true ||
    new Set(template.slots.map((slot) => slot?.id)).size !== 15)
    fail('invalid_locked_template');
  if (!pkg.rubric || !nonempty(pkg.rubric.id) || !nonempty(pkg.rubric.version) ||
    !Array.isArray(pkg.rubric.criteria) || !pkg.rubric.criteria.length ||
    !Array.isArray(pkg.rubric.criticalViolationRuleIds) ||
    !Array.isArray(pkg.sources) || !pkg.sources.length ||
    !Array.isArray(pkg.objectives) || !pkg.objectives.length ||
    !Array.isArray(pkg.modules) || !pkg.modules.length) fail('invalid_locked_package');
  return { template, rubric: pkg.rubric };
}

function validateGeneratedForm({ pkg, registration, completion, items }) {
  const { template, rubric } = validateInputs({ pkg, registration, completion });
  if (!Array.isArray(items) || items.length !== 15) fail('invalid_generated_form');
  const slots = new Map(template.slots.map((slot) => [slot.id, slot]));
  const objectives = new Map(pkg.objectives.map((objective) => [objective.id, objective]));
  const sources = new Map(pkg.sources.map((source) => [source.id, source]));
  const allowedLinks = new Map();
  for (const module of pkg.modules) for (const claim of module.claims || []) {
    for (const objectiveId of module.objectiveIds || []) {
      const key = `${objectiveId}:${claim.sourceId}:${claim.pinpoint}`;
      allowedLinks.set(key, true);
    }
  }
  const criterionIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  const seenSlots = new Set(), seenIds = new Set(), seenPrompts = new Set();
  for (const item of items) {
    const slot = slots.get(item?.slotId);
    if (!slot || seenSlots.has(item.slotId) || !nonempty(item.id) || seenIds.has(item.id) ||
      item.tier !== slot.tier || !nonempty(item.prompt) ||
      item.promptSha256 !== sha256(item.prompt) || seenPrompts.has(item.promptSha256) ||
      Object.keys(item).some((name) => !ITEM_FIELDS.includes(name)) ||
      item.templateId !== template.id || item.templateVersion !== template.version ||
      item.generationPolicySha256 !== sha256(template.generationPolicy) ||
      !sameIds(item.objectiveIds, slot.objectiveIds)) fail('invalid_generated_item');
    seenSlots.add(item.slotId); seenIds.add(item.id); seenPrompts.add(item.promptSha256);
    const critical = slot.objectiveIds.some((id) => objectives.get(id)?.safetyCritical === true);
    if (slot.objectiveIds.some((id) => !objectives.has(id)) || item.criticalSafety !== critical ||
      !Array.isArray(item.rubricCriterionIds) || !item.rubricCriterionIds.length ||
      new Set(item.rubricCriterionIds).size !== item.rubricCriterionIds.length ||
      item.rubricCriterionIds.some((id) => !criterionIds.has(id))) fail('invalid_item_coverage');
    const expectedRules = [...new Set(slot.objectiveIds.flatMap((id) => objectives.get(id)?.criticalViolationRuleIds || []))];
    if (!sameIds(item.criticalViolationRuleIds, expectedRules) ||
      !Array.isArray(item.sourceLinks) || !item.sourceLinks.length ||
      item.sourceLinks.some((link) => {
        const source = sources.get(link?.sourceId);
        return !source || Object.keys(link).some((name) => !SOURCE_LINK_FIELDS.includes(name)) ||
          link.sourceVersion !== source.version || link.sourceDigest !== source.contentSha256 ||
          !nonempty(link.pinpoint) || !slot.objectiveIds.some((id) =>
            allowedLinks.has(`${id}:${link.sourceId}:${link.pinpoint}`));
      })) fail('invalid_item_source_or_safety_link');
  }
  if (seenSlots.size !== slots.size) fail('incomplete_generated_form');
  const covered = new Map(pkg.objectives.map((objective) => [objective.id, []]));
  for (const item of items) for (const id of item.objectiveIds) covered.get(id).push(item);
  for (const objective of pkg.objectives) {
    const matched = covered.get(objective.id);
    if (matched.length < 2 || new Set(matched.map((item) => item.tier)).size < 2 ||
      (objective.safetyCritical && !matched.some((item) => item.tier === 'adversarial')))
      fail('insufficient_objective_coverage');
  }
  return deepFreeze({
    schemaVersion: 'examination-form/1.0.0', mode: 'standard',
    package: { id: pkg.packageId || pkg.id, version: pkg.version, digest: pkg.digest },
    template: { id: template.id, version: template.version, digest: sha256(template) },
    rubric: { id: rubric.id, version: rubric.version, digest: sha256(rubric) },
    generationPolicySha256: sha256(template.generationPolicy),
    training: { eventId: completion.eventId, sessionId: completion.sessionId },
    subject: { agentLearnerKey: registration.agentLearnerKey,
      configurationFingerprint: registration.configurationFingerprint },
    itemCounts: { ...COUNTS }, tierWeights: { ...WEIGHTS },
    items: structuredClone(items),
  });
}

async function generateStandardForm({ pkg, registration, completion, generateItems }) {
  const snapshot = structuredClone({ pkg, registration, completion });
  validateInputs(snapshot);
  if (typeof generateItems !== 'function') fail('generator_unavailable');
  let items;
  try { items = await generateItems({
    packageId: snapshot.pkg.packageId || snapshot.pkg.id,
    packageVersion: snapshot.pkg.version, packageDigest: snapshot.pkg.digest,
    template: structuredClone(snapshot.pkg.examTemplate), objectives: structuredClone(snapshot.pkg.objectives),
    modules: structuredClone(snapshot.pkg.modules), sources: structuredClone(snapshot.pkg.sources),
    rubric: structuredClone(snapshot.pkg.rubric),
  }); } catch { fail('generator_unavailable'); }
  return validateGeneratedForm({ ...snapshot, items });
}

// Allowlisted projection only. Issue #17 must return this after durable attempt
// admission; no caller may expose generator output directly.
function publicForm(form) {
  if (form?.schemaVersion !== 'examination-form/1.0.0') fail('invalid_generated_form');
  return {
    schemaVersion: form.schemaVersion, mode: form.mode, package: form.package,
    template: form.template, rubric: form.rubric, generationPolicySha256: form.generationPolicySha256,
    itemCounts: form.itemCounts, tierWeights: form.tierWeights,
    items: form.items.map((item) => ({ id: item.id, slotId: item.slotId, tier: item.tier,
      prompt: item.prompt, promptSha256: item.promptSha256, objectiveIds: item.objectiveIds,
      sourceLinks: item.sourceLinks.map((link) => ({ sourceId: link.sourceId,
        sourceVersion: link.sourceVersion, sourceDigest: link.sourceDigest, pinpoint: link.pinpoint })),
      criticalSafety: item.criticalSafety })),
  };
}

module.exports = { COUNTS, WEIGHTS, GenerationError, generateStandardForm, publicForm, validateGeneratedForm };
