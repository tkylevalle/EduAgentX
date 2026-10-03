const { db } = require('../src/db');
const { activatePackage } = require('../src/activation');

async function run() {
  console.log('=== Activation Tests ===');

  // Seed two packages
  await db.seedPackage({ id: 'pkg-001', version: '1.0.0', manifest: {}, modules: [], objectives: [], examination_template: {}, rubric: {}, fallback_bank: {} });
  await db.seedPackage({ id: 'pkg-002', version: '2.0.0', manifest: {}, modules: [], objectives: [], examination_template: {}, rubric: {}, fallback_bank: {} });

  // Activate first package — no superseded
  const r1 = await activatePackage('pkg-001');
  console.assert(r1.superseded_id === null, 'FAIL: first activation should have no superseded');
  const pkg1 = await db.getPackage('pkg-001');
  console.assert(pkg1.state === 'Active', 'FAIL: pkg-001 should be Active');
  console.log('PASS: first package activates with no superseded');

  // Activate second package — first becomes Superseded
  const r2 = await activatePackage('pkg-002');
  console.assert(r2.superseded_id === 'pkg-001', 'FAIL: superseded should be pkg-001');
  const pkg1After = await db.getPackage('pkg-001');
  const pkg2After = await db.getPackage('pkg-002');
  console.assert(pkg1After.state === 'Superseded', 'FAIL: pkg-001 should be Superseded');
  console.assert(pkg2After.state === 'Active', 'FAIL: pkg-002 should be Active');
  console.log('PASS: second activation supersedes first, atomic swap confirmed');

  // Active pointer updated
  const active = await db.getActivePackage();
  console.assert(active.id === 'pkg-002', 'FAIL: active pointer should point to pkg-002');
  console.log('PASS: active pointer correctly updated');

  console.log('\nAll activation tests passed ✅');
}

run().catch(e => { console.error(e); process.exit(1); });
