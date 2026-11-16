'use strict';

// Recording and replaying rubric-judge verdicts. Recording here uses a fake
// fetch in place of the model endpoint; replay needs no key and no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { measure } = require('../src/measure');
const { SCHEMA_VERSION, loadVerdicts } = require('../src/verdicts');
const { DEFAULT_MODEL } = require('../../../services/grading-service/src/judge');
const { graderIdentity } = require('../../../services/grading-service/src/rubric-grader');

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verdicts-')), 'judge-verdicts.json');

// A fake model that scores the second sight of the same input lower, so a
// repeat differs from the first verdict.
function fakeModel() {
  const calls = [];
  const seen = new Map();
  const fetchImpl = async (url, options) => {
    calls.push(JSON.parse(options.body));
    seen.set(options.body, (seen.get(options.body) || 0) + 1);
    const verdict = { criticalViolationRuleIds: [], score: seen.get(options.body) === 1 ? 90 : 84, rationale: 'Fake verdict.' };
    const body = { choices: [{ message: { content: JSON.stringify(verdict) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, calls };
}

test('recording calls the live judge and writes each verdict and a separate repeat verdict', async () => {
  const file = tempFile();
  const model = fakeModel();
  const report = await measure({ record: true, env: { OPENCODE_API_KEY: 'test-key' }, file, fetchImpl: model.fetchImpl });
  const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(recorded.schemaVersion, SCHEMA_VERSION);
  assert.match(recorded.note, /real output/);
  assert.deepEqual(recorded.grader, graderIdentity(DEFAULT_MODEL));
  assert.equal(recorded.judge.model, DEFAULT_MODEL);
  const firstPass = Object.keys(recorded.verdicts).length;
  const repeatPass = Object.keys(recorded.repeat).length;
  assert.ok(firstPass > 0 && repeatPass > 0);
  // Probes reuse the dataset's answers, so they add no call beyond the two passes.
  assert.equal(model.calls.length, firstPass + repeatPass);
  assert.deepEqual(recorded.usage, { calls: model.calls.length, promptTokens: 10 * model.calls.length, completionTokens: 5 * model.calls.length });
  assert.equal(report.judge.mode, 'record');
  assert.ok(model.calls.every((call) => call.temperature === 0 && call.model === DEFAULT_MODEL));
  assert.ok(report.measures.provisional.repeatVariance > 0, 'the repeat is a second live verdict, not the cache');
});

test('replay gives the recorded report with no key and no network', async () => {
  const file = tempFile();
  const recordedRun = await measure({ record: true, env: { OPENCODE_API_KEY: 'test-key' }, file, fetchImpl: fakeModel().fetchImpl });
  const noNetwork = async () => { throw new Error('replay must not call a model'); };
  const replayed = await measure({ env: {}, file, fetchImpl: noNetwork });
  assert.equal(replayed.judge.mode, 'replay');
  assert.deepEqual(replayed.measures, recordedRun.measures);
  // Probe percentages also depend on sandbox worlds, which differ per attempt id; outcomes do not.
  const outcomes = (report) => report.probes.map((probe) => [probe.id, probe.holds]);
  assert.deepEqual(outcomes(replayed), outcomes(recordedRun));
  assert.deepEqual(replayed.grader, recordedRun.grader);
});

test('replay without a recorded verdict fails closed instead of inventing one', async () => {
  await assert.rejects(measure({ env: { OPENCODE_API_KEY: 'present-but-unused-in-replay' }, file: tempFile() }),
    /grading route returned 503: judge_not_configured/);
});

test('recording without a key is refused before any grading', async () => {
  await assert.rejects(measure({ record: true, env: {}, file: tempFile() }), /cannot record verdicts: judge_not_configured/);
});

test('a verdicts file of another schema is refused', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'other', verdicts: {}, repeat: {} }));
  assert.throws(() => loadVerdicts(file), /is not a grading-judge-verdicts/);
});
