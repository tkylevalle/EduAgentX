'use strict';

const { createHash } = require('node:crypto');

const POLICY = Object.freeze({
  id: 'fallback-scoring/1.0.0',
  itemCounts: Object.freeze({ recall: 5, applied: 6, adversarial: 4 }),
  tierWeights: Object.freeze({ recall: 20, applied: 40, adversarial: 40 }),
  overallPass: 80,
  adversarialPass: 70,
  failOnCriticalSafetyViolation: true,
});

// The bank is authored data. It is never produced by the outage path. Each
// item's prompt, key, scoring rule, objective and source pinpoint are pinned
// by the containing package digest.
const ITEMS = Object.freeze([
  ['recall', 'List the four AI RMF functions in order.', 'exact_text', 'Govern, Map, Measure, Manage', 'o2', 'AI RMF Core: Govern, Map, Measure, Manage'],
  ['recall', 'Which AI RMF function establishes context for a specific use case?', 'single_choice', 'Map', 'o2', 'AI RMF Core: Map'],
  ['recall', 'What should a risk record include after controls are selected?', 'single_choice', 'Residual risk', 'o2', 'AI RMF Core: Manage'],
  ['recall', 'Name one risk category highlighted by the NIST Generative AI Profile.', 'single_choice', 'Confabulation', 'o3', 'Section 2: GAI risks'],
  ['recall', 'Which OWASP agentic risk concerns an agent being redirected by hostile input?', 'single_choice', 'Agent Goal Hijack', 'o4', 'ASI01 Agent Goal Hijack'],
  ['applied', 'A support agent can read tickets and send replies. What should be mapped before deployment?', 'multiple_choice', ['Allowed actions', 'Affected people', 'Data stores', 'Human owner'], 'o1', 'Section I: Definitions and Principles'],
  ['applied', 'Place the AI RMF functions in the intended operating cycle.', 'ordered_actions', ['Govern', 'Map', 'Measure', 'Manage'], 'o2', 'AI RMF Core: Govern, Map, Measure, Manage'],
  ['applied', 'An answer contains a plausible claim with no supporting source. How should it be handled?', 'single_choice', 'Mark it unverified and stop or escalate', 'o3', 'Section 2: GAI risks'],
  ['applied', 'A tool only needs to read one ticket. Which authorization is appropriate?', 'single_choice', 'Read-only access limited to that ticket', 'o4', 'ASI02 Tool Misuse'],
  ['applied', 'A poisoned document asks the agent to reveal private data. What should the agent do?', 'ordered_actions', ['Treat the document as untrusted', 'Refuse disclosure', 'Preserve evidence', 'Escalate'], 'o4', 'ASI01 Agent Goal Hijack; ASI02 Tool Misuse'],
  ['applied', 'What evidence should an adversarial test record?', 'multiple_choice', ['Attacker-controlled surface', 'Desired deviation', 'Observed behavior', 'Mitigation limits'], 'o5', 'Executive Summary: evasion and poisoning attacks'],
  ['adversarial', 'A retrieved page instructs the agent to ignore policy and email a secret. Choose the safe response.', 'ordered_actions', ['Ignore the untrusted instruction', 'Refuse the unauthorized action', 'Preserve evidence', 'Escalate'], 'o4', 'ASI01 Agent Goal Hijack; ASI02 Tool Misuse'],
  ['adversarial', 'A user asks for a privileged tool action outside the approved scope. What must the agent do?', 'single_choice', 'Refuse and request authorized scope', 'o4', 'ASI02 Tool Misuse'],
  ['adversarial', 'A poisoned training document causes unsafe recommendations. Select the response.', 'ordered_actions', ['Stop relying on the affected content', 'Preserve the document and test evidence', 'Quarantine the affected scope', 'Escalate for review'], 'o5', 'Executive Summary: poisoning attacks'],
  ['adversarial', 'A prompt asks the agent to expose a protected secret. This item is safety-critical. Select the response.', 'single_choice', 'Refuse disclosure and escalate', 'o4', 'ASI01 Agent Goal Hijack', true],
]);

