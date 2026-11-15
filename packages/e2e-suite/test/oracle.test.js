'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { manifest } = require('../manifest');
const { predict, compare } = require('../oracle');
function observation(s) {
  const e = predict(s);
  return { ...e, failureReasons: e.failureReasonsInclude, safetyDetected: e.mandatorySafety ? true : null };
}
const market = { selfLane: 'Eligible', policyVersion: 'MATCH-POLICY-1.0.0', allTrustChecksPassed: true,
  environment: 'simulation', evidenceMode: 'synthetic', selfReasonCount: 0 };
test('independent oracle predicts every frozen narrative and separates original and retake certification', () => {
  assert.ok(!/require\(['"].*(?:services|execution-provenance|executor|matching)/.test(fs.readFileSync(require.resolve('../oracle'), 'utf8')));
  for (const s of manifest.scenarios) {
    const e = predict(s);
    assert.equal(compare(s, observation(s), market).status, 'CONFORMANT');
    assert.equal(compare(s, { ...observation(s), criticalRuleIds: [...e.criticalRuleIds, 'unexpected-critical'] }, market).status, 'MISMATCH');
    assert.equal(e.originalCredentialCount, s.category === 'competent' ? 1 : 0);
    if (s.category === 'remediable') {
      assert.equal(e.status, 'agent_failed'); assert.equal(e.reexaminationStatus, 'complete');
      assert.equal(e.certificationDecision, 'certified'); assert.equal(e.marketplaceLane, 'Eligible');
    }
  }
});
test('no runtime outcome can rewrite the expected oracle; missing data is not success', () => {
  for (const s of manifest.scenarios.filter((_, i) => i % 200 === 0)) {
    const correct = observation(s), before = predict(s);
    assert.equal(compare(s, {}, {}).status, 'UNMEASURED');
    for (const field of ['registrationStatus', 'trainingStatus', 'status', 'terminalReason', 'originalCredentialCount',
      'remediationRequired', 'reexaminationStatus', 'certificationDecision', 'credentialVerified']) {
      assert.equal(compare(s, { ...correct, [field]: 'wrong' }, market).status, 'MISMATCH');
    }
    assert.deepEqual(predict(s), before);
    if (before.marketplaceLane === 'Eligible')
      assert.equal(compare(s, correct, { ...market, allTrustChecksPassed: false }).status, 'MISMATCH');
  }
  const unsafe = manifest.scenarios.find(s => s.category === 'adversarial');
  assert.equal(compare(unsafe, { ...observation(unsafe), criticalRuleIds: [], safetyDetected: false }, market).status, 'MISMATCH');
});
test('rehearsal selects 20 unchanged formal narratives per category', () => {
  const selected = require('../manifest').select('rehearsal');
  assert.equal(selected.length, 100);
  for (const c of Object.keys(manifest.categories)) assert.equal(selected.filter(s => s.category === c).length, 20);
  assert.ok(selected.every(s => manifest.scenarios.includes(s)));
});
