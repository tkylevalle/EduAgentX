'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRelease, REQUIRED_LIMITATION_SECTIONS } = require('../src/release-gate');

const FINGERPRINT = 'a'.repeat(64);
const current = (type, fields) => ({
  type, sourceFingerprint: FINGERPRINT, recordedBy: 'raniyahabachi',
  recordedAt: '2026-12-01T10:00:00Z', evidenceReference: 'evidence/release/run-1', ...fields,
});
const sprintPass = (sprint) => ({
  type: 'sprint-pass', sprint, evidencePack: `evidence/sprint-${sprint}`, sourceCommit: String(sprint).repeat(40),
  passedAt: `2026-0${sprint + 4}-01T00:00:00Z`, approvedBy: ['team'],
});

function passingInput() {
  return {
    fingerprint: FINGERPRINT,
    workingTreeClean: true,
    recordErrors: [],
    scanFindings: [],
    fileExists: () => true,
    limitations: REQUIRED_LIMITATION_SECTIONS.map((section) => `## ${section}\n\nRecorded.`).join('\n\n'),
    records: [
      ...[1, 2, 3, 4, 5].map(sprintPass),
      current('second-machine', { machine: 'raniya-laptop', operator: 'raniyahabachi', paidApiCalls: 0,
        steps: { setup: 'PASS', tests: 'PASS', demonstration: 'PASS', evidenceBundle: 'PASS' } }),
      current('handoff-drill', { backup: 'raniyahabachi', scenarioOwner: 'NXRJ', scenario: 'sprint-1 registration',
        onSecondMachine: true, result: 'PASS' }),
      current('incidents', { openCriticalOrMajor: [] }),
      current('metrics', { results: [{ name: 'registration p95', criticalPath: true, status: 'Green', floorMet: true }] }),
      current('live-cost', { paidApiUsed: true, amountAed: 12.5 }),
      current('approval', { outcome: 'APPROVED', approvedBy: ['team'],
        independentReviews: [{ capability: 'certification', reviewer: 'tkylevalle' }] }),
    ],
  };
}

const replaceRecord = (input, type, change) => ({
  ...input, records: input.records.map((record) => (record.type === type ? change(record) : record)),
});
const blockersOf = (input) => evaluateRelease(input).blockers;

test('a complete, current and clean release passes', () => {
  const result = evaluateRelease(passingInput());
  assert.deepEqual(result.blockers, []);
  assert.equal(result.status, 'PASS');
});

test('an empty record set blocks with every missing item named', () => {
  const result = evaluateRelease({ ...passingInput(), records: [] });
  assert.equal(result.status, 'BLOCKED');
  for (const item of ['sprint 1', 'sprint 5', 'second-machine', 'handoff-drill', 'incidents', 'metrics', 'live-cost', 'approval']) {
    assert.ok(result.blockers.some((blocker) => blocker.includes(item)), item);
  }
});

test('an uncommitted tree or an unreadable record blocks the release', () => {
  const { workingTreeClean, ...withoutState } = passingInput();
  assert.equal(workingTreeClean, true);
  assert.deepEqual(blockersOf(withoutState), ['source: working tree has uncommitted changes']);
  assert.deepEqual(blockersOf({ ...passingInput(), recordErrors: ['bad.json: invalid JSON'] }), ['records: bad.json: invalid JSON']);
});

test('secret findings block the release without exposing values', () => {
  const blockers = blockersOf({ ...passingInput(), scanFindings: [{ path: '.env', line: 1, rule: 'environment-file' }] });
  assert.deepEqual(blockers, ['secret scan: .env:1 environment-file']);
});

test('records made for another source version do not count', () => {
  const input = replaceRecord(passingInput(), 'approval', (record) => ({ ...record, sourceFingerprint: 'b'.repeat(64) }));
  assert.deepEqual(blockersOf(input), ['approval: recorded for a different source version']);
});

test('sprints must pass in sequence with an existing evidence pack', () => {
  const input = replaceRecord(passingInput(), 'sprint-pass', (record) => (
    record.sprint === 3 ? { ...record, passedAt: '2026-01-01T00:00:00Z' } : record));
  assert.deepEqual(blockersOf(input), ['sprint 3: passed before sprint 2']);
  const missingPack = { ...passingInput(), fileExists: (path) => path !== 'evidence/sprint-4' };
  assert.deepEqual(blockersOf(missingPack), ['sprint 4: evidence pack evidence/sprint-4 not found']);
});

test('the handoff drill needs a backup other than the scenario owner', () => {
  const input = replaceRecord(passingInput(), 'handoff-drill', (record) => ({ ...record, backup: 'nxrj' }));
  assert.deepEqual(blockersOf(input), ['handoff-drill: backup must differ from the scenario owner']);
});

test('the second-machine run must pass every step with no paid calls', () => {
  const input = replaceRecord(passingInput(), 'second-machine', (record) => ({
    ...record, paidApiCalls: 3, steps: { ...record.steps, evidenceBundle: 'FAIL' } }));
  assert.deepEqual(blockersOf(input), [
    'second-machine: step evidenceBundle is not PASS', 'second-machine: zero-paid path made paid API calls',
  ]);
});

test('open incidents, failed floors and Red or Unmeasured results block', () => {
  let input = replaceRecord(passingInput(), 'incidents', (record) => ({ ...record, openCriticalOrMajor: ['INC-7'] }));
  input = replaceRecord(input, 'metrics', (record) => ({ ...record, results: [
    { name: 'grading accuracy', criticalPath: true, status: 'Unmeasured', floorMet: true },
    { name: 'latency', criticalPath: false, status: 'Amber', floorMet: false },
  ] }));
  assert.deepEqual(blockersOf(input), [
    'incidents: 1 Critical or Major incident open',
    'metrics: grading accuracy is Unmeasured', 'metrics: latency misses its Acceptance Floor',
  ]);
});

test('the limitations record must cover every required section', () => {
  const blockers = blockersOf({ ...passingInput(), limitations: '## Known limitations\n' });
  assert.ok(blockers.includes('limitations: missing section "Non-accreditation positioning"'));
  assert.ok(blockersOf({ ...passingInput(), limitations: null }).includes('limitations: docs/release/limitations.md not found'));
});

test('duplicate records and an unapproved outcome block', () => {
  const input = passingInput();
  const approval = input.records.find((record) => record.type === 'approval');
  const blockers = blockersOf({ ...input, records: [...input.records, { ...approval, outcome: 'REJECTED' }] });
  assert.deepEqual(blockers, ['approval: 2 records found, expected exactly 1']);
  const rejected = replaceRecord(input, 'approval', (record) => ({ ...record, outcome: 'REJECTED', independentReviews: [] }));
  assert.deepEqual(blockersOf(rejected), ['approval: outcome is not APPROVED', 'approval: no independent review recorded']);
});

test('live cost must be reported either way', () => {
  const input = replaceRecord(passingInput(), 'live-cost', (record) => ({ ...record, amountAed: undefined }));
  assert.deepEqual(blockersOf(input), ['live-cost: paid usage reported without an AED amount']);
});
