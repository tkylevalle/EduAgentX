'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GATES, checkEligibility } = require('../eligibility');

const DAY = 86400000;
const NOW = '2026-10-18T00:00:00.000Z';
const daysBefore = (days, extraMs = 0) => new Date(Date.parse(NOW) - days * DAY - extraMs).toISOString();

const request = () => ({
  domain: 'ai-agent-safety-secure-tool-use',
  requiredObjectiveIds: ['obj-prompt-injection', 'obj-tool-scope'],
  minOverallPercent: 85,
  minAdversarialPercent: 75,
  maxCredentialAgeDays: 90,
  allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation',
  title: 'Simulated secure tool-use reviewer',
});

// What the event-fed projection holds about one credential.
const candidate = () => ({
  credentialId: 'cred-1',
  agentLearnerKey: 'agent-a',
  configurationFingerprint: 'sha256:fingerprint-a',
  package: { id: 'pkg-ai-safety', version: '1.0.0', digest: 'sha256:package-1' },
  overallPercent: 90,
  adversarialPercent: 80,
  assessmentMode: 'standard',
  environment: 'simulation',
  validFrom: daysBefore(30),
  validUntil: '2027-09-18T00:00:00.000Z',
});

// What the owning services answered when rechecked just before the response.
const authoritative = () => ({
  lifecycleOrigin: true,
  discoverable: true,
  verification: { signature: 'valid', schema: 'valid', status: 'active' },
  registry: { currentFingerprint: 'sha256:fingerprint-a' },
  package: {
    digest: 'sha256:package-1',
    domain: 'ai-agent-safety-secure-tool-use',
    objectiveIds: ['obj-prompt-injection', 'obj-tool-scope', 'obj-escalation'],
  },
});

const codes = (result) => result.reasons.map((reason) => reason.code);
const setPath = (object, dotted, value) => {
  const keys = dotted.split('.');
  const last = keys.pop();
  const parent = keys.reduce((node, key) => node[key], object);
  if (value === undefined) delete parent[last]; else parent[last] = value;
};

const check = ({ req = request(), cand = candidate(), auth = authoritative(), now = NOW } = {}) =>
  checkEligibility(req, cand, auth, now);

test('a fully valid candidate is eligible with no reasons', () => {
  assert.deepEqual(check(), { eligible: true, reasons: [] });
});

test('gates run in the fixed order', () => {
  assert.deepEqual(GATES.map((gate) => gate.id), [
    'lifecycle_origin', 'discoverable', 'signature', 'schema', 'status', 'expiry', 'fingerprint',
    'environment', 'domain', 'objectives', 'score_overall', 'score_adversarial', 'age', 'mode',
  ]);
});

