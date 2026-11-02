'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { golden, assessGolden, observeMarketplace } = require('../marketplace');
const base = () => ({ resultId: 'r', policyVersion: 'MATCH-POLICY-1.0.0', eligibleMatches: [], nearMatches: [], exclusions: [] });
test('real origin/label exclusions remain BLOCKED; empty lanes are not golden success', () => {
  const r = base(); r.exclusions.push({ agentLearnerKey: 'a', reasons: [{ code: 'LIFECYCLE_ORIGIN_UNCHECKABLE' }] });
  assert.equal(assessGolden(golden.cases[0], r).status, 'BLOCKED');
  assert.equal(assessGolden(golden.cases[0], base()).status, 'UNMEASURED');
});
test('independent literal orders and explanations detect changed ranking, score, lane and replay', () => {
  const r = base();
  r.eligibleMatches.push({ agentLearnerKey: 'a', eligible: true, matchScore: 78.5,
    checks: ['lifecycle_origin', 'discoverable', 'signature', 'schema', 'status', 'expiry', 'fingerprint', 'environment', 'domain', 'identity', 'evidence_mode']
      .map(gate => ({ gate, tag: 'trust', passed: true })), ordering: { decisiveCriterion: 'matchScore' } });
  const expected = { expectedEligible: ['a'], expectedNear: [], expectedExclusions: [], expectedScores: { a: 78.5 }, expectedOrdering: { a: 'matchScore' } };
  assert.equal(assessGolden(golden.cases[0], r, expected).status, 'CONFORMANT');
  assert.equal(assessGolden(golden.cases[0], r, { ...expected, expectedScores: { a: 79 } }).status, 'MISMATCH');
  r.nearMatches.push({ ...r.eligibleMatches[0], eligible: false, lane: 'Not Eligible' });
  assert.equal(assessGolden(golden.cases[0], r, expected).status, 'MISMATCH');
});
test('an upstream blocker cannot conceal an invalid inclusion or duplicate lane', () => {
  const r = base(); r.exclusions = [{ agentLearnerKey: 'blocked', reasons: [{ code: 'LIFECYCLE_ORIGIN_UNCHECKABLE' }] }];
  r.eligibleMatches.push({ agentLearnerKey: 'unsafe', eligible: true, checks: [{ tag: 'trust', gate: 'status', passed: false }] });
  assert.equal(assessGolden(golden.cases[0], r).status, 'MISMATCH');
});
test('pilot projection absence cannot downgrade an observable trust violation to BLOCKED', async () => {
  async function observe(result) {
    const interactions = [];
    const agent = { async interact(_s, _op, type) { interactions.push(type); return { status: 201 }; } };
    const admin = { async call(_method, route) {
      if (route === '/v1/marketplace/capability-requests') return { status: 201, body: { request: { id: 'request' } } };
      if (route.endsWith('/open')) return { status: 200 };
      if (route.endsWith('/matches')) return { status: 200, body: { matchResult: result } };
      return { status: 200, body: { count: 1, appearances: [] } };
    } };
    const observed = await observeMarketplace({ scenario: { id: 'competent-001', learnerId: 'not-projected' },
      agent, admin, pkg: { objectiveIds: ['o1'] }, actor: 'admin' });
    assert.deepEqual(interactions, ['marketplace.listing.publish', 'marketplace.listing.withdraw']);
    return observed;
  }
  assert.equal((await observe(base())).status, 'BLOCKED');
  const unsafe = base(); unsafe.eligibleMatches.push({ agentLearnerKey: 'untrusted-other', eligible: true, checks: [] });
  assert.equal((await observe(unsafe)).status, 'MISMATCH');
});
