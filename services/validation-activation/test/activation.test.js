'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { activatePackage } = require('../src/activation');

const stub = (id) => ({ id, version: '1.0.0', manifest: {}, modules: [], objectives: [],
  examination_template: {}, rubric: {}, fallback_bank: {} });

test('first package activates with no superseded', async () => {
  await db.seedPackage(stub('pkg-a1'));
  const result = await activatePackage('pkg-a1');
  assert.strictEqual(result.superseded_id, null);
  const pkg = await db.getPackage('pkg-a1');
  assert.strictEqual(pkg.state, 'Active');
});

test('second activation supersedes first atomically', async () => {
  await db.seedPackage(stub('pkg-b1'));
  await db.seedPackage(stub('pkg-b2'));
  await activatePackage('pkg-b1');
  const result = await activatePackage('pkg-b2');
  assert.strictEqual(result.superseded_id, 'pkg-b1');
  const p1 = await db.getPackage('pkg-b1');
  const p2 = await db.getPackage('pkg-b2');
  assert.strictEqual(p1.state, 'Superseded');
  assert.strictEqual(p2.state, 'Active');
});

test('active pointer updated after activation', async () => {
  await db.seedPackage(stub('pkg-c1'));
  await db.seedPackage(stub('pkg-c2'));
  await activatePackage('pkg-c1');
  await activatePackage('pkg-c2');
  const active = await db.getActivePackage();
  assert.strictEqual(active.id, 'pkg-c2');
});
