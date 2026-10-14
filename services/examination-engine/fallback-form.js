'use strict';

// Issue #20: Deterministic Fallback Examination form. Items come only from
// validation-activation's POST /fallback/select (the prevalidated, pinned
// bank); the Engine never authors or edits them, and expected answers never
// enter this form. Scoring stays with POST /fallback/score.
const { canonical, sha256 } = require('../curriculum-engine/model');
const { POLICY } = require('../curriculum-engine/fallback');
const { GenerationError } = require('./generation');

// Distinct from the standard 'examination-form/1.0.0' so a fallback form can
// never pass through generation.js's publicForm, which would drop answerType/choices.
const SCHEMA_VERSION = 'examination-form-fallback/1.0.0';

const TIER_COUNTS = Object.freeze({ recall: 5, applied: 6, adversarial: 4 });
const ANSWER_TYPES = Object.freeze(['single_choice', 'multiple_choice', 'ordered_actions', 'boolean', 'exact_text']);
const CHOICE_TYPES = Object.freeze(['single_choice', 'multiple_choice']);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

function validateFallbackSelection(selectResponse) {
  const errors = [];
  const s = selectResponse;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { valid: false, errors: ['selection must be an object'] };
  for (const field of ['packageId', 'bankId', 'bankVersion', 'attemptId'])
    if (!nonempty(s[field])) errors.push(`${field} is required`);
  if (s.mode !== 'fallback') errors.push("mode must be 'fallback'");
  if (!s.scoringPolicy || typeof s.scoringPolicy !== 'object') errors.push('scoringPolicy is required');
  if (!Array.isArray(s.items)) return { valid: false, errors: [...errors, 'items must be an array'] };
  if (s.items.length !== 15) errors.push('items must contain exactly 15 items');
  for (const [tier, count] of Object.entries(TIER_COUNTS))
    if (s.items.filter((item) => item?.tier === tier).length !== count) errors.push(`${tier} tier must have ${count} items`);
  const ids = new Set();
  for (const [index, item] of s.items.entries()) {
    const path = `items[${index}]`;
    if (!item || typeof item !== 'object') { errors.push(`${path} must be an object`); continue; }
    if (!nonempty(item.id) || ids.has(item.id)) errors.push(`${path}.id must be unique and non-empty`);
    ids.add(item.id);
    if (!nonempty(item.version)) errors.push(`${path}.version is required`);
    if (!Object.hasOwn(TIER_COUNTS, item.tier)) errors.push(`${path}.tier is unsupported`);
    if (!ANSWER_TYPES.includes(item.answerType)) errors.push(`${path}.answerType is unsupported`);
    if (!nonempty(item.prompt)) errors.push(`${path}.prompt is required`);
    if (!Array.isArray(item.objectiveIds) || !item.objectiveIds.length) errors.push(`${path}.objectiveIds is required`);
    if (!Array.isArray(item.sourceLinks) || !item.sourceLinks.length) errors.push(`${path}.sourceLinks is required`);
    if (typeof item.criticalSafety !== 'boolean') errors.push(`${path}.criticalSafety must be boolean`);
    if (CHOICE_TYPES.includes(item.answerType) && (!Array.isArray(item.choices) || !item.choices.length))
      errors.push(`${path}.choices is required for ${item.answerType}`);
  }
  return errors.length ? { valid: false, errors } : { valid: true, items: s.items };
}

function buildFallbackForm({ selection, packageId, packageVersion, packageDigest, causeAttemptId, reason,
  agentLearnerKey, configurationFingerprint }) {
  // derive() checks form.subject against the stored manifest on every read.
  if (!nonempty(agentLearnerKey) || !nonempty(configurationFingerprint))
    throw Object.assign(new Error('registration_required'), { code: 'registration_required', status: 409 });
  const checked = validateFallbackSelection(selection);
  // A selection for another package must never become this package's form.
  if (!checked.valid || selection.packageId !== packageId)
    throw Object.assign(new Error('invalid_fallback_selection'), { code: 'invalid_fallback_selection', status: 409 });
  // Copy an allowlist of fields so nothing else (e.g. an expected answer) is kept.
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION, mode: 'fallback',
    package: { id: packageId, version: packageVersion, digest: packageDigest },
    subject: { agentLearnerKey, configurationFingerprint },
    // The fixed fallback scoring policy fills the rubric slot that finalize binds to.
    // version is the policy's own ('fallback-scoring/1.0.0'), not the bank's; that is form.bankVersion.
    rubric: { id: POLICY.id, version: '1.0.0', digest: sha256(POLICY) },
    // A fallback attempt has no Training event of its own; null, never invented.
    training: { eventId: null },
    bankId: selection.bankId, bankVersion: selection.bankVersion, causeAttemptId, reason,
    items: checked.items.map((item) => structuredClone({ id: item.id, tier: item.tier, answerType: item.answerType,
      choices: Array.isArray(item.choices) ? item.choices : null, prompt: item.prompt,
      objectiveIds: item.objectiveIds, sourceLinks: item.sourceLinks, criticalSafety: item.criticalSafety })),
  });
}

// Learner-facing projection. subject, rubric, training and the cause are
// internal bookkeeping and stay out.
function publicFallbackForm(form) {
  if (form?.schemaVersion !== SCHEMA_VERSION) throw new GenerationError('invalid_generated_form');
  return { schemaVersion: form.schemaVersion, mode: 'fallback', package: form.package,
    bankId: form.bankId, bankVersion: form.bankVersion, items: form.items };
}

// attempt_responses.response is text and the first answer is final by exact
// string match, so equal answers must encode to equal strings.
function encodeFallbackAnswer(answerType, rawAnswer) {
  if (!ANSWER_TYPES.includes(answerType)) throw new Error(`unsupported answerType: ${answerType}`);
  if (['multiple_choice', 'ordered_actions'].includes(answerType) && !Array.isArray(rawAnswer))
    throw new Error(`${answerType} answer must be an array`);
  if (rawAnswer === undefined) throw new Error('answer is required');
  // A set ignores order; an ordered action list keeps it.
  return canonical(answerType === 'multiple_choice' ? [...rawAnswer].sort() : rawAnswer);
}

function mapFallbackResult(scoreBankResult) {
  const valid = scoreBankResult?.valid === true;
  return { schemaVersion: 'examination-result/1.0.0', valid, passed: valid && scoreBankResult.passed === true };
}

module.exports = { validateFallbackSelection, buildFallbackForm, publicFallbackForm, encodeFallbackAnswer, mapFallbackResult };
