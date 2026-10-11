'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { activatePackage } = require('../src/activation');

const stub = (id, predecessor = null) => ({ id, version: '1.0.0', domain: `domain-${id.split('-')[1][0]}`,
  manifest: { predecessor }, modules: [], objectives: [],
  examination_template: {}, rubric: {}, fallback_bank: {} });
async function ready(id, predecessor = null) {
  await db.seedPackage(stub(id, predecessor));
  const pkg = await db.getPackage(id);
  await db.setPackageState(id, 'AwaitingReview', pkg.version);
  await db.submitReview(id, pkg.version, pkg.digest, { reviewer_id: `${id}-r1`, score: 3.5, approved: true });
  await db.submitReview(id, pkg.version, pkg.digest, { reviewer_id: `${id}-r2`, score: 4, approved: true });
}

test('first package activates with no superseded', async () => {
  await ready('pkg-a1');
  const result = await activatePackage('pkg-a1');
  assert.strictEqual(result.superseded_id, null);
  const pkg = await db.getPackage('pkg-a1');
  assert.strictEqual(pkg.state, 'Active');
});

test('second activation supersedes first atomically', async () => {
  await ready('pkg-b1');
  await ready('pkg-b2', { packageId: 'pkg-b1', version: '1.0.0' });
  await activatePackage('pkg-b1');
  const result = await activatePackage('pkg-b2');
  assert.strictEqual(result.superseded_id, 'pkg-b1');
  const p1 = await db.getPackage('pkg-b1');
  const p2 = await db.getPackage('pkg-b2');
  assert.strictEqual(p1.state, 'Superseded');
  assert.strictEqual(p2.state, 'Active');
});

test('active pointer updated after activation', async () => {
  await ready('pkg-c1');
  await ready('pkg-c2', { packageId: 'pkg-c1', version: '1.0.0' });
  await activatePackage('pkg-c1');
  await activatePackage('pkg-c2');
  const active = await db.getActivePackage();
  assert.strictEqual(active.id, 'pkg-c2');
});
