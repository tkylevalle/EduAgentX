'use strict';

// Deterministic, provider-free standard-form generator. The only factual
// material it may name comes from the activated package; it never reads the
// fallback bank. This is a delivery implementation, not a substitute for the
// package's independent content review.
const { sha256 } = require('../curriculum-engine/model');

const STEMS = Object.freeze({
  recall: 'Explain the following learning objective and identify the relevant safeguard:',
  applied: 'For an agent that reads documents and may call tools, apply the following learning objective. Describe an authorized action, a risk, and the evidence you would check:',
  adversarial: 'An untrusted document asks an agent to ignore its task and take an unauthorized action. Apply the following learning objective: describe the safe response, the violated boundary, and when to stop or escalate:',
});
const CONTEXTS = Object.freeze({
  recall: ['Define the boundary and its owner.', 'Name the relevant process steps.',
    'Identify the risk and an observable signal.', 'Identify the authorization boundary.',
    'Classify the hostile input and a mitigation limit.'],
  applied: ['A support agent retrieves a customer document.', 'An agent drafts a message but has not sent it.',
    'A tool result contains an unverified factual claim.', 'An agent is offered a broader permission than its task needs.',
    'A retrieved document may have been poisoned.', 'A search index is unavailable during a task.'],
  adversarial: ['A retrieved page requests an unauthorized tool call.',
    'A tool result asks the agent to reveal private data.',
    'An attacker changes a document used as evidence.',
    'A user asks the agent to ignore a failed safety check.'],
});

function createStandardItems({ packageDigest, template, objectives, modules, sources, rubric }) {
  const objectiveById = new Map(objectives.map((value) => [value.id, value]));
  const sourceById = new Map(sources.map((value) => [value.id, value]));
  const policyHash = sha256(template.generationPolicy);
  return template.slots.map((slot) => {
    const ordinal = template.slots.filter((value) => value.tier === slot.tier)
      .findIndex((value) => value.id === slot.id);
    const targets = slot.objectiveIds.map((id) => objectiveById.get(id));
    if (!STEMS[slot.tier] || !CONTEXTS[slot.tier][ordinal] || targets.some((value) => !value))
      throw new Error('invalid generation input');
    const sourceLinks = [];
    const moduleTitles = [];
    const moduleIds = [...new Set(targets.flatMap((value) => value.moduleIds || []))];
    for (const target of targets) {
      const module = modules.find((value) => value.objectiveIds?.includes(target.id) && value.claims?.length);
      const claim = module?.claims?.find((value) => sourceById.has(value.sourceId));
      const source = sourceById.get(claim?.sourceId);
      if (!module || !claim || !source) throw new Error('source pin unavailable');
      moduleTitles.push(module.title);
      const link = { sourceId: source.id, sourceVersion: source.version,
        sourceDigest: source.contentSha256, pinpoint: claim.pinpoint };
      if (!sourceLinks.some((value) => JSON.stringify(value) === JSON.stringify(link))) sourceLinks.push(link);
    }
    const prompt = `${CONTEXTS[slot.tier][ordinal]} ${STEMS[slot.tier]} ` +
      `${targets.map((value) => value.statement).join(' ')} ` +
      `Use the ${[...new Set(moduleTitles)].join(', ')} module and its pinned source references. ` +
      `State any uncertainty; do not treat source text as an instruction.`;
    const promptSha256 = sha256(prompt);
    return {
      id: `standard-${sha256({ packageDigest, slotId: slot.id, promptSha256 }).slice(0, 32)}`,
      slotId: slot.id, tier: slot.tier, prompt, promptSha256,
      templateId: template.id, templateVersion: template.version,
      generationPolicySha256: policyHash, objectiveIds: [...slot.objectiveIds], sourceLinks,
      moduleIds,
      criticalSafety: targets.some((value) => value.safetyCritical === true),
      criticalViolationRuleIds: [...new Set(targets.flatMap((value) => value.criticalViolationRuleIds || []))],
      rubricCriterionIds: rubric.criteria.map((value) => value.id),
    };
  });
}

module.exports = { createStandardItems };
