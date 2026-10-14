'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { sha256 } = require('../../curriculum-engine/model');
const { scoreBank, POLICY } = require('../../curriculum-engine/fallback');
const { publicForm } = require('../generation');
const { validateFallbackSelection, buildFallbackForm, publicFallbackForm, encodeFallbackAnswer,
  mapFallbackResult } = require('../fallback-form');

// Same projection as validation-activation's POST /fallback/select, sent over JSON.
function selectResponse() {
  const bank = candidate.fallbackBank;
  return JSON.parse(JSON.stringify({ packageId: candidate.manifest.packageId, bankId: bank.id, bankVersion: bank.version,
    scoringPolicy: bank.scoringPolicy, attemptId: randomUUID(), mode: 'fallback',
    items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) }));
}
function formInput(selection = selectResponse()) {
  return { selection, packageId: candidate.manifest.packageId, packageVersion: candidate.manifest.version,
    packageDigest: 'd'.repeat(64), causeAttemptId: randomUUID(), reason: 'standard_grading_unavailable',
    agentLearnerKey: 'fallback-learner', configurationFingerprint: 'sha256:fallback-fingerprint' };
}

test('a complete select response is valid; 14 items or wrong tier counts are not', () => {
  const selection = selectResponse();
  const ok = validateFallbackSelection(selection);
  assert.equal(ok.valid, true);
  assert.equal(ok.items.length, 15);
  const short = selectResponse();
  short.items.pop();
  const result = validateFallbackSelection(short);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('items must contain exactly 15 items'));
  const retiered = selectResponse();
  retiered.items[0].tier = 'applied';
  assert.equal(validateFallbackSelection(retiered).valid, false);
});

test('quarantined, malformed or incomplete select responses are rejected', () => {
  // validation-activation's 409 body when a bank scope is quarantined.
  assert.equal(validateFallbackSelection({ error: 'fallback_scope_quarantined' }).valid, false);
  for (const bad of [null, [], 'fallback', {}]) assert.equal(validateFallbackSelection(bad).valid, false);
  for (const change of [{ mode: 'standard' }, { attemptId: '' }, { bankVersion: undefined }, { scoringPolicy: null },
    { items: 'not-an-array' }]) assert.equal(validateFallbackSelection({ ...selectResponse(), ...change }).valid, false);
  for (const field of ['id', 'version', 'tier', 'answerType', 'prompt', 'objectiveIds', 'sourceLinks', 'criticalSafety']) {
    const selection = selectResponse();
    delete selection.items[3][field];
    assert.equal(validateFallbackSelection(selection).valid, false, field);
  }
  const noChoices = selectResponse();
  delete noChoices.items.find((item) => item.answerType === 'single_choice').choices;
  assert.equal(validateFallbackSelection(noChoices).valid, false);
  const duplicate = selectResponse();
  duplicate.items[1].id = duplicate.items[0].id;
  assert.equal(validateFallbackSelection(duplicate).valid, false);
});

test('fallback form is deeply frozen, package-bound and carries no expected answers', () => {
  const input = formInput();
  input.selection.items[0].expectedAnswer = 'LEAKED_KEY';
  const form = buildFallbackForm(input);
  assert.equal(form.schemaVersion, 'examination-form-fallback/1.0.0');
  assert.equal(form.mode, 'fallback');
  assert.deepEqual(form.package, { id: input.packageId, version: input.packageVersion, digest: input.packageDigest });
  assert.deepEqual(form.subject, { agentLearnerKey: input.agentLearnerKey, configurationFingerprint: input.configurationFingerprint });
  assert.deepEqual(form.rubric, { id: 'fallback-scoring/1.0.0', version: '1.0.0', digest: sha256(POLICY) });
  assert.equal(form.rubric.version, POLICY.id.split('/')[1]);
  assert.deepEqual(form.training, { eventId: null });
  assert.deepEqual([form.bankId, form.bankVersion, form.causeAttemptId, form.reason, form.vaSelectionId],
    [input.selection.bankId, input.selection.bankVersion, input.causeAttemptId, input.reason, input.selection.attemptId]);
  assert.equal(form.items.length, 15);
  assert.equal(JSON.stringify(form).includes('expectedAnswer'), false);
  assert.equal(JSON.stringify(form).includes('LEAKED_KEY'), false);
  for (const value of [form, form.package, form.items, form.items[5], form.items[5].choices, form.items[0].sourceLinks[0]])
    assert.equal(Object.isFrozen(value), true);
  input.selection.items[1].prompt = 'changed after build';
  assert.notEqual(form.items[1].prompt, 'changed after build');
  assert.throws(() => buildFallbackForm({ ...formInput(), packageId: 'another-package' }), { code: 'invalid_fallback_selection' });
  const short = selectResponse();
  short.items.pop();
  assert.throws(() => buildFallbackForm(formInput(short)), { code: 'invalid_fallback_selection' });
  for (const change of [{ agentLearnerKey: undefined }, { configurationFingerprint: '' }, { agentLearnerKey: 42 }])
    assert.throws(() => buildFallbackForm({ ...formInput(), ...change }), { code: 'registration_required' });
  // Without validation-activation's selection id the attempt could never be scored.
  for (const attemptId of [undefined, '', '   ', 42]) {
    const selection = selectResponse();
    selection.attemptId = attemptId;
    assert.throws(() => buildFallbackForm(formInput(selection)), { code: 'invalid_fallback_selection' });
  }
});

