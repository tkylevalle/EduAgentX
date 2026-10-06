'use strict';

// Training reads other services only through these two interfaces, never
// through their tables. The real HTTP clients come later, once the Active
// package state is durable; tests inject the fakes below.
//
// PackageSource
//   getActive()  -> Promise<PackageRecord | null>   the current Active Domain Assurance Package
//   getById(id)  -> Promise<PackageRecord | null>
//   PackageRecord = { id, version, state, payload }
//   `payload` is the package content only. A real client must strip
//   envelope fields such as `state` and `evidence`, or the digest would
//   change every time a review is recorded.
//
// RegistrySource
//   getRegistration(agentLearnerKey)
//     -> Promise<{ agentLearnerKey, configurationFingerprint, configurationVersion } | null>
//
// Both return null for "not found" and throw when the owner is unreachable.
// Null can block a session; an outage must not, so the caller retries and
// writes nothing.

function createFakePackageSource(records = []) {
  const byId = new Map(records.map((record) => [record.id, structuredClone(record)]));
  const copy = (record) => (record ? structuredClone(record) : null);
  return {
    async getActive() { return copy([...byId.values()].find((record) => record.state === 'Active')); },
    async getById(id) { return copy(byId.get(id)); },
    // Test helpers that stand in for activation, quarantine and silent edits.
    setState(id, state) { byId.get(id).state = state; },
    setPayload(id, payload) { byId.get(id).payload = structuredClone(payload); },
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
