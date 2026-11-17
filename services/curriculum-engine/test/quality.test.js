'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const candidate = require('../examples/ai-safety-candidate');
const { measureCurriculum } = require('../quality');

test('canonical Candidate has complete mechanical traceability and objective coverage, not human approval', () => {
  const metrics = measureCurriculum(candidate);
  // 12 module claims, each quoting its section, and 15 fallback source links.
  assert.deepEqual(metrics.sourceTraceability, { numerator: 27, denominator: 27, ratio: 1, invariantMet: true });
  assert.equal(metrics.objectiveCoverage.ratio, 1);
  assert.equal(metrics.reviewerQuality.mean, null);
  assert.equal(metrics.knownCriticalFactualErrors, null);
});

test('missing pinpoint lowers measured traceability; distinct approval mean uses the 3.5 floor', () => {
  const pkg = structuredClone(candidate);
  pkg.modules[0].claims[0].pinpoint = '';
  pkg.modules[1].claims[0].quote = 'a culture of compliance within organizations that never test anything';
  pkg.objectives[0].examSlotIds = ['r1'];
  const metrics = measureCurriculum(pkg, [
    { reviewer_id: 'one', score: 3.5, approved: true },
    { reviewer_id: 'two', score: 3.5, approved: true },
  ]);
  assert.equal(metrics.sourceTraceability.ratio, 25 / 27, 'a missing pinpoint and a misquote each lower it');
  assert.equal(metrics.objectiveCoverage.ratio, 4 / 5);
  assert.equal(metrics.objectiveCoverage.floorMet, false);
  assert.equal(metrics.reviewerQuality.floorMet, true);
  assert.equal(metrics.reviewerQuality.targetMet, false);
});
