'use strict';
// Fresh-cohort executable revision. The v1 aspirational 90/80, ten-day
// fixture specification remains intact in marketplace.js for historical review.
const { digest, identity } = require('./identity');
const ALLOCATION = { eligible: 20, gaps: 20, trust: 20, ranking: 15, history: 15, limits: 10 };
const facts = Object.freeze({ overallPercent: 94.4, adversarialPercent: 86,
  objectiveIds: ['o1','o2','o3','o4','o5'], assessmentMode: 'standard', environment: 'simulation', evidenceMode: 'synthetic' });
const families = Object.entries(ALLOCATION).flatMap(([family, n]) => Array.from({ length: n }, (_, index) => {
  const request = { domain: 'ai-agent-safety-secure-tool-use', requiredObjectiveIds: ['o1'], minOverallPercent: 80,
    minAdversarialPercent: 70, maxCredentialAgeDays: 365, allowedAssessmentModes: ['standard'],
    requiredEnvironment: 'simulation', preferredObjectiveIds: ['o1','o2'] };
  let action = 'replay', reason = null;
  if (family === 'eligible') {
    request.minOverallPercent = [80,94,95,94][index % 4];
    request.minAdversarialPercent = [70,86,86,87][index % 4];
    reason = index % 4 === 2 ? 'SCORE_OVERALL_BELOW' : index % 4 === 3 ? 'SCORE_ADVERSARIAL_BELOW' : null;
  }
  if (family === 'gaps') {
    if (index % 5 === 0) { request.requiredObjectiveIds = ['o1','not-assessed']; reason = 'OBJECTIVE_MISSING'; }
    if (index % 5 === 1) { request.minOverallPercent = 95; reason = 'SCORE_OVERALL_BELOW'; }
    if (index % 5 === 2) { request.minAdversarialPercent = 87; reason = 'SCORE_ADVERSARIAL_BELOW'; }
    if (index % 5 === 3) { request.allowedAssessmentModes = ['fallback']; reason = 'MODE_NOT_ALLOWED'; }
    if (index % 5 === 4) { request.requiredObjectiveIds = ['o1','not-assessed']; request.minOverallPercent = 95; reason = 'OBJECTIVE_MISSING'; }
  }
  if (family === 'trust') {
    action = ['suspend','revoke','fingerprint','withdraw','environment'][index % 5];
    reason = ['STATUS_SUSPENDED','STATUS_REVOKED','FINGERPRINT_MISMATCH','NOT_DISCOVERABLE','ENVIRONMENT_MISMATCH'][index % 5];
    if (action === 'environment') request.requiredEnvironment = 'live';
  }
  if (family === 'ranking') request.preferredObjectiveIds = [['o1'], ['o1','not-assessed'], ['not-assessed']][index % 3];
  if (family === 'history') action = ['close','version','suspend-history'][index % 3];
  if (family === 'limits') { action = 'representative'; if (index % 2) request.minOverallPercent = 95; }
  const id = `golden-v2-${family}-${String(index+1).padStart(3,'0')}`;
  return { id, family, index, request, action, expectedPrincipalReason: reason,
    logicalRequestId: identity(id, 'capability-request'), expectedPolicy: 'MATCH-POLICY-1.0.0' };
}));
const golden = { schemaVersion: 'issue-33-marketplace-golden/2.0.0', version: '2.0.0', minimumAgents: 1000,
  minimumRequests: 100, facts, cases: families,
  additionalCoverage: { realAgedCredentialExclusion: 'REQUIRES_RETAINED_AGED_LIFECYCLE_COHORT',
    exactIssuanceTimestampTie: 'MEASURE_WHEN_REAL_COHORT_CONTAINS_TIE; PURE_CONTRACT_TEST_IS_SUPPORTING_ONLY' } };
function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
module.exports = { golden: deepFreeze(golden), goldenHash: digest(golden), ALLOCATION, facts };
