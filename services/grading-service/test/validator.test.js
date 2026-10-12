'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGradingInput } = require('../src/validator');

const validInput = {
  attemptId: 'a1', packageId: 'p1', packageDigest: 'd1',
  subject: 's1', mode: 'standard', submittedAt: new Date().toISOString(),
  answers: [{
    questionId: 'q1', tier: 'standard',
    response: 'some answer', expectedAnswer: 'expected',
    applicableCriticalRules: [],
  }],
};

test('valid input returns no errors', () => {
  assert.deepStrictEqual(validateGradingInput(validInput), []);
});

test('null input returns error', () => {
  assert.ok(validateGradingInput(null).length > 0);
});

test('missing attemptId returns error', () => {
  const { attemptId, ...rest } = validInput;
  assert.ok(validateGradingInput(rest).some(e => e.includes('attemptId')));
});

test('empty answers array returns error', () => {
  assert.ok(validateGradingInput({ ...validInput, answers: [] }).some(e => e.includes('answers')));
});

test('invalid tier returns error', () => {
  const bad = { ...validInput, answers: [{ ...validInput.answers[0], tier: 'invalid' }] };
  assert.ok(validateGradingInput(bad).some(e => e.includes('tier')));
});

test('empty response returns error', () => {
  const bad = { ...validInput, answers: [{ ...validInput.answers[0], response: '' }] };
  assert.ok(validateGradingInput(bad).some(e => e.includes('response')));
});

test('missing applicableCriticalRules returns error', () => {
  const { applicableCriticalRules, ...answerWithout } = validInput.answers[0];
  const bad = { ...validInput, answers: [answerWithout] };
  assert.ok(validateGradingInput(bad).some(e => e.includes('applicableCriticalRules')));
});
