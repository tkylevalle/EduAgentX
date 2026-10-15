'use strict';

// The governing inputs an attempt is locked to: the one Active, unquarantined
// package and the learner's registered configuration fingerprint. A changed
// input is a 409 refusal; an unreachable source is a DependencyError.

const { fail } = require('./lifecycle');

function createGovernance(sources) {
  async function active(correlationId) {
    const pkg = await sources.activePackage(correlationId);
    if (!pkg || pkg.state !== 'Active' || pkg.certificationBlocked || !Array.isArray(pkg.quarantinedScopes) ||
      pkg.quarantinedScopes.length) throw fail('active_package_required');
    return pkg;
  }
  // Returns the active package when it and the fingerprint still match the attempt.
  async function verify(attempt, correlationId) {
    const pkg = await active(correlationId);
    const registration = await sources.registration(attempt.agentLearnerKey, correlationId);
    if (pkg.packageId !== attempt.package.id || pkg.version !== attempt.package.version || pkg.digest !== attempt.package.digest ||
      registration?.configurationFingerprint !== attempt.configurationFingerprint) throw fail('attempt_governance_changed');
    return pkg;
  }
  return { active, verify };
}

module.exports = { createGovernance };
