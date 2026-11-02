'use strict';
const { digest, command, identity } = require('./identity');
const { laneDuplicates } = require('./invariants');
// Declarative golden families. Named fixtures refer to REAL lifecycle setup,
// never rows to insert or credentials to sign in the harness.
const ALLOCATION = { eligible: 20, gaps: 20, trust: 20, ranking: 15, history: 15, limits: 10 };
const TRUST_CODES = ['LIFECYCLE_ORIGIN_UNCHECKABLE', 'ENVIRONMENT_UNCHECKABLE', 'EVIDENCE_MODE_UNCHECKABLE'];
const TRUST_CHECKS = ['lifecycle_origin', 'discoverable', 'signature', 'schema', 'status', 'expiry',
  'fingerprint', 'environment', 'domain', 'identity', 'evidence_mode'];
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const gapCodes = ['OBJECTIVE_MISSING', 'SCORE_OVERALL_BELOW', 'SCORE_ADVERSARIAL_BELOW', 'CREDENTIAL_TOO_OLD', 'MODE_NOT_ALLOWED'];
function declaration(family, index) {
  const request = { domain: 'ai-agent-safety-secure-tool-use', requiredObjectiveIds: ['o1'],
    minOverallPercent: 80, minAdversarialPercent: 70, maxCredentialAgeDays: 100,
    allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation', preferredObjectiveIds: ['o1', 'o2'] };
  let eligible = ['candidate-a'], near = [], excluded = [], reasons = [];
  if (family === 'eligible') {
    // Independently declared boundary: the fixture credential records 90/80.
    const boundaries = [[80,70,true], [90,80,true], [91,80,false], [90,81,false]];
    const [total, adv, passes] = boundaries[index % 4];
    request.minOverallPercent = total; request.minAdversarialPercent = adv;
    if (!passes) { eligible = []; near = ['candidate-a']; reasons = [total === 91 ? 'SCORE_OVERALL_BELOW' : 'SCORE_ADVERSARIAL_BELOW']; }
  }
  if (family === 'gaps') {
    eligible = []; near = ['candidate-a']; reasons = [gapCodes[index % 5]];
    if (index % 5 === 0) request.requiredObjectiveIds = ['o1', 'o2'];
    if (index % 5 === 1) request.minOverallPercent = 95;
    if (index % 5 === 2) request.minAdversarialPercent = 85;
    if (index % 5 === 3) request.maxCredentialAgeDays = 9;
    if (index % 5 === 4) request.allowedAssessmentModes = ['fallback'];
  }
  if (family === 'trust') {
    eligible = []; excluded = ['candidate-a'];
    reasons = [['STATUS_SUSPENDED'], ['STATUS_REVOKED'], ['FINGERPRINT_MISMATCH'], ['NOT_DISCOVERABLE'], ['ENVIRONMENT_MISMATCH']][index % 5];
  }
  if (family === 'ranking') eligible = ['candidate-a', 'candidate-b', 'candidate-c'];
  if (family === 'limits') { eligible = ['candidate-a', 'candidate-b', 'candidate-c', 'candidate-d', 'candidate-e']; near = ['near-a', 'near-b', 'near-c']; }
  return { request, expectedMembers: { eligible, near, excluded }, expectedReasonCodes: reasons,
    actions: family === 'history' ? [['match', 'retry_same_key', 'read_original'], ['match', 'close', 'retry_same_key'],
      ['match', 'suspend', 'fresh_match', 'read_original']][index % 3] : ['match', 'retry_same_key', 'read_original'],
    fixtureFacts: { candidateA: { overallPercent: 90, adversarialPercent: 80, assessedObjectives: ['o1'],
      preferredObjectivesCovered: 1, credentialAgeDays: 10, assessmentMode: 'standard' },
      exactTimePrecondition: ['gaps', 'ranking'].includes(family) ? 'real_governed_aged_or_tied_cohort_required' : 'record_authoritative_evaluation_time' } };
}
const golden = freeze({ schemaVersion: 'issue-33-marketplace-golden/1.0.0', version: '1.0.0',
  minimumAgents: 1000, minimumRequests: 100, policyVersion: 'MATCH-POLICY-1.0.0',
  cases: Object.entries(ALLOCATION).flatMap(([family, count]) => Array.from({ length: count }, (_, i) => ({
    id: `market-${family}-${String(i + 1).padStart(3, '0')}`, family, ...declaration(family, i),
    requestIdentity: identity(`market-${family}-${i + 1}`, 'capability-request'),
    preconditions: { lifecycleOrigin: true, signedEvidenceLabels: true,
      fixture: family === 'eligible' ? 'passing-discoverable' : family === 'gaps' ? 'trusted-request-shortfall' :
        family === 'trust' ? ['suspended', 'revoked', 'fingerprint-changed', 'withdrawn', 'cross-environment'][i % 5] :
        family === 'ranking' ? ['score-margin', 'recency-tie', 'stable-id-tie'][i % 3] :
        family === 'history' ? ['identical-retry', 'closed-request-replay', 'fresh-after-status-change'][i % 3] : 'multiple-credentials-and-lane-limit' },
    expected: { policyVersion: 'MATCH-POLICY-1.0.0', eligibleLimit: 5, nearLimit: 3, duplicateLearners: 0,
      trustBeforeRanking: true, immutableReplay: true, unsupportedNeverFabricated: true,
      lane: family === 'eligible' ? 'eligible' : family === 'gaps' ? 'near' : family === 'trust' ? 'excluded' : 'fixture-defined',
      // Literal independent arithmetic anchor from the approved policy: 90/80,
      // half preferences, age 10 of 100 days => 31.5 + 28 + 10 + 9 = 78.5.
      arithmeticAnchor: { total: 31.5, adversarial: 28, preferred: 10, recency: 9, final: 78.5 },
      fixtureOrder: family === 'ranking' ? ['candidate-a', 'candidate-b', 'candidate-c'] : null },
  }))) });

function assessGolden(spec, result, { expectedEligible, expectedNear, expectedExclusions, replay,
  expectedScores, expectedOrdering, expectedReasons, expectedComponents } = {}) {
  if (!result || !Array.isArray(result.exclusions)) return { status: 'BLOCKED', reason: 'matching_unavailable' };
  const blockedCodes = [...new Set(result.exclusions.flatMap(e => (e.reasons || []).map(r => r.code)).filter(c => TRUST_CODES.includes(c)))];
  const eligible = result.eligibleMatches || [], near = result.nearMatches || [];
  const appearances = [...eligible, ...near].map(a => ({ resultId: result.resultId, agentLearnerKey: a.agentLearnerKey }));
  const checks = [result.policyVersion === spec.expected.policyVersion, eligible.length <= 5, near.length <= 3,
    laneDuplicates(appearances) === 0, eligible.every(a => a.eligible === true),
    near.every(a => a.eligible === false && a.lane === 'Not Eligible'),
    [...eligible, ...near].every(a => Array.isArray(a.checks) && TRUST_CHECKS.every(gate =>
      a.checks.filter(c => c.tag === 'trust' && c.gate === gate && c.passed === true).length === 1) &&
      a.checks.filter(c => c.tag === 'trust').every(c => c.passed === true))];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (replay) checks.push(digest(result) === digest(replay));
  if (expectedScores) checks.push([...eligible, ...near].every(a => expectedScores[a.agentLearnerKey] === a.matchScore));
  if (expectedOrdering) checks.push([...eligible, ...near].every(a =>
    expectedOrdering[a.agentLearnerKey] === a.ordering?.decisiveCriterion));
  if (expectedComponents) checks.push([...eligible, ...near].every(a =>
    Object.entries(expectedComponents[a.agentLearnerKey] || {}).every(([name, points]) =>
      typeof a.components?.[name]?.points === 'number' && Math.abs(a.components[name].points - points) < 1e-10)));
  // An unrelated unavailable candidate must never hide a prohibited inclusion,
  // duplicate, bad component or broken replay in the observable lanes.
  if (checks.some(c => !c)) return { status: 'MISMATCH', reason: 'golden_contract_mismatch' };
  if (blockedCodes.length) return { status: 'BLOCKED', reason: 'marketplace_origin_integration', blockedCodes };
  if (expectedEligible) checks.push(same(eligible.map(a => a.agentLearnerKey), expectedEligible));
  if (expectedNear) checks.push(same(near.map(a => a.agentLearnerKey), expectedNear));
  if (expectedExclusions) checks.push(same(result.exclusions.map(a => a.agentLearnerKey).sort(), [...expectedExclusions].sort()));
  if (expectedReasons) for (const [learner, codes] of Object.entries(expectedReasons)) {
    const item = [...near, ...result.exclusions].find(a => a.agentLearnerKey === learner);
    checks.push(!!item && codes.every(code => [...(item.gaps || []), ...(item.reasons || [])].some(r => r.code === code)));
  }
  if (checks.some(c => !c)) return { status: 'MISMATCH', reason: 'golden_contract_mismatch' };
  // A generic envelope check cannot masquerade as a complete golden oracle.
  if (!expectedEligible || !expectedNear || !expectedExclusions)
    return { status: 'UNMEASURED', reason: 'independent_fixture_expectation_required' };
  return { status: 'CONFORMANT', reason: null };
}

async function observeMarketplace({ scenario, agent, admin, pkg, actor, cohort = [], now = Date.now }) {
  const c = command(scenario.id, 'market-match'), root = '/v1/marketplace';
  const publish = await agent.interact(scenario, 'publish', 'marketplace.listing.publish');
  if (![200, 201].includes(publish.status)) return { status: 'BLOCKED', reason: 'listing_unavailable' };
  try {
    const request = { domain: 'ai-agent-safety-secure-tool-use', title: identity(scenario.id, 'market-request'),
      requiredObjectiveIds: pkg.objectiveIds, minOverallPercent: 80, minAdversarialPercent: 70,
      maxCredentialAgeDays: 365, allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation' };
    const made = await admin.call('POST', `${root}/capability-requests`, {
      idempotencyKey: command(scenario.id, 'market-create').idempotencyKey, request }, c.correlationId);
    if (![200, 201].includes(made.status)) return { status: 'BLOCKED', reason: 'request_unavailable' };
    const requestId = made.body.request.id;
    const opened = await admin.call('POST', `${root}/capability-requests/${requestId}/open`, { version: 1 }, c.correlationId);
    if (opened.status !== 200) return { status: 'BLOCKED', reason: 'request_open_unavailable' };
    const started = now();
    const matched = await admin.call('POST', `${root}/capability-requests/${requestId}/matches`, { idempotencyKey: c.idempotencyKey }, c.correlationId);
    const matchingDurationMs = now() - started;
    if (![200, 201].includes(matched.status)) return { status: 'BLOCKED', reason: 'matching_unavailable', requestId };
    const result = matched.body.matchResult;
    const replay = await admin.call('POST', `${root}/capability-requests/${requestId}/matches`, { idempotencyKey: c.idempotencyKey }, c.correlationId);
    const inventory = await admin.call('GET', `/v1/admin/reconciliation/matches?${new URLSearchParams({ actor, idempotencyKey: c.idempotencyKey })}`, undefined, c.correlationId);
    const self = [...result.eligibleMatches, ...result.nearMatches, ...result.exclusions].some(a => a.agentLearnerKey === scenario.learnerId);
    // Pilot runs serially after all lifecycles. Only this learner publishes;
    // every earlier pilot listing is withdrawn in finally below. The expected
    // membership is declared from the successful lifecycle cohort, not derived
    // from the matching function or its output.
    const assessment = assessGolden(golden.cases[0], result, { replay: replay.body.matchResult,
      ...(self ? { expectedEligible: [scenario.learnerId], expectedNear: [],
        expectedExclusions: cohort.filter(k => k !== scenario.learnerId) } : {}) });
    // Missing projection is a blocker only after observable safety/replay checks.
    // It must never conceal an invalid inclusion elsewhere in the same result.
    return { ...assessment, ...(!self && assessment.status !== 'MISMATCH' ? { status: 'BLOCKED', reason: 'credential_projection_not_observed' } : {}),
      caseId: 'pilot-lifecycle-entry', requestId, resultId: result.resultId, idempotencyKey: c.idempotencyKey,
      durationMs: matchingDurationMs, observationDurationMs: now() - started,
      observedCandidates: result.totalEligible + result.totalNearMatches + result.exclusions.length,
      matchCount: inventory.status === 200 ? inventory.body.count : null,
      laneDuplicates: inventory.status === 200 ? laneDuplicates(inventory.body.appearances) : null,
      replayEqual: replay.status === 200 && digest(replay.body.matchResult) === digest(result) };
  } finally {
    const withdrawal = await agent.interact(scenario, 'withdraw-after-observation', 'marketplace.listing.withdraw');
    if (![200, 201].includes(withdrawal.status)) throw new Error('listing_cleanup_unavailable');
  }
}
module.exports = { golden, goldenHash: digest(golden), ALLOCATION, assessGolden, observeMarketplace };
