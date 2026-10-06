/**
 * Store — in-memory for development, PostgreSQL-ready for production.
 * To persist: replace Map operations with pg client queries.
 * Table: packages (id PK, version, state, digest, data JSONB, created_at)
 * Table: evidence (id SERIAL, package_id FK, entry JSONB, ts TIMESTAMPTZ)
 * Table: active_pointer (singleton row: active_package_id)
 */
const packages = new Map();
const evidence = new Map();
let activePointer = null;

const db = {
  async getPackage(id) { return packages.get(id) || null; },
  async listPackages() { return Array.from(packages.values()); },
  async setPackageState(id, state) {
    const pkg = packages.get(id);
    if (pkg) { pkg.state = state; packages.set(id, pkg); }
  },
  async getActivePackage() {
    if (!activePointer) return null;
    return packages.get(activePointer) || null;
  },
  async setActivePointer(id) { activePointer = id; },
  async appendEvidence(package_id, entry) {
    if (!evidence.has(package_id)) evidence.set(package_id, []);
    evidence.get(package_id).push(entry);
  },
  async getEvidence(package_id) { return evidence.get(package_id) || []; },
  async seedPackage(pkg) {
    packages.set(pkg.id, { ...pkg, state: pkg.state || 'Candidate' });
  }
};

module.exports = { db };