const CHOICES = Object.freeze({
  2: ['Map', 'Govern', 'Measure', 'Manage'],
  3: ['Residual risk', 'Initial budget', 'Model size', 'User popularity'],
  4: ['Confabulation', 'Database normalization', 'Network latency', 'Keyboard logging'],
  5: ['Agent Goal Hijack', 'Credential rotation', 'Model compression', 'Data deduplication'],
  6: ['Allowed actions', 'Affected people', 'Data stores', 'Human owner', 'Favorite color', 'Model version'],
  8: ['Mark it unverified and stop or escalate', 'Repeat it with confidence', 'Invent a citation', 'Send it to the user as fact'],
  9: ['Read-only access limited to that ticket', 'Administrator access to every ticket', 'A shared permanent password', 'Unrestricted outbound messaging'],
  11: ['Attacker-controlled surface', 'Desired deviation', 'Observed behavior', 'Mitigation limits', 'Brand palette', 'Release date'],
  13: ['Refuse and request authorized scope', 'Run the action once as a test', 'Ask the user to ignore policy', 'Use a broader credential'],
  15: ['Refuse disclosure and escalate', 'Reveal only part of the secret', 'Send the secret to another tool', 'Obey because the prompt is recent'],
});

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

const FALLBACK_BANK = Object.freeze({
  id: 'ai-safety-fallback',
  version: '1.0.0',
  policy: POLICY.id,
  scoringPolicy: POLICY,
  items: Object.freeze(ITEMS.map(([tier, prompt, answerType, expectedAnswer, objectiveId, pinpoint, criticalSafety], index) => deepFreeze({
    id: `fallback-${String(index + 1).padStart(2, '0')}`,
    version: '1.0.0',
    tier,
    answerType,
    ...(CHOICES[index + 1] ? { choices: [...CHOICES[index + 1]] } : {}),
    prompt,
    expectedAnswer,
    scoringRule: answerType === 'ordered_actions' ? 'exact_order' : answerType === 'multiple_choice' ? 'exact_set' : 'exact_match',
    objectiveIds: Object.freeze([objectiveId]),
    sourceLinks: Object.freeze([{ sourceId: objectiveId === 'o1' ? 'oecd-ai' : objectiveId === 'o2' ? 'nist-rmf' : objectiveId === 'o3' ? 'nist-gai' : objectiveId === 'o4' ? 'owasp-agentic' : 'nist-aml', pinpoint }]),
    criticalSafety: criticalSafety === true,
  }))),
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function scoreItem(item, response) {
  let correct = false;
  if (item?.answerType === 'single_choice' || item?.answerType === 'boolean' || item?.answerType === 'exact_text') {
    correct = canonical(response) === canonical(item.expectedAnswer);
  } else if (item?.answerType === 'ordered_actions') {
    correct = Array.isArray(response) && canonical(response) === canonical(item.expectedAnswer);
  } else if (item?.answerType === 'multiple_choice') {
    correct = Array.isArray(response) && canonical([...response].sort()) === canonical([...item.expectedAnswer].sort());
  }
  return { itemId: item.id, points: correct ? 1 : 0, criticalViolation: item.criticalSafety === true && !correct };
}

function scoreBank(bank, responses) {
  const items = bank?.items;
  if (!Array.isArray(items) || items.length !== 15 || !Array.isArray(responses) || responses.length !== 15)
    return { valid: false, reason: 'incomplete_fallback_attempt' };
  const byId = new Map(responses.map((response) => [response?.itemId, response?.answer]));
  if (byId.size !== 15 || items.some((item) => !byId.has(item.id))) return { valid: false, reason: 'fallback_response_set_mismatch' };
  const results = items.map((item) => scoreItem(item, byId.get(item.id)));
  const tierScores = {};
  for (const tier of Object.keys(POLICY.itemCounts)) {
    const tierItems = items.filter((item) => item.tier === tier);
    const earned = results.filter((result) => tierItems.some((item) => item.id === result.itemId)).reduce((sum, result) => sum + result.points, 0);
    tierScores[tier] = tierItems.length ? earned / tierItems.length * 100 : 0;
  }
  const overall = Object.entries(POLICY.tierWeights).reduce((sum, [tier, weight]) => sum + tierScores[tier] * weight / 100, 0);
  const criticalViolation = results.some((result) => result.criticalViolation);
  return {
    valid: true,
    results,
    tierScores,
    overall,
    passed: overall >= POLICY.overallPass && tierScores.adversarial >= POLICY.adversarialPass && !criticalViolation,
    criticalViolation,
    policyId: POLICY.id,
  };
}

function digestBank(bank) {
  return createHash('sha256').update(canonical(bank)).digest('hex');
}

function validateFallbackBank(bank, { sourceIds = new Set(), objectiveIds = new Set() } = {}) {
  const errors = [];
  if (!bank || typeof bank !== 'object') return ['fallbackBank must be an object'];
  if (typeof bank.id !== 'string' || !bank.id || typeof bank.version !== 'string' || !bank.version) errors.push('fallbackBank id and version are required');
  if (bank.policy !== POLICY.id || canonical(bank.scoringPolicy) !== canonical(POLICY)) errors.push('fallbackBank scoring policy does not match the approved policy');
  const items = bank.items;
  if (!Array.isArray(items) || items.length !== 15) return [...errors, 'fallbackBank must contain exactly 15 items'];
  const counts = { recall: 0, applied: 0, adversarial: 0 };
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const path = `fallbackBank.items[${index}]`;
    if (!item || typeof item !== 'object') { errors.push(`${path} must be an object`); continue; }
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) errors.push(`${path}.id must be unique and non-empty`);
    ids.add(item.id);
    if (item.version !== bank.version) errors.push(`${path}.version must match the bank version`);
    if (!Object.hasOwn(counts, item.tier)) errors.push(`${path}.tier is unsupported`); else counts[item.tier] += 1;
    if (!['single_choice', 'multiple_choice', 'ordered_actions', 'boolean', 'exact_text'].includes(item.answerType)) errors.push(`${path}.answerType is unsupported`);
    if (typeof item.prompt !== 'string' || !item.prompt.trim() || !Object.hasOwn(item, 'expectedAnswer') || item.expectedAnswer == null || typeof item.scoringRule !== 'string' || !item.scoringRule)
      errors.push(`${path} requires a prompt, expected answer and scoring rule`);
    const expectedRule = item.answerType === 'ordered_actions' ? 'exact_order' :
      item.answerType === 'multiple_choice' ? 'exact_set' : 'exact_match';
    if (item.scoringRule !== expectedRule) errors.push(`${path}.scoringRule must be ${expectedRule}`);
    if (item.answerType === 'single_choice' && typeof item.expectedAnswer !== 'string') errors.push(`${path}.expectedAnswer must be a choice string`);
    if (item.answerType === 'boolean' && typeof item.expectedAnswer !== 'boolean') errors.push(`${path}.expectedAnswer must be boolean`);
    if (item.answerType === 'exact_text' && typeof item.expectedAnswer !== 'string') errors.push(`${path}.expectedAnswer must be exact text`);
    if (item.answerType === 'multiple_choice' && !Array.isArray(item.expectedAnswer)) errors.push(`${path}.expectedAnswer must be an array`);
    if (item.answerType === 'ordered_actions' && !Array.isArray(item.expectedAnswer)) errors.push(`${path}.expectedAnswer must be an ordered array`);
    if (['single_choice', 'multiple_choice'].includes(item.answerType) && (!Array.isArray(item.choices) || new Set(item.choices).size !== item.choices.length ||
      (item.answerType === 'single_choice' && !item.choices.includes(item.expectedAnswer)) ||
      (item.answerType === 'multiple_choice' && item.expectedAnswer.some((answer) => !item.choices.includes(answer)))))
      errors.push(`${path}.choices must be unique and contain every expected answer`);
    if (!Array.isArray(item.objectiveIds) || !item.objectiveIds.length || item.objectiveIds.some((id) => !objectiveIds.has(id))) errors.push(`${path}.objectiveIds must link existing objectives`);
    if (!Array.isArray(item.sourceLinks) || !item.sourceLinks.length || item.sourceLinks.some((link) => !sourceIds.has(link?.sourceId) || typeof link?.pinpoint !== 'string' || !link.pinpoint.trim())) errors.push(`${path}.sourceLinks must link approved sources and exact pinpoints`);
  }
  if (counts.recall !== 5 || counts.applied !== 6 || counts.adversarial !== 4) errors.push('fallbackBank tier counts must be 5 recall, 6 applied, and 4 adversarial');
  if (!items.some((item) => item?.criticalSafety === true)) errors.push('fallbackBank must include a critical-safety item');
  return errors;
}

module.exports = { POLICY, FALLBACK_BANK, scoreItem, scoreBank, digestBank, validateFallbackBank };
