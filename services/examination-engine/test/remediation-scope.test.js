'use strict';
// The re-examination gate belongs to the agent, not to one configuration of it:
// an L1 fingerprint is self-declared, so changing a declared field must not
// skip a remediation. Training carries the remediation over to the new
// configuration instead (training-service, decideCarriedRemediation).
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRemediation } = require('../remediation-routes');

const PKG = { id: 'ai-safety-fundamentals', version: '0.2.0' };
const event = { eventId: 'examination.remediation.required:attempt-1', agentLearnerKey: 'agent-1',
  configurationFingerprint: 'sha256:failed-configuration', package: PKG };

// A store holding one remediation event for the agent and no re-examination.
const store = {
  hasAttemptAwaitingOutcome: async () => false,
  latestRemediationEvent: async ({ agentLearnerKey, packageId, packageVersion }) =>
    (agentLearnerKey === event.agentLearnerKey && packageId === PKG.id && packageVersion === PKG.version ? event : null),
  findReexaminations: async () => [],
  get: async () => null,
};
const gate = (completion) => requireRemediation(store, { actor: 'agent-1', pkg: PKG, completion, now: '2026-11-16T00:00:00Z' });

test('a standard training completion, from any configuration, does not open the gate after a failure', async () => {
  await assert.rejects(gate({ sessionKind: 'standard', configurationFingerprint: 'sha256:changed-configuration' }),
    (error) => error.code === 'remediation_required');
});

test('completing the remediation, also when it was carried over to a new configuration, opens the gate', async () => {
  await assert.doesNotReject(gate({ sessionKind: 'remediation', remediationRequestId: event.eventId,
    configurationFingerprint: 'sha256:changed-configuration' }));
});

test('a remediation the agent completed opens the gate even when later training is the latest completion', async () => {
  const asked = [];
  const completed = (eventId) => { asked.push(eventId); return Promise.resolve(true); };
  await assert.doesNotReject(requireRemediation(store, { actor: 'agent-1', pkg: PKG, completion: { sessionKind: 'standard' },
    now: '2026-11-16T00:00:00Z', remediationCompleted: completed }));
  assert.deepEqual(asked, [event.eventId]);
  await assert.rejects(requireRemediation(store, { actor: 'agent-1', pkg: PKG, completion: { sessionKind: 'standard' },
    now: '2026-11-16T00:00:00Z', remediationCompleted: async () => false }), (error) => error.code === 'remediation_required');
});