test('each gate fails alone with exactly its code, gate and tag', () => {
  const cases = [
    ['lifecycle_origin', 'NOT_LIFECYCLE_ORIGIN', 'trust', (c, a) => { a.lifecycleOrigin = false; }],
    ['discoverable', 'NOT_DISCOVERABLE', 'trust', (c, a) => { a.discoverable = false; }],
    ['signature', 'SIGNATURE_INVALID', 'trust', (c, a) => { a.verification.signature = 'invalid'; }],
    ['schema', 'SCHEMA_INVALID', 'trust', (c, a) => { a.verification.schema = 'invalid'; }],
    ['status', 'STATUS_SUSPENDED', 'trust', (c, a) => { a.verification.status = 'suspended'; }],
    ['status', 'STATUS_REVOKED', 'trust', (c, a) => { a.verification.status = 'revoked'; }],
    ['status', 'STATUS_SUPERSEDED', 'trust', (c, a) => { a.verification.status = 'superseded'; }],
    ['status', 'STATUS_INDETERMINATE', 'trust', (c, a) => { a.verification.status = 'indeterminate'; }],
    ['expiry', 'EXPIRED', 'trust', (c) => { c.validUntil = daysBefore(1); }],
    ['fingerprint', 'FINGERPRINT_MISMATCH', 'trust', (c, a) => { a.registry.currentFingerprint = 'sha256:fingerprint-b'; }],
    ['environment', 'ENVIRONMENT_MISMATCH', 'trust', (c) => { c.environment = 'live'; }],
    ['domain', 'DOMAIN_MISMATCH', 'trust', (c, a) => { a.package.domain = 'ai-safety-fundamentals'; }],
    ['score_overall', 'SCORE_OVERALL_BELOW', 'request', (c) => { c.overallPercent = 84; }],
    ['score_adversarial', 'SCORE_ADVERSARIAL_BELOW', 'request', (c) => { c.adversarialPercent = 74; }],
    ['age', 'CREDENTIAL_TOO_OLD', 'request', (c) => { c.validFrom = daysBefore(91); }],
    ['mode', 'MODE_NOT_ALLOWED', 'request', (c) => { c.assessmentMode = 'fallback'; }],
  ];
  for (const [gate, code, tag, breakIt] of cases) {
    const cand = candidate();
    const auth = authoritative();
    breakIt(cand, auth);
    assert.deepEqual(check({ cand, auth }), { eligible: false, reasons: [{ code, gate, tag }] }, code);
  }
});

test('a missing objective is a request reason that lists every missing id', () => {
  const auth = authoritative();
  auth.package.objectiveIds = ['obj-escalation'];
  assert.deepEqual(check({ auth }), { eligible: false, reasons: [{
    code: 'OBJECTIVE_MISSING', gate: 'objectives', tag: 'request',
    missingObjectiveIds: ['obj-prompt-injection', 'obj-tool-scope'] }] });
});

test('scores exactly at the minimum pass and just below fail', () => {
  assert.equal(check({ cand: { ...candidate(), overallPercent: 85 } }).eligible, true);
  assert.deepEqual(codes(check({ cand: { ...candidate(), overallPercent: 84.99 } })), ['SCORE_OVERALL_BELOW']);
  assert.equal(check({ cand: { ...candidate(), adversarialPercent: 75 } }).eligible, true);
  assert.deepEqual(codes(check({ cand: { ...candidate(), adversarialPercent: 74.99 } })), ['SCORE_ADVERSARIAL_BELOW']);
});

test('credential age exactly at the maximum passes and one millisecond older fails', () => {
  assert.equal(check({ cand: { ...candidate(), validFrom: daysBefore(90) } }).eligible, true);
  assert.deepEqual(codes(check({ cand: { ...candidate(), validFrom: daysBefore(90, 1) } })), ['CREDENTIAL_TOO_OLD']);
});

test('a credential is expired at its validUntil instant, valid one millisecond before', () => {
  assert.deepEqual(codes(check({ cand: { ...candidate(), validUntil: NOW } })), ['EXPIRED']);
  const justBefore = new Date(Date.parse(NOW) + 1).toISOString();
  assert.equal(check({ cand: { ...candidate(), validUntil: justBefore } }).eligible, true);
});

test('a validFrom in the future cannot be aged and fails closed', () => {
  const future = new Date(Date.parse(NOW) + DAY).toISOString();
  assert.deepEqual(check({ cand: { ...candidate(), validFrom: future } }).reasons,
    [{ code: 'AGE_UNCHECKABLE', gate: 'age', tag: 'trust' }]);
});

test('multiple failures are all reported in the fixed gate order', () => {
  const cand = { ...candidate(), assessmentMode: 'fallback', overallPercent: 50, validUntil: daysBefore(1) };
  const auth = authoritative();
  auth.lifecycleOrigin = false;
  auth.registry.currentFingerprint = 'sha256:other';
  assert.deepEqual(codes(check({ cand, auth })),
    ['NOT_LIFECYCLE_ORIGIN', 'EXPIRED', 'FINGERPRINT_MISMATCH', 'SCORE_OVERALL_BELOW', 'MODE_NOT_ALLOWED']);
});

