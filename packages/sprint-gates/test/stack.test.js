'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEnv, requireActivePackage } = require('../src/stack');

const review = (reviewer, approved = true) => ({ event: 'review_submitted', reviewer_id: reviewer, approved });
const driverWith = (active) => ({ activePackage: async () => active });

test('a package approved by two distinct named reviewers is accepted, with the approvers recorded', async () => {
  const result = await requireActivePackage(driverWith({ packageId: 'p', version: '1', objectives: [{ id: 'o1' }],
    evidence: [review('ana'), review('ben'), { event: 'activated' }] }));
  assert.deepEqual(result, { packageId: 'p', version: '1', approvers: ['ana', 'ben'], objectives: [{ id: 'o1' }] });
});

test('one reviewer approving twice, or a rejection, does not count as two approvals', async () => {
  await assert.rejects(requireActivePackage(driverWith({ packageId: 'p', version: '1',
    evidence: [review('ana'), review('ana'), review('ben', false)] })), /1 distinct approving reviewers/);
});

test('approvals made with the demo\'s scripted reviewer credentials are refused', async () => {
  await assert.rejects(requireActivePackage(driverWith({ packageId: 'p', version: '1',
    evidence: [review('reviewer-1-dev'), review('reviewer-2-dev')] }), { scriptedReviewerIds: ['reviewer-1-dev', 'reviewer-2-dev'] }),
  /scripted reviewer credentials/);
});

test('no Active package fails the check instead of creating one', async () => {
  await assert.rejects(requireActivePackage(driverWith(null)), /no Active package/);
});

test('a .env without the admin and curriculum keys stops the gate at startup', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-env-')), '.env');
  fs.writeFileSync(file, 'ADMIN_CLIENT_ID=admin\nGATEWAY_PORT=8080\n');
  assert.throws(() => readEnv(file), /missing ADMIN_CLIENT_SECRET, CURRICULUM_INTERNAL_KEY/);
});
