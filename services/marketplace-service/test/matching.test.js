'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchCandidates, POLICY_VERSION } = require('../matching');
const { validateRequestVersion } = require('../capability-request');
const NOW = '2026-10-29T00:00:00.000Z';
const request = (patch = {}) => ({ domain: 'ai-agent-safety-secure-tool-use', title: 'Reference request',
  requiredObjectiveIds: ['a', 'b'], preferredObjectiveIds: ['b', 'c'], minOverallPercent: 85,
  minAdversarialPercent: 75, maxCredentialAgeDays: 100, allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation', ...patch });
const candidate = (id, patch = {}, auth = {}) => ({ record: { agentLearnerKey: id, credentialId: `cred-${id}`,
  candidate: { agentLearnerKey: id, credentialId: `cred-${id}`, overallPercent: 90, adversarialPercent: 80,
    package: { id: 'p', version: '1', digest: 'sha256:p' }, configurationFingerprint: 'sha256:fp',
    validFrom: '2026-10-19T00:00:00.000Z', validUntil: '2027-10-29T00:00:00.000Z',
    assessmentMode: 'standard', evidenceMode: 'synthetic', environment: 'simulation', ...patch } },
  authoritative: { discoverable: true, lifecycleOrigin: true, verification: { signature: 'valid', schema: 'valid', status: 'active' },
    registry: { currentFingerprint: 'sha256:fp' }, package: { digest: 'sha256:p', domain: 'ai-agent-safety-secure-tool-use', objectiveIds: ['a', 'b'] }, ...auth } });
const run = (items, req = request()) => matchCandidates(req, items, NOW);

test('approved arithmetic, preferred coverage and final rounding only', () => {
  const r = run([candidate('a')]); const a = r.eligibleMatches[0];
  assert.equal(r.policyVersion, POLICY_VERSION);
  assert.equal(a.components.totalPerformance.points, 31.5);
  assert.equal(a.components.adversarialPerformance.points, 28);
  assert.equal(a.components.preferredCoverage.points, 10);
  assert.equal(a.components.credentialRecency.points, 9);
  assert.equal(a.matchScore, 78.5);
  assert.equal(run([candidate('a')], request({ preferredObjectiveIds: [] })).eligibleMatches[0].matchScore, 88.5);
  const fractional = run([candidate('x', { overallPercent: 91.234, adversarialPercent: 83.456 })],
    request({ preferredObjectiveIds: ['b', 'c', 'd'] })).eligibleMatches[0];
  assert.equal(fractional.matchScore, 76.81);
  assert.equal(fractional.components.preferredCoverage.points, 20 / 3);
});

test('trust failures never reach either lane even with perfect scores', () => {
  const mutations = [
    [{}, { discoverable: false }], [{}, { lifecycleOrigin: null }],
    [{}, { verification: null }], [{}, { registry: null }], [{}, { package: null }],
    [{ validUntil: NOW }, {}], [{ validFrom: '2026-11-01T00:00:00Z' }, {}],
    [{ environment: 'live' }, {}], [{ evidenceMode: null }, {}],
    [{ overallPercent: NaN }, {}], [{ adversarialPercent: null }, {}],
    ...['revoked', 'suspended', 'superseded', 'indeterminate'].map((status) => [{}, { verification: { signature: 'valid', schema: 'valid', status } }]),
  ];
  for (const [patch, auth] of mutations) {
    const r = run([candidate('unsafe', { overallPercent: 100, adversarialPercent: 100, ...patch }, auth)]);
    assert.equal(r.eligibleMatches.length + r.nearMatches.length, 0, JSON.stringify([patch, auth]));
    assert.equal(r.exclusions.length, 1);
  }
});

test('request-only gaps stay in Not Eligible; objectives count individually and shortfall mean is exact', () => {
  const a = candidate('near', { overallPercent: 80, adversarialPercent: 70, assessmentMode: 'fallback',
    validFrom: '2026-04-12T00:00:00Z' }, { package: { digest: 'sha256:p', domain: request().domain, objectiveIds: [] } });
  const r = run([a]); const n = r.nearMatches[0];
  assert.equal(r.totalEligible, 0); assert.equal(n.eligible, false); assert.equal(n.lane, 'Not Eligible');
  assert.equal(n.gapCount, 6); assert.equal(n.gaps.filter((g) => g.code === 'OBJECTIVE_MISSING').length, 2);
  assert.deepEqual(n.shortfallComponents, { objectives: 1, overall: 5 / 85, adversarial: 5 / 75, age: 1, mode: 1 });
  assert.equal(n.normalizedShortfall, (1 + 5 / 85 + 5 / 75 + 1 + 1) / 5);
  assert.equal(n.components.credentialRecency.points, 0);
});

test('eligible sorting uses rounded score, chronological recency, then code-unit agent ID', () => {
  const r = run([candidate('b'), candidate('A'), candidate('z', { overallPercent: 100 }),
    candidate('new', { validFrom: '2026-10-24T00:00:00Z', overallPercent: 88.57142857142857 })]);
  assert.deepEqual(r.eligibleMatches.map((x) => x.agentLearnerKey), ['z', 'new', 'A', 'b']);
  assert.equal(r.eligibleMatches[1].ordering.decisiveCriterion, 'issuedAt');
  assert.equal(r.eligibleMatches[2].ordering.decisiveCriterion, 'agentLearnerKey');
  assert.deepEqual(r.eligibleMatches[2].ordering.tiedCriteria, ['matchScore', 'issuedAt']);
});

test('Near Match ordering: gaps, shortfall, ordinary score, recency, ID', () => {
  const items = [candidate('two-gaps', { overallPercent: 84, adversarialPercent: 74 }),
    candidate('far', { overallPercent: 80 }), candidate('low', { overallPercent: 84, adversarialPercent: 80 }),
    candidate('high', { overallPercent: 84, adversarialPercent: 99 })];
  const r = run(items);
  assert.deepEqual(r.nearMatches.map((x) => x.agentLearnerKey), ['high', 'low', 'far']);
  assert.equal(r.totalNearMatches, 4);
  assert.equal(r.nearMatches[0].ordering.decisiveCriterion, 'matchScore');
  assert.equal(r.nearMatches[1].ordering.decisiveCriterion, 'normalizedShortfall');
  assert.equal(r.nearMatches[2].ordering.decisiveCriterion, 'gapCount');
});

test('Near Match exact ties resolve by issuance time then stable learner ID', () => {
  const items = [candidate('b', { assessmentMode: 'fallback' }), candidate('A', { assessmentMode: 'fallback' }),
    candidate('new', { assessmentMode: 'fallback', validFrom: '2026-10-24T00:00:00Z',
      overallPercent: 88.57142857142857 })];
  const r = run(items);
  assert.deepEqual(r.nearMatches.map((x) => x.agentLearnerKey), ['new', 'A', 'b']);
  assert.equal(r.nearMatches[0].ordering.decisiveCriterion, 'issuedAt');
  assert.equal(r.nearMatches[1].ordering.decisiveCriterion, 'agentLearnerKey');
  assert.deepEqual(run([...items].reverse()), r);
});

test('lane limits, totals and deduplication never let high-scoring near matches displace eligible agents', () => {
  const items = Array.from({ length: 7 }, (_, i) => candidate(`agent-${i}`));
  items.push(candidate('near', { overallPercent: 100, adversarialPercent: 100, assessmentMode: 'fallback' }));
  const r = run(items);
  assert.equal(r.eligibleMatches.length, 5); assert.equal(r.totalEligible, 7);
  assert.equal(r.nearMatches[0].agentLearnerKey, 'near');
  assert.ok(r.nearMatches[0].matchScore > r.eligibleMatches[0].matchScore);
  const older = candidate('agent-0', { credentialId: 'other', assessmentMode: 'fallback' }); older.record.credentialId = 'other';
  assert.equal(run([...items, older]).totalNearMatches, 1);
  const dup = run([candidate('a'), candidate('a')]);
  assert.equal(dup.totalEligible, 0);
  assert.equal(dup.exclusionCounts.IDENTITY_UNCHECKABLE, 2);
});

test('unsupported domains and malformed requests produce no invented capabilities', () => {
  assert.equal(run([candidate('a')], request({ domain: 'medicine' })).outcome, 'UNSUPPORTED_DOMAIN');
  assert.deepEqual(run([candidate('a')], request({ domain: 'medicine' })).nearMatches, []);
  assert.equal(run([candidate('a')], request({ minOverallPercent: 0 })).outcome, 'INVALID_REQUEST');
  const badPackage = candidate('a', {}, { package: { domain: 'medicine', digest: 'sha256:p', objectiveIds: ['a', 'b'] } });
  assert.equal(run([badPackage]).totalNearMatches, 0);
});

test('explicit simulation origin is mandatory; live environments require live evidence', () => {
  for (const mode of ['synthetic', 'replay', 'live'])
    assert.equal(run([candidate(mode, { evidenceMode: mode })]).totalEligible, 1);
  for (const mode of ['synthetic', 'replay'])
    assert.equal(run([candidate(mode, { evidenceMode: mode, environment: 'live' })], request({ requiredEnvironment: 'live' })).totalEligible, 0);
});

test('unknown/private inputs are not exposed; original objects and thresholds are unchanged', () => {
  const c = candidate('a', { rawAnswers: 'PRIVATE', privatePrompt: 'PRIVATE', compactJws: 'PRIVATE', signingKey: 'PRIVATE' });
  c.authoritative.package.graderRationale = 'PRIVATE'; c.sources = { verification: 'PRIVATE', secret: 'PRIVATE' };
  const req = request(); const before = structuredClone({ req, c }); const r = run([c], req);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  assert.deepEqual({ req, c }, before);
});

test('preferred objectives are optional, validated and canonicalized without changing old digests', () => {
  const old = request(); delete old.preferredObjectiveIds;
  assert.ok(validateRequestVersion(old).ok);
  assert.equal(validateRequestVersion(request({ preferredObjectiveIds: ['z', 'a'] })).digest,
    validateRequestVersion(request({ preferredObjectiveIds: ['a', 'z'] })).digest);
  for (const list of [null, 'x', ['x', 'x'], [1], [''], Array(21).fill('x')])
    assert.equal(validateRequestVersion(request({ preferredObjectiveIds: list })).ok, false);
});

// 100 independent golden score/boundary cases, not a call to the implementation as oracle.
for (let i = 0; i < 100; i++) test(`golden ${i}: score/eligibility boundary and permutation invariance`, () => {
  const total = 80 + i % 21, adv = 70 + i % 31;
  const c = candidate(`a-${i}`, { overallPercent: total, adversarialPercent: adv });
  const expected = Math.round((total * .35 + adv * .35 + 10 + 9) * 100) / 100;
  const r = run([c]); const isEligible = total >= 85 && adv >= 75;
  const item = (isEligible ? r.eligibleMatches : r.nearMatches)[0];
  assert.equal(item.matchScore, expected); assert.equal(item.eligible, isEligible);
  assert.deepEqual(run([c, candidate('other')]), run([candidate('other'), c]));
});
