'use strict';
// Independent contract oracle: no grader, reducer, matcher or executor import.
// Inputs are the frozen narrative, never the system result being predicted.
const { digest } = require('./identity');
function predict(s) {
  const e = s.expected, candidate = e.marketplace !== 'not_applicable';
  return {
    registrationStatus: e.registration.status, configurationVersion: e.registration.configurationVersion,
    trainingStatus: e.training.status, status: e.examination.status, terminalReason: e.examination.terminalReason,
    failureReasonsInclude: [...e.examination.failureReasonsInclude], criticalRuleIds: [...e.examination.criticalRuleIds],
    originalCredentialCount: e.certification.original === 'required' ? 1 : 0,
    remediationRequired: e.remediation.required,
    reexaminationStatus: e.reexamination?.status || 'not_applicable',
    certificationDecision: candidate ? 'certified' : 'none', credentialVerified: candidate ? 'VALID' : 'not_applicable',
    marketplaceLane: candidate ? 'Eligible' : 'neither',
    marketplaceReasonCodes: [], marketplacePolicy: candidate ? 'MATCH-POLICY-1.0.0' : 'not_applicable',
    environment: 'simulation', evidenceMode: 'synthetic',
    mandatorySafety: e.examination.criticalRuleIds.length > 0,
  };
}
function compare(s, observed, marketplace) {
  const expected = predict(s), missing = [], mismatches = [];
  const same = (field, actual, wanted) => {
    if (actual === undefined || actual === null) missing.push(field);
    else if (actual !== wanted) mismatches.push(field);
  };
  for (const key of ['registrationStatus', 'configurationVersion', 'trainingStatus', 'status', 'terminalReason',
    'originalCredentialCount', 'remediationRequired', 'reexaminationStatus', 'certificationDecision', 'credentialVerified'])
    same(key, observed?.[key], expected[key]);
  for (const key of ['failureReasonsInclude', 'criticalRuleIds']) {
    const actual = observed?.[key === 'failureReasonsInclude' ? 'failureReasons' : key];
    if (!Array.isArray(actual)) missing.push(key);
    else if (key === 'criticalRuleIds' ? JSON.stringify([...actual].sort()) !== JSON.stringify([...expected[key]].sort()) :
      expected[key].some(v => !actual.includes(v))) mismatches.push(key);
  }
  if (expected.mandatorySafety) same('safetyDetected', observed?.safetyDetected, true);
  if (expected.marketplaceLane === 'Eligible') {
    same('marketplaceLane', marketplace?.selfLane, expected.marketplaceLane);
    same('marketplacePolicy', marketplace?.policyVersion, expected.marketplacePolicy);
    same('marketplaceTrust', marketplace?.allTrustChecksPassed, true);
    same('marketplaceEnvironment', marketplace?.environment, expected.environment);
    same('marketplaceEvidenceMode', marketplace?.evidenceMode, expected.evidenceMode);
    same('marketplaceReasons', marketplace?.selfReasonCount, 0);
  }
  return { version: 'issue-33-oracle/1.0.0', expectedHash: digest(expected),
    status: mismatches.length ? 'MISMATCH' : missing.length ? 'UNMEASURED' : 'CONFORMANT',
    missing, mismatches };
}
module.exports = { predict, compare };
