'use strict';
// A two-person sign-off can stand in for per-response labels, and accept named
// probe failures, for one grader version. It never waives a measured failure.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applySignOff, validSignOff } = require('../src/signoff');

const GRADER = { id: 'rubric-judge', version: '1.0.0:model:prompt-2-abc' };
const PROBES = [{ id: 'brief-agent', expect: 'pass' }, { id: 'parrot-agent', expect: 'fail' }];
const red = (reasons) => ({ status: 'Red', reasons, grader: GRADER, probes: PROBES });
const signOff = (extra = {}) => ({
  schemaVersion: 'grading-validity-signoff/1.0.0', grader: GRADER, signedOn: '2026-11-17',
  reviewers: [{ name: 'Neeraj', approved: true }, { name: 'Luis', approved: true }],
  basis: 'Reviewed the grader and its report together; per-response labels were not collected.',
  acceptedLimitations: ['human_labels_insufficient', 'probe_failed:brief-agent'], ...extra });

test('two approving reviewers turn the missing labels and an accepted probe failure Green, saying what it rests on', () => {
  const report = applySignOff(red(['human_labels_insufficient', 'probe_failed:brief-agent']), signOff());
  assert.equal(report.status, 'Green');
  assert.deepEqual(report.reasons, []);
  assert.deepEqual(report.signOff.acceptedReasons, ['human_labels_insufficient', 'probe_failed:brief-agent']);
  assert.equal(report.signOff.measuredAgreement, false);
  assert.deepEqual(report.signOff.reviewers, ['Neeraj', 'Luis']);
});

test('a sign-off never waives a safety false pass, stale data, failing labels or a failed must-fail probe, even when it lists them', () => {
  for (const reason of ['mandatory_safety_false_pass', 'dataset_stale', 'human_measures_below_floor', 'probe_failed:parrot-agent']) {
    const report = applySignOff(red(['human_labels_insufficient', reason]), signOff({ acceptedLimitations: ['human_labels_insufficient', reason] }));
    assert.equal(report.status, 'Red', reason);
    assert.deepEqual(report.reasons, [reason], reason);
  }
});

test('a sign-off for another grader version, or without two distinct approving reviewers, changes nothing', () => {
  const reasons = ['human_labels_insufficient'];
  const cases = [
    signOff({ grader: { ...GRADER, version: '1.0.0:model:prompt-3-def' } }),
    signOff({ reviewers: [{ name: 'Neeraj', approved: true }] }),
    signOff({ reviewers: [{ name: 'Neeraj', approved: true }, { name: 'neeraj', approved: true }] }),
    signOff({ reviewers: [{ name: 'Neeraj', approved: true }, { name: 'Luis', approved: false }] }),
    signOff({ basis: '' }),
  ];
  for (const record of cases) {
    const report = applySignOff(red(reasons), record);
    assert.deepEqual([report.status, report.reasons, report.signOff], ['Red', reasons, null]);
  }
  assert.equal(validSignOff(null, GRADER), false);
});

test('a report that is already Green from measured labels is left as it is', () => {
  const green = { status: 'Green', reasons: [], grader: GRADER };
  assert.deepEqual(applySignOff(green, signOff()), { ...green, signOff: null });
});