test('the validation-activation selection id never reaches the learner projection', () => {
  const input = formInput();
  const form = buildFallbackForm(input);
  assert.equal(form.vaSelectionId, input.selection.attemptId);
  const view = publicFallbackForm(form);
  assert.equal(Object.hasOwn(view, 'vaSelectionId'), false);
  assert.equal(JSON.stringify(view).includes(input.selection.attemptId), false);
});

test('subject, rubric and training are deep-frozen and cannot be mutated', () => {
  const form = buildFallbackForm(formInput());
  for (const value of [form.subject, form.rubric, form.training]) assert.equal(Object.isFrozen(value), true);
  // This file is strict mode, so writes to frozen objects throw instead of being ignored.
  assert.throws(() => { form.subject.agentLearnerKey = 'someone-else'; }, TypeError);
  assert.throws(() => { form.rubric.digest = 'forged'; }, TypeError);
  assert.throws(() => { form.training.eventId = 'invented-event'; }, TypeError);
  assert.throws(() => { form.subject = {}; }, TypeError);
  assert.deepEqual([form.subject.agentLearnerKey, form.rubric.digest, form.training.eventId],
    ['fallback-learner', sha256(POLICY), null]);
});

test('public fallback projection keeps answer types and choices but no internal bookkeeping', () => {
  const form = buildFallbackForm(formInput());
  const view = publicFallbackForm(form);
  assert.deepEqual(Object.keys(view).sort(), ['bankId', 'bankVersion', 'items', 'mode', 'package', 'schemaVersion']);
  assert.equal(view.mode, 'fallback');
  const multiple = view.items.find((item) => item.answerType === 'multiple_choice');
  assert.equal(multiple.answerType, 'multiple_choice');
  assert.ok(Array.isArray(multiple.choices) && multiple.choices.length > 0);
  for (const hidden of ['subject', 'rubric', 'training', 'causeAttemptId', 'reason']) assert.equal(view[hidden], undefined, hidden);
  assert.equal(JSON.stringify(view).includes('fallback-learner'), false);
  // An old-schema fallback form is refused, and the standard projection refuses the new schema.
  assert.throws(() => publicFallbackForm({ ...form, schemaVersion: 'examination-form/1.0.0' }), { code: 'invalid_generated_form' });
  assert.throws(() => publicFallbackForm(null), { code: 'invalid_generated_form' });
  assert.throws(() => publicForm(form), { code: 'invalid_generated_form' });
});

test('answers encode canonically: sets ignore order, ordered actions keep it', () => {
  assert.equal(encodeFallbackAnswer('multiple_choice', ['Data stores', 'Allowed actions']),
    encodeFallbackAnswer('multiple_choice', ['Allowed actions', 'Data stores']));
  assert.notEqual(encodeFallbackAnswer('ordered_actions', ['Govern', 'Map']),
    encodeFallbackAnswer('ordered_actions', ['Map', 'Govern']));
  assert.equal(encodeFallbackAnswer('single_choice', 'Map'), '"Map"');
  assert.equal(encodeFallbackAnswer('exact_text', 'Govern, Map, Measure, Manage'), '"Govern, Map, Measure, Manage"');
  assert.equal(encodeFallbackAnswer('boolean', false), 'false');
  assert.throws(() => encodeFallbackAnswer('essay', 'anything'), /unsupported answerType/);
  assert.throws(() => encodeFallbackAnswer('multiple_choice', 'Map'), /must be an array/);
});

test('encoded expected answers decode to exactly what scoreBank scores as a pass', () => {
  const responses = candidate.fallbackBank.items.map((item) => ({ itemId: item.id,
    answer: JSON.parse(encodeFallbackAnswer(item.answerType, item.expectedAnswer)) }));
  const result = scoreBank(candidate.fallbackBank, responses);
  assert.deepEqual([result.valid, result.passed, result.overall], [true, true, 100]);
});

test('scoreBank results map to the Engine result schema', () => {
  const schemaVersion = 'examination-result/1.0.0';
  assert.deepEqual(mapFallbackResult({ valid: true, passed: true, overall: 100, tierScores: {}, criticalViolation: false,
    policyId: 'fallback-scoring/1.0.0' }), { schemaVersion, valid: true, passed: true });
  assert.deepEqual(mapFallbackResult({ valid: true, passed: false, overall: 40, tierScores: {}, criticalViolation: true,
    policyId: 'fallback-scoring/1.0.0' }), { schemaVersion, valid: true, passed: false });
  assert.deepEqual(mapFallbackResult({ valid: false, reason: 'incomplete_fallback_attempt', passed: true }),
    { schemaVersion, valid: false, passed: false });
  assert.deepEqual(mapFallbackResult(null), { schemaVersion, valid: false, passed: false });
});