test('every authoritative field missing, null or "unknown" makes the candidate ineligible as UNCHECKABLE', () => {
  const cases = [
    ['lifecycleOrigin', ['LIFECYCLE_ORIGIN_UNCHECKABLE']],
    ['discoverable', ['DISCOVERABLE_UNCHECKABLE']],
    ['verification', ['SIGNATURE_UNCHECKABLE', 'SCHEMA_UNCHECKABLE', 'STATUS_UNCHECKABLE']],
    ['verification.signature', ['SIGNATURE_UNCHECKABLE']],
    ['verification.schema', ['SCHEMA_UNCHECKABLE']],
    ['verification.status', ['STATUS_UNCHECKABLE']],
    ['registry', ['FINGERPRINT_UNCHECKABLE']],
    ['registry.currentFingerprint', ['FINGERPRINT_UNCHECKABLE']],
    ['package', ['PACKAGE_UNCHECKABLE', 'PACKAGE_UNCHECKABLE']],
    ['package.digest', ['PACKAGE_UNCHECKABLE', 'PACKAGE_UNCHECKABLE']],
    ['package.domain', ['DOMAIN_UNCHECKABLE']],
    ['package.objectiveIds', ['OBJECTIVES_UNCHECKABLE']],
  ];
  for (const [field, expected] of cases) {
    for (const value of [undefined, null, 'unknown']) {
      const auth = authoritative();
      setPath(auth, field, value);
      const result = check({ auth });
      assert.equal(result.eligible, false, `${field}=${value}`);
      assert.deepEqual(codes(result), expected, `${field}=${value}`);
      assert.ok(result.reasons.every((reason) => reason.tag === 'trust'), `${field}=${value}`);
    }
  }
});

test('every candidate field missing, null or "unknown" makes the candidate ineligible as UNCHECKABLE', () => {
  const cases = [
    ['configurationFingerprint', ['FINGERPRINT_UNCHECKABLE']],
    ['package', ['PACKAGE_UNCHECKABLE', 'PACKAGE_UNCHECKABLE']],
    ['package.digest', ['PACKAGE_UNCHECKABLE', 'PACKAGE_UNCHECKABLE']],
    ['overallPercent', ['SCORE_OVERALL_UNCHECKABLE']],
    ['adversarialPercent', ['SCORE_ADVERSARIAL_UNCHECKABLE']],
    ['assessmentMode', ['MODE_UNCHECKABLE']],
    ['environment', ['ENVIRONMENT_UNCHECKABLE']],
    ['validFrom', ['AGE_UNCHECKABLE']],
    ['validUntil', ['EXPIRY_UNCHECKABLE']],
  ];
  for (const [field, expected] of cases) {
    for (const value of [undefined, null, 'unknown']) {
      const cand = candidate();
      setPath(cand, field, value);
      const result = check({ cand });
      assert.equal(result.eligible, false, `${field}=${value}`);
      assert.deepEqual(codes(result), expected, `${field}=${value}`);
      assert.ok(result.reasons.every((reason) => reason.tag === 'trust'), `${field}=${value}`);
    }
  }
});

test('unrecognised authoritative values are uncheckable, never valid', () => {
  const cases = [
    ['lifecycleOrigin', 'yes', 'LIFECYCLE_ORIGIN_UNCHECKABLE'],
    ['discoverable', 1, 'DISCOVERABLE_UNCHECKABLE'],
    ['verification.signature', true, 'SIGNATURE_UNCHECKABLE'],
    ['verification.schema', 'VALID', 'SCHEMA_UNCHECKABLE'],
    ['verification.status', 'pending', 'STATUS_UNCHECKABLE'],
    ['package.objectiveIds', 'obj-prompt-injection', 'OBJECTIVES_UNCHECKABLE'],
  ];
  for (const [field, value, code] of cases) {
    const auth = authoritative();
    setPath(auth, field, value);
    assert.deepEqual(codes(check({ auth })), [code], `${field}=${JSON.stringify(value)}`);
  }
  assert.deepEqual(codes(check({ cand: { ...candidate(), overallPercent: '90' } })), ['SCORE_OVERALL_UNCHECKABLE']);
  assert.deepEqual(codes(check({ cand: { ...candidate(), overallPercent: 101 } })), ['SCORE_OVERALL_UNCHECKABLE']);
});

