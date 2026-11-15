'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requireActivePackage } = require('../src/stack');

const review = (reviewer, approved = true) => ({ event: 'review_submitted', reviewer_id: reviewer, approved });
const driverWith = (active) => ({ activePackage: async () => active });

test('a package approved by two distinct reviewers is accepted, with the approvers recorded', async () => {
  const result = await requireActivePackage(driverWith({ packageId: 'p', version: '1',
    evidence: [review('ana'), review('ben'), { event: 'activated' }] }));
  assert.deepEqual(result, { packageId: 'p', version: '1', approvers: ['ana', 'ben'] });
});

test('one reviewer approving twice, or a rejection, does not count as two approvals', async () => {
  await assert.rejects(requireActivePackage(driverWith({ packageId: 'p', version: '1',
    evidence: [review('ana'), review('ana'), review('ben', false)] })), /1 distinct approving reviewers/);
});

test('no Active package fails the check instead of creating one', async () => {
  await assert.rejects(requireActivePackage(driverWith(null)), /no Active package/);
});
