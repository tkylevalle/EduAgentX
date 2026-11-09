'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENARIOS, INCIDENT_FIELDS, createEvidenceRecord, verifyEvidenceRecord, verifyEvidenceSet, findSecrets } = require('../src');

const byId = (id) => SCENARIOS.find((scenario) => scenario.id === id);
const T0 = '2026-11-08T10:00:00.000Z';
const T1 = '2026-11-08T10:00:42.000Z';
const artifactsFor = (scenario) => Object.fromEntries(scenario.evidenceRequired.map((key) => [key, { ref: `${key}-ref`, sha256: 'a'.repeat(64) }]));
const incidentInput = { affectedIds: { attemptId: 'attempt-1' }, recoveryOutcome: 'recovered', detectedAt: T0, recoveredAt: T1 };

function record(scenario, overrides = {}) {
  return createEvidenceRecord({
    scenario, runId: 'run-1', executorMode: scenario.evidenceMode, startedAt: T0, finishedAt: T1,
    artifacts: artifactsFor(scenario), checks: [{ name: 'forbidden outcome did not occur', passed: true }],
    incident: scenario.injectedFault ? incidentInput : null, outcome: 'recovered', ...overrides,
  });
}
const tamper = (rec, changes) => ({ ...rec, ...changes });

test('a clean scenario produces a valid evidence record', () => {
  const scenario = byId('clean-lifecycle-matching');
  const rec = record(scenario);
  assert.deepEqual(verifyEvidenceRecord(rec, scenario).errors, []);
  assert.equal(rec.incident, null);
});

test('record digests are deterministic', () => {
  const scenario = byId('near-matches');
  assert.equal(record(scenario).digest, record(scenario).digest);
});

test('a fault record carries the declared incident fields', () => {
  const scenario = byId('credential-tampering');
  const rec = record(scenario);
  for (const field of INCIDENT_FIELDS) assert.ok(rec.incident[field], field);
  assert.equal(rec.incident.safeState, scenario.injectedFault.safeState.state);
  assert.equal(rec.incident.category, scenario.injectedFault.assuranceIncident.category);
});

for (const scenario of SCENARIOS.filter((item) => item.injectedFault && item.evidenceMode !== 'live')) {
  test(`${scenario.id} evidence set verifies`, () => {
    assert.deepEqual(verifyEvidenceSet(scenario, [record(scenario)]).errors, []);
  });
}

test('editing a record breaks its digest', () => {
  const scenario = byId('credential-tampering');
  const rec = tamper(record(scenario), { outcome: 'passed' });
  assert.match(verifyEvidenceRecord(rec, scenario).errors.join(' '), /digest/);
});

test('a record cannot be created in a mode the scenario does not allow', () => {
  assert.throws(() => record(byId('certification-recovery'), { executorMode: 'live' }), /cannot be run in live mode/);
});

test('a replay record labelled live is rejected', () => {
  const scenario = byId('live-budget-exhaustion-replay');
  const replay = createEvidenceRecord({ scenario, runId: 'r', executorMode: 'replay', startedAt: T0, finishedAt: T1,
    artifacts: {}, checks: [{ name: 'c', passed: true }], outcome: 'completed' });
  const mislabelled = tamper(replay, { evidenceMode: 'live' });
  assert.match(verifyEvidenceRecord(mislabelled, scenario).errors.join(' '), /evidenceMode must equal/);
});

test('the replay record uses the replay executor identity', () => {
  const scenario = byId('live-budget-exhaustion-replay');
  const replay = createEvidenceRecord({ scenario, runId: 'r', executorMode: 'replay', startedAt: T0, finishedAt: T1,
    artifacts: {}, checks: [{ name: 'c', passed: true }], outcome: 'completed' });
  assert.equal(replay.learnerIdentity, 'replay-agent-learner-dev');
  assert.equal(replay.environment, 'simulation');
});

test('the live budget scenario needs both a live and a replay record', () => {
  const scenario = byId('live-budget-exhaustion-replay');
  const live = createEvidenceRecord({ scenario, runId: 'l', executorMode: 'live', startedAt: T0, finishedAt: T1,
    artifacts: { liveRunCounters: { calls: 60 }, haltRecord: { reason: 'maxCalls' } },
    checks: [{ name: 'halted at bound', passed: true }], incident: incidentInput, outcome: 'system-aborted' });
  const replay = createEvidenceRecord({ scenario, runId: 'r', executorMode: 'replay', startedAt: T0, finishedAt: T1,
    artifacts: { replayRunResult: { ok: true }, modeLabels: { live: 'live', replay: 'replay' } },
    checks: [{ name: 'labelled replay', passed: true }], outcome: 'completed' });
  assert.equal(live.environment, 'live');
  assert.deepEqual(verifyEvidenceSet(scenario, [live, replay]).errors, []);
  assert.match(verifyEvidenceSet(scenario, [live]).errors.join(' '), /both a live record and a replay record/);
});

test('an evidence set missing an artifact is rejected', () => {
  const scenario = byId('clean-lifecycle-matching');
  const partial = record(scenario, { artifacts: { registration: { ref: 'x' } } });
  assert.match(verifyEvidenceSet(scenario, [partial]).errors.join(' '), /missing evidence artifacts/);
});

test('a fault scenario with no incident is rejected', () => {
  const scenario = byId('certification-recovery');
  const noIncident = record(scenario, { incident: null });
  assert.match(verifyEvidenceSet(scenario, [noIncident]).errors.join(' '), /Assurance Incident/);
});

test('a clean scenario cannot carry an incident', () => {
  const scenario = byId('near-matches');
  assert.throws(() => record(scenario, { incident: incidentInput }), /declares no fault/);
});

test('an incident with a changed Safe State is rejected', () => {
  const scenario = byId('fingerprint-invalidation');
  const rec = record(scenario);
  const bad = tamper(rec, { incident: { ...rec.incident, safeState: 'Blocked' } });
  assert.match(verifyEvidenceRecord(bad, scenario).errors.join(' '), /Safe State/);
});

test('secrets and raw credentials are found at any depth', () => {
  const jws = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  const found = findSecrets({ a: { privateKey: 'x' }, b: [{ ok: 1 }, { header: `Bearer ${'z'.repeat(12)}` }], c: { credential: jws } });
  assert.equal(found.length, 3);
});

test('a record containing a raw credential is rejected', () => {
  const scenario = byId('credential-tampering');
  const jws = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  const rec = record(scenario, { artifacts: { ...artifactsFor(scenario), originalVerification: { credential: jws } } });
  assert.match(verifyEvidenceRecord(rec, scenario).errors.join(' '), /secret or raw credential/);
});

test('a record with a finish time before its start is rejected', () => {
  const scenario = byId('near-matches');
  const rec = record(scenario, { startedAt: T1, finishedAt: T0 });
  assert.match(verifyEvidenceRecord(rec, scenario).errors.join(' '), /before startedAt/);
});

test('a record for a different scenario is rejected', () => {
  const rec = record(byId('near-matches'));
  assert.match(verifyEvidenceRecord(rec, byId('unsupported-domain-refusal')).errors.join(' '), /scenarioId/);
});
