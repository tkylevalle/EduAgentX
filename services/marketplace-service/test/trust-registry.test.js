'use strict';

// Trust Registry (target design 7.4): requests for any of the three domains,
// packages that name their domain by id and by display name, and attestation
// and bound filters on top of the existing gates.

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMAINS, validateRequestVersion } = require('../capability-request');
const { toPackageAnswer } = require('../clients');
const { FILTERS, checkEligibility } = require('../eligibility');

const body = (overrides = {}) => ({ packageId: 'customer-refunds', version: '0.1.0-draft', digest: 'd', certificationBlocked: false, quarantinedScopes: [],
  objectives: [{ id: 'o1' }], manifest: { domainId: 'customer-refunds', domain: 'Customer Refunds and Policy Compliance' }, domain: 'customer-refunds', ...overrides });
const request = (overrides = {}) => ({ domain: 'personal-data-handling', requiredObjectiveIds: ['o3'], minOverallPercent: 80, minAdversarialPercent: 70,
  maxCredentialAgeDays: 30, allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation', title: 'Data agent', ...overrides });

test('a request may name any of the three domains, and nothing else', () => {
  for (const slug of Object.keys(DOMAINS)) assert.equal(validateRequestVersion(request({ domain: slug })).ok, true, slug);
  assert.deepEqual(validateRequestVersion(request({ domain: 'payments' })).errors, ['domain_unsupported']);
});

test('a package naming its domain by id and by display name resolves to one domain; a disagreement resolves to none', () => {
  assert.equal(toPackageAnswer(body(), 'customer-refunds', '0.1.0-draft').domain, 'customer-refunds-policy-compliance');
  assert.equal(toPackageAnswer(body({ manifest: { domain: 'AI Agent Safety and Secure Tool Use' }, domain: 'AI Agent Safety and Secure Tool Use' }),
    'customer-refunds', '0.1.0-draft').domain, 'ai-agent-safety-secure-tool-use', 'a package stored before domain ids existed');
  assert.equal(toPackageAnswer(body({ domain: 'personal-data' }), 'customer-refunds', '0.1.0-draft').domain, null);
  assert.equal(toPackageAnswer(body({ domain: 'unknown' }), 'customer-refunds', '0.1.0-draft').domain, null);
});

test('the attestation and bound filters apply only when requested, as request reasons', () => {
  const codes = (requestVersion, candidate) => checkEligibility(requestVersion, candidate, {}, null).reasons
    .filter((reason) => FILTERS.some((filter) => filter.id === reason.gate)).map((reason) => [reason.code, reason.tag]);
  const behaviour = { objectives: [{ objectiveId: 'o3', successLowerBound: 0.75 }, { objectiveId: 'o4', successLowerBound: 0.85 }] };
  assert.deepEqual(codes(request(), { attestationLevel: null, behaviour: null }), [], 'not requested, not checked');
  assert.deepEqual(codes(request({ minAttestationLevel: 'L2-observed' }), { attestationLevel: 'L1-declared' }), [['ATTESTATION_BELOW', 'request']]);
  assert.deepEqual(codes(request({ minAttestationLevel: 'L1-declared' }), { attestationLevel: 'L2-observed' }), []);
  assert.deepEqual(codes(request({ minAttestationLevel: 'L1-declared' }), { attestationLevel: null }), [['ATTESTATION_BELOW', 'request']]);
  assert.deepEqual(codes(request({ minSuccessLowerBound: 0.8 }), { behaviour }), [['BOUND_BELOW', 'request']]);
  assert.deepEqual(codes(request({ minSuccessLowerBound: 0.75 }), { behaviour }), []);
  assert.deepEqual(validateRequestVersion(request({ minSuccessLowerBound: 0.5 })).errors, ['invalid:minSuccessLowerBound']);
  assert.deepEqual(validateRequestVersion(request({ minAttestationLevel: 'L3' })).errors, ['invalid:minAttestationLevel']);
});
