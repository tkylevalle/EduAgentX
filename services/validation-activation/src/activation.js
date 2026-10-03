const { db } = require('./db');

async function activatePackage(package_id) {
  // Get current active package
  const currentActive = await db.getActivePackage();
  const superseded_id = currentActive ? currentActive.id : null;

  // Atomic swap: archive old, activate new
  if (superseded_id && superseded_id !== package_id) {
    await db.setPackageState(superseded_id, 'Superseded');
  }
  await db.setPackageState(package_id, 'Active');
  await db.setActivePointer(package_id);

  return { superseded_id };
}

module.exports = { activatePackage };
