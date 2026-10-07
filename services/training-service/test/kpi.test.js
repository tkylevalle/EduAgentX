'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ACCEPTANCE_FLOOR, INITIAL_TARGET, REPORT_PATH, kpiStatus, measureCompletion } = require('../kpi/measure');

const DATASET = path.join(__dirname, '../kpi/completion-dataset.v1.json');

test('the controlled dataset meets the 90% Acceptance Floor and reports the 95% Target', async () => {
  const report = await measureCompletion();
  assert.ok(report.expectedCompletion >= ACCEPTANCE_FLOOR, `measured ${report.expectedCompletion}`);
  assert.ok(report.completionOfCompletable >= ACCEPTANCE_FLOOR, `of completable ${report.completionOfCompletable}`);
  assert.ok(report.checks.repliesStatingWeights > 0, 'the weights guarantee is checked on real replies');
  assert.deepEqual([report.acceptanceFloor, report.initialTarget], [0.9, 0.95]);
  assert.ok(['Green', 'Amber'].includes(report.status));
  assert.equal(report.invariantsHeld, true, JSON.stringify(report.invariants));
  assert.ok(report.dataset.scenarios >= 30);
  for (const signal of ['started', 'completed', 'remediated', 'resumed', 'aborted']) {
    assert.ok(report.sessionMetrics.counts[signal] > 0, `the dataset exercises ${signal}`);
  }
});

test('the committed evidence report matches a fresh measurement of the same dataset', async () => {
  const committed = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  assert.deepEqual(await measureCompletion(), committed,
    'rerun: node services/training-service/kpi/measure.js --write');
});

test('a wrong expectation is measured as a miss, and a false completion is Red', async (t) => {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const abandoned = dataset.scenarios.find((s) => s.id === 'abandon-01');
  const completes = dataset.scenarios.find((s) => s.id === 'clean-01');
  const broken = { ...dataset, scenarios: [
    { ...abandoned, expected: 'completed' },
    { ...completes, expected: 'open' },
    ...dataset.scenarios.filter((s) => s !== abandoned && s !== completes)] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-')), 'dataset.json');
  fs.writeFileSync(file, JSON.stringify(broken));
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  const report = await measureCompletion(file);
  assert.deepEqual(report.misses.map((m) => [m.id, m.observed]).sort(), [['abandon-01', 'open'], ['clean-01', 'completed']]);
  assert.equal(report.invariants.falseCompletions, 1);
  assert.equal(report.status, 'Red', 'an Invariant breach is Red whatever the ratio');
});

test('correct refusals cannot hide a session that should have completed', async (t) => {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const stalled = { ...dataset.scenarios.find((s) => s.id === 'abandon-03'), id: 'should-complete', expected: 'completed' };
  const refusals = Array.from({ length: 19 }, (_, n) => ({ id: `refused-${n}`, category: 'bounded-practice',
    package: 'lessons-only', steps: ['refusedStart'], expected: 'none' }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-')), 'dataset.json');
  fs.writeFileSync(file, JSON.stringify({ ...dataset, scenarios: [stalled, ...refusals] }));
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  const report = await measureCompletion(file);
  assert.deepEqual([report.expectedCompletion, report.completionOfCompletable], [0.95, 0]);
  assert.equal(report.invariantsHeld, true);
  assert.equal(report.status, 'Red', 'the lower ratio sets the status');
});

test('kpiStatus applies the Floor, the Target and the Invariants', () => {
  assert.equal(kpiStatus(INITIAL_TARGET, true), 'Green');
  assert.equal(kpiStatus(0.94, true), 'Amber');
  assert.equal(kpiStatus(ACCEPTANCE_FLOOR, true), 'Amber');
  assert.equal(kpiStatus(0.8999, true), 'Red');
  assert.equal(kpiStatus(1, false), 'Red');
  assert.equal(kpiStatus(null, true), 'Red', 'an unmeasured KPI is Red');
});
