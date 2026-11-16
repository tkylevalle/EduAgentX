'use strict';
// The re-examination gate belongs to the configuration that failed. Training
// ends a reconfigured agent's old sessions as configuration_changed, so if the
// gate followed the agent key alone, a reconfigured agent could never be
// examined on that package version again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRemediation } = require('../remediation-routes');

const PKG = { id: 'ai-safety-fundamentals', version: '0.2.0' };
const FAILED = 'sha256:failed-configuration';
const event = { eventId: 'examination.remediation.requested:attempt-1', agentLearnerKey: 'agent-1', configurationFingerprint: FAILED,
  package: PKG };

// A store holding one remediation event for the failed configuration and no re-examination.
const storeWith = () => ({
  hasAttemptAwaitingOutcome: async () => false,
  latestRemediationEvent: async ({ agentLearnerKey, packageId, packageVersion, configurationFingerprint = null }) =>
    (agentLearnerKey === event.agentLearnerKey && packageId === PKG.id && packageVersion === PKG.version &&
      (configurationFingerprint === null || configurationFingerprint === event.configurationFingerprint) ? event : null),
  findReexaminations: async () => [],
  get: async () => null,
});
const gate = (configurationFingerprint, completion = { sessionKind: 'standard' }) =>
  requireRemediation(storeWith(), { actor: 'agent-1', pkg: PKG, completion, now: '2026-11-16T00:00:00Z', configurationFingerprint });

test('the configuration that failed still needs its remediation before a new attempt', async () => {
  await assert.rejects(gate(FAILED), (error) => error.code === 'remediation_required');
});

test('a reconfigured agent may sit a new standard attempt after its earlier configuration failed', async () => {
  await assert.doesNotReject(gate('sha256:changed-configuration'));
});

test('with no known fingerprint, any configuration\'s remediation gates the attempt', async () => {
  await assert.rejects(gate(null), (error) => error.code === 'remediation_required');
});

test('the completed remediation session opens the gate for the configuration that failed', async () => {
  await assert.doesNotReject(gate(FAILED, { sessionKind: 'remediation', remediationRequestId: event.eventId }));
});
