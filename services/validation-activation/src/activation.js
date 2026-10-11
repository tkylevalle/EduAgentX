const { db } = require('./db');

async function activatePackage(package_id) {
  const pkg = await db.getPackage(package_id);
  if (!pkg) throw new Error('package_not_found');
  return db.activatePackage(package_id, pkg.version, pkg.digest);
}

module.exports = { activatePackage };
