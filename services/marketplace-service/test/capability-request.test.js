'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORTED_DOMAIN, validateRequestVersion } = require('../capability-request');

const validRequest = () => ({
  domain: 'ai-agent-safety-secure-tool-use',
  requiredObjectiveIds: ['obj-prompt-injection', 'obj-tool-scope'],
  minOverallPercent: 85,
  minAdversarialPercent: 75,
  maxCredentialAgeDays: 90,
  allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation',
  title: 'Simulated secure tool-use reviewer',
});

test('the single supported domain is the reference domain', () => {
  assert.equal(SUPPORTED_DOMAIN, 'ai-agent-safety-secure-tool-use');
});

test('a valid request version is accepted with a sha256 digest', () => {
  const result = validateRequestVersion(validRequest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
});

test('boundary values are accepted', () => {
  for (const patch of [
    { minOverallPercent: 80 }, { minOverallPercent: 100 },
    { minAdversarialPercent: 70 }, { minAdversarialPercent: 100 },
    { maxCredentialAgeDays: 1 }, { maxCredentialAgeDays: 365 },
    { requiredObjectiveIds: ['only-one'] },
    { requiredObjectiveIds: Array.from({ length: 20 }, (_, i) => `obj-${i}`) },
    { allowedAssessmentModes: ['standard', 'fallback'] }, { allowedAssessmentModes: ['fallback'] },
    { requiredEnvironment: 'live' },
    { title: 'x' }, { title: 'x'.repeat(200) },
  ]) {
    const result = validateRequestVersion({ ...validRequest(), ...patch });
    assert.equal(result.ok, true, JSON.stringify(patch));
  }
});

test('an unsupported domain is rejected as domain_unsupported', () => {
  for (const domain of ['ai-safety-fundamentals', 'AI-AGENT-SAFETY-SECURE-TOOL-USE', '', 42]) {
    const result = validateRequestVersion({ ...validRequest(), domain });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ['domain_unsupported']);
    assert.equal(result.digest, null);
  }
});

test('each bad field is rejected and named', () => {
  const cases = [
    ['requiredObjectiveIds', []],
    ['requiredObjectiveIds', ['a', 'a']],
    ['requiredObjectiveIds', ['a', '']],
    ['requiredObjectiveIds', ['a', 7]],
    ['requiredObjectiveIds', Array.from({ length: 21 }, (_, i) => `obj-${i}`)],
    ['requiredObjectiveIds', 'obj-a'],
    ['minOverallPercent', 79.99],
    ['minOverallPercent', 100.01],
    ['minOverallPercent', '90'],
    ['minOverallPercent', Number.NaN],
    ['minAdversarialPercent', 69],
    ['minAdversarialPercent', 101],
    ['maxCredentialAgeDays', 0],
    ['maxCredentialAgeDays', 366],
    ['maxCredentialAgeDays', 30.5],
    ['allowedAssessmentModes', []],
    ['allowedAssessmentModes', ['live']],
    ['allowedAssessmentModes', ['standard', 'standard']],
    ['allowedAssessmentModes', 'standard'],
    ['requiredEnvironment', 'production'],
    ['requiredEnvironment', 'unknown'],
    ['title', ''],
    ['title', '   '],
    ['title', 'x'.repeat(201)],
    ['title', 12],
  ];
  for (const [field, value] of cases) {
    const result = validateRequestVersion({ ...validRequest(), [field]: value });
    assert.equal(result.ok, false, `${field}=${JSON.stringify(value)}`);
    assert.deepEqual(result.errors, [`invalid:${field}`], `${field}=${JSON.stringify(value)}`);
    assert.equal(result.digest, null);
  }
});

test('a missing field is rejected', () => {
  for (const field of Object.keys(validRequest())) {
    const input = validRequest();
    delete input[field];
    const result = validateRequestVersion(input);
    assert.equal(result.ok, false, field);
    assert.ok(result.errors.includes(field === 'domain' ? 'domain_unsupported' : `invalid:${field}`), field);
  }
});

test('unknown fields are rejected as unexpected:<field>', () => {
  const result = validateRequestVersion({ ...validRequest(), minMatchScore: 50, ranking: 'x' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['unexpected:minMatchScore', 'unexpected:ranking']);
});

test('a non-object body is rejected', () => {
  for (const input of [null, undefined, [], 'request', 5]) {
    assert.deepEqual(validateRequestVersion(input), { ok: false, errors: ['invalid:body'], digest: null });
  }
});

test('the digest is stable regardless of key order and set order', () => {
  const base = validRequest();
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  reordered.requiredObjectiveIds = [...base.requiredObjectiveIds].reverse();
  assert.equal(validateRequestVersion(reordered).digest, validateRequestVersion(base).digest);
});

test('the digest changes when any value changes', () => {
  const base = validateRequestVersion(validRequest()).digest;
  assert.notEqual(validateRequestVersion({ ...validRequest(), minOverallPercent: 86 }).digest, base);
  assert.notEqual(validateRequestVersion({ ...validRequest(), title: 'Other' }).digest, base);
});

test('validation does not mutate its input', () => {
  const input = validRequest();
  const before = structuredClone(input);
  validateRequestVersion(input);
  assert.deepEqual(input, before);
});