test('a package digest that differs from the pinned digest makes domain and objectives uncheckable', () => {
  const auth = authoritative();
  auth.package.digest = 'sha256:package-2';
  assert.deepEqual(check({ auth }), { eligible: false, reasons: [
    { code: 'PACKAGE_UNCHECKABLE', gate: 'domain', tag: 'trust' },
    { code: 'PACKAGE_UNCHECKABLE', gate: 'objectives', tag: 'trust' }] });
});

test('empty or missing inputs exclude every gate without throwing', () => {
  for (const args of [[request(), candidate(), {}, NOW], [request(), candidate(), null, NOW],
    [request(), null, authoritative(), NOW], [null, candidate(), authoritative(), NOW], [null, null, null, null]]) {
    const result = checkEligibility(...args);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.length > 0);
  }
  const all = checkEligibility(null, null, null, null);
  // One reason per gate, in gate order, all of them uncheckable.
  assert.deepEqual(all.reasons.map((reason) => reason.gate), GATES.map((gate) => gate.id));
  assert.ok(all.reasons.every((reason) => reason.code.endsWith('_UNCHECKABLE') && reason.tag === 'trust'));
});

test('an invalid clock value makes expiry and age uncheckable', () => {
  for (const now of [undefined, null, 'unknown', 'not-a-date']) {
    // Called directly: check()'s default parameter would replace an undefined `now`.
    const result = checkEligibility(request(), candidate(), authoritative(), now);
    assert.deepEqual(codes(result), ['EXPIRY_UNCHECKABLE', 'AGE_UNCHECKABLE'], String(now));
  }
  assert.equal(check({ now: new Date(NOW) }).eligible, true);
});

test('request fields the gates need are uncheckable when missing', () => {
  const cases = [
    ['domain', 'DOMAIN_UNCHECKABLE'], ['requiredObjectiveIds', 'OBJECTIVES_UNCHECKABLE'],
    ['minOverallPercent', 'SCORE_OVERALL_UNCHECKABLE'], ['minAdversarialPercent', 'SCORE_ADVERSARIAL_UNCHECKABLE'],
    ['maxCredentialAgeDays', 'AGE_UNCHECKABLE'], ['allowedAssessmentModes', 'MODE_UNCHECKABLE'],
    ['requiredEnvironment', 'ENVIRONMENT_UNCHECKABLE'],
  ];
  for (const [field, code] of cases) {
    const req = request();
    delete req[field];
    assert.deepEqual(codes(check({ req })), [code], field);
  }
});

test('a package in the request domain is still a mismatch when that domain is unsupported', () => {
  const req = { ...request(), domain: 'ai-safety-fundamentals' };
  const auth = authoritative();
  auth.package.domain = 'ai-safety-fundamentals';
  assert.deepEqual(codes(check({ req, auth })), ['DOMAIN_MISMATCH']);
});

test('the check does not mutate its inputs', () => {
  const freeze = (value) => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const req = request(); const cand = candidate(); const auth = authoritative();
  const before = structuredClone({ req, cand, auth });
  freeze(req); freeze(cand); freeze(auth);
  checkEligibility(req, cand, auth, NOW);
  const failing = structuredClone(cand); failing.overallPercent = 1; freeze(failing);
  checkEligibility(req, failing, auth, NOW);
  assert.deepEqual({ req, cand, auth }, before);
});
