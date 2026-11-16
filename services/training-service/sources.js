'use strict';

// Training reads other services only through these two interfaces, never
// through their tables. The real HTTP clients come later, once the Active
// package state is durable; tests inject the fakes below.
//
// PackageSource
//   getActive(options, selector?) -> Promise<PackageRecord | null>   the Active package of one domain;
//                         selector { domain } or { packageId }, none for the only one
//   getById(id, options)  -> Promise<PackageRecord | null>
//   PackageRecord = { id, version, state, digest, payload: { objectives, modules } }
//   `digest` is the validation service's own digest and is what a session pins.
//
// RegistrySource
//   getRegistration(agentLearnerKey, options)
//     -> Promise<{ agentLearnerKey, configurationFingerprint, configurationVersion } | null>
//
// `options` may carry { correlationId } for the downstream call.
// Both return null for "not found" and throw when the owner is unreachable.
// Null can block a session; an outage must not, so the caller retries and
// writes nothing.

function createFakePackageSource(records = []) {
  const byId = new Map(records.map((record) => [record.id, structuredClone(record)]));
  const copy = (record) => (record ? structuredClone(record) : null);
  return {
    async getActive(options, { domain, packageId } = {}) {
      return copy([...byId.values()].find((record) => record.state === 'Active' &&
        (!domain || record.domainId === domain) && (!packageId || record.id === packageId)));
    },
    async getById(id) { return copy(byId.get(id)); },
    // Test helpers that stand in for activation, quarantine and silent edits.
    setState(id, state) { byId.get(id).state = state; },
    setDigest(id, digest) { byId.get(id).digest = digest; },
    remove(id) { byId.delete(id); },
  };
}

function createFakeRegistrySource(registrations = []) {
  const byKey = new Map(registrations.map((registration) => [registration.agentLearnerKey, { ...registration }]));
  return {
    async getRegistration(agentLearnerKey) {
      const registration = byKey.get(agentLearnerKey);
      return registration ? { ...registration } : null;
    },
    // Mirrors the Registry: a new fingerprint records a new configuration version.
    setFingerprint(agentLearnerKey, configurationFingerprint) {
      const registration = byKey.get(agentLearnerKey);
      registration.configurationFingerprint = configurationFingerprint;
      registration.configurationVersion += 1;
    },
  };
}

module.exports = { createFakePackageSource, createFakeRegistrySource };
