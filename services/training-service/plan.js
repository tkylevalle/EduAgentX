'use strict';

// What a Training Session delivers and when it counts as complete. Pure
// functions over the pinned package payload: no HTTP, no database, no clock.
// A remediation session delivers only the items linked to its targeted
// objectives; a standard session delivers every item.

const ITEM_KINDS = Object.freeze(['lesson', 'practice']);
const POLICY_VERSION = 'training-completion/1';
const DEFAULT_MIN_PRACTICE_PER_MODULE = 1;
const DEFAULT_MAX_RESPONSE_CHARS = 4000;
const MAX_PRACTICE_PER_MODULE_LIMIT = 20;
// Kept well under the 64kb JSON body limit so the cap, not the parser, decides.
const MAX_RESPONSE_CHARS_LIMIT = 16000;
// Sessions created before Issue 13 had no practice rule. schema.sql gives
// their rows this policy, so they finish under the rules they started with.
const LEGACY_POLICY = Object.freeze({
  version: 'training-completion/0', minPracticeItemsPerModule: 0, maxResponseChars: DEFAULT_MAX_RESPONSE_CHARS,
});

// The rules a session is held to. It is pinned on the session when it is
// created, so a later configuration change never alters a running session.
function completionPolicy({
  minPracticeItemsPerModule = DEFAULT_MIN_PRACTICE_PER_MODULE, maxResponseChars = DEFAULT_MAX_RESPONSE_CHARS,
} = {}) {
  if (!Number.isInteger(minPracticeItemsPerModule) || minPracticeItemsPerModule < 0 ||
    minPracticeItemsPerModule > MAX_PRACTICE_PER_MODULE_LIMIT) {
    throw new Error(`minPracticeItemsPerModule must be an integer from 0 to ${MAX_PRACTICE_PER_MODULE_LIMIT}`);
  }
  if (!Number.isInteger(maxResponseChars) || maxResponseChars < 1 || maxResponseChars > MAX_RESPONSE_CHARS_LIMIT) {
    throw new Error(`maxResponseChars must be an integer from 1 to ${MAX_RESPONSE_CHARS_LIMIT}`);
  }
  return { version: POLICY_VERSION, minPracticeItemsPerModule, maxResponseChars };
}

// Reads the policy from the environment once at startup; a bad value stops the service.
function policyFromEnv(env = process.env) {
  const integer = (name) => (env[name] === undefined || env[name] === '' ? undefined : Number(env[name]));
  return completionPolicy({
    minPracticeItemsPerModule: integer('TRAINING_MIN_PRACTICE_PER_MODULE'),
    maxResponseChars: integer('TRAINING_MAX_RESPONSE_CHARS'),
  });
}

// Flattens the package into its delivery order: modules by ascending
// `sequence`, then each module's deliveryItems in array order. Returns null
// when the package cannot be delivered in a well-defined order. An item
// without `kind` is a lesson; an unknown kind makes the package undeliverable.
function deliveryPlan(payload) {
  const modules = payload?.modules;
  if (!Array.isArray(modules) || !modules.length) return null;
  const sequences = new Set();
  for (const module of modules) {
    if (typeof module?.id !== 'string' || !Number.isInteger(module.sequence) || sequences.has(module.sequence) ||
      !Array.isArray(module.deliveryItems) || !module.deliveryItems.length ||
      module.deliveryItems.some((item) => typeof item?.id !== 'string' || typeof item?.text !== 'string' ||
        !ITEM_KINDS.includes(item.kind ?? 'lesson'))) return null;
    sequences.add(module.sequence);
  }
  const objectives = Array.isArray(payload.objectives) ? payload.objectives : [];
  const seen = new Set();
  const items = [];
  for (const module of [...modules].sort((a, b) => a.sequence - b.sequence)) {
    for (const item of module.deliveryItems) {
      // Progress is keyed by item id, so a repeated id would make resume ambiguous.
      if (seen.has(item.id)) return null;
      seen.add(item.id);
      const linked = objectives.filter((o) => Array.isArray(o?.deliveryItemIds) && o.deliveryItemIds.includes(item.id))
        .map((o) => o.id);
      items.push({
        moduleId: module.id, moduleSequence: module.sequence, deliveryItemId: item.id, kind: item.kind ?? 'lesson',
        text: item.text, objectiveIds: linked.length ? linked : [...(module.objectiveIds || [])],
      });
    }
  }
  return numbered(items);
}

