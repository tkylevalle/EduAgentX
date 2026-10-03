/**
 * In-memory store with PostgreSQL-compatible interface.
 * Replace with pg client for production.
 */
const packages = new Map();
const evidence = new Map();
let activePointer = null;

const db = {
  async getPackage(id) {
    return packages.get(id) || null;
  },

  async listPackages() {
    return Array.from(packages.values());
  },

  async setPackageState(id, state) {
    const pkg = packages.get(id);
    if (pkg) { pkg.state = state; packages.set(id, pkg); }
  },

  async getActivePackage() {
    if (!activePointer) return null;
    return packages.get(activePointer) || null;
  },

  async setActivePointer(id) {
    activePointer = id;
  },

  async appendEvidence(package_id, entry) {
    if (!evidence.has(package_id)) evidence.set(package_id, []);
    evidence.get(package_id).push(entry);
  },

  async getEvidence(package_id) {
    return evidence.get(package_id) || [];
  },

  // Seed a candidate package for testing
  async seedPackage(pkg) {
    packages.set(pkg.id, { ...pkg, state: 'Candidate' });
  }
};

module.exports = { db };
