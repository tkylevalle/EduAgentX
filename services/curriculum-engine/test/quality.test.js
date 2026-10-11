'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const candidate = require('../examples/ai-safety-candidate');
const { measureCurriculum } = require('../quality');

test('canonical Candidate has complete mechanical traceability and objective coverage, not human approval', () => {
  const metrics = measureCurriculum(candidate);
  assert.deepEqual(metrics.sourceTraceability, { numerator: 20, denominator: 20, ratio: 1, invariantMet: true });
  assert.equal(metrics.objectiveCoverage.ratio, 1);
  assert.equal(metrics.reviewerQuality.mean, null);
  assert.equal(metrics.knownCriticalFactualErrors, null);
});

test('missing pinpoint lowers measured traceability; distinct approval mean uses the 3.5 floor', () => {
  const pkg = structuredClone(candidate);
  pkg.modules[0].claims[0].pinpoint = '';
  pkg.objectives[0].examSlotIds = ['r1'];
  const metrics = measureCurriculum(pkg, [
    { reviewer_id: 'one', score: 3.5, approved: true },
    { reviewer_id: 'two', score: 3.5, approved: true },
  ]);
  assert.equal(metrics.sourceTraceability.ratio, 19 / 20);
  assert.equal(metrics.objectiveCoverage.ratio, 4 / 5);
  assert.equal(metrics.objectiveCoverage.floorMet, false);
  assert.equal(metrics.reviewerQuality.floorMet, true);
  assert.equal(metrics.reviewerQuality.targetMet, false);
});