const numbered = (items) => items.map((item, index) => ({ ...item, position: index + 1, total: items.length }));

// The items that teach at least one targeted objective, renumbered.
function targetPlan(plan, objectiveIds) {
  const targeted = new Set(objectiveIds);
  return numbered(plan.filter((item) => item.objectiveIds.some((id) => targeted.has(id)))
    .map(({ position, total, ...item }) => item));
}

// The plan for one session: the whole package, or only the remediation targets.
function sessionPlan(payload, session) {
  const plan = deliveryPlan(payload);
  if (!plan || session?.kind !== 'remediation') return plan;
  return targetPlan(plan, session.remediation.objectiveIds);
}

// Modules in the plan that have fewer practice items than the policy needs.
// A session never starts on such a plan, because it could never complete.
function practiceShortfall(plan, policy) {
  return modulesOf(plan).filter((module) => module.practiceItems < policy.minPracticeItemsPerModule)
    .map((module) => module.moduleId);
}

function modulesOf(plan) {
  const modules = new Map();
  for (const item of plan) {
    const module = modules.get(item.moduleId) || { moduleId: item.moduleId, itemIds: [], practiceItems: 0 };
    module.itemIds.push(item.deliveryItemId);
    if (item.kind === 'practice') module.practiceItems += 1;
    modules.set(item.moduleId, module);
  }
  return [...modules.values()];
}

// Completion needs every planned item done and, in every module, at least the
// policy's number of completed practice items. Both are checked, so a plan
// change can never let a session complete on lessons alone.
function completionStatus(plan, completedItemIds, policy) {
  const done = new Set(completedItemIds);
  const practiceDone = (ids) => plan.filter((item) => ids.includes(item.deliveryItemId) &&
    item.kind === 'practice' && done.has(item.deliveryItemId)).length;
  const modules = modulesOf(plan).map((module) => {
    const completedItems = module.itemIds.filter((id) => done.has(id)).length;
    const practiceCompleted = practiceDone(module.itemIds);
    return {
      moduleId: module.moduleId, plannedItems: module.itemIds.length, completedItems, practiceCompleted,
      complete: completedItems === module.itemIds.length && practiceCompleted >= policy.minPracticeItemsPerModule,
    };
  });
  return {
    complete: modules.length > 0 && modules.every((module) => module.complete),
    plannedItems: plan.length,
    completedItems: plan.filter((item) => done.has(item.deliveryItemId)).length,
    practiceCompleted: modules.reduce((sum, module) => sum + module.practiceCompleted, 0),
    modules,
  };
}

// The plan as stored on the session: identities only, never lesson text.
const planSummary = (plan) => plan.map((item) => ({
  deliveryItemId: item.deliveryItemId, moduleId: item.moduleId, moduleSequence: item.moduleSequence,
  kind: item.kind, objectiveIds: [...item.objectiveIds],
}));

// Durable objective-level progress, derived from the stored plan and the
// completed items. Null for sessions created before plans were stored.
function objectiveProgress(storedPlan, completedItemIds) {
  if (!Array.isArray(storedPlan)) return null;
  const done = new Set(completedItemIds);
  const byObjective = new Map();
  for (const item of storedPlan) {
    for (const objectiveId of item.objectiveIds) {
      const entry = byObjective.get(objectiveId) ||
        { objectiveId, plannedItems: 0, completedItems: 0, plannedPractice: 0, completedPractice: 0 };
      entry.plannedItems += 1;
      if (done.has(item.deliveryItemId)) entry.completedItems += 1;
      if (item.kind === 'practice') {
        entry.plannedPractice += 1;
        if (done.has(item.deliveryItemId)) entry.completedPractice += 1;
      }
      byObjective.set(objectiveId, entry);
    }
  }
  return [...byObjective.values()].map((entry) => ({ ...entry, complete: entry.completedItems === entry.plannedItems }));
}

module.exports = {
  DEFAULT_MAX_RESPONSE_CHARS, ITEM_KINDS, LEGACY_POLICY, POLICY_VERSION, completionPolicy, completionStatus, deliveryPlan,
  objectiveProgress, planSummary, policyFromEnv, practiceShortfall, sessionPlan, targetPlan,
};
