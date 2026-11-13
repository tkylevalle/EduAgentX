'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRelease, REQUIRED_LIMITATION_SECTIONS } = require('../src/release-gate');

const FINGERPRINT = 'a'.repeat(64);
const commitOf = (sprint) => String(sprint).repeat(40);
const current = (type, fields) => ({
  type, sourceFingerprint: FINGERPRINT, recordedBy: 'raniyahabachi',
  recordedAt: '2026-12-01T10:00:00Z', evidenceReference: 'evidence/release/run-1', ...fields,
});
const sprintPass = (sprint) => ({
  type: 'sprint-pass', sprint, evidencePack: `evidence/sprint-${sprint}`, sourceCommit: commitOf(sprint),
  passedAt: `2026-0${sprint + 4}-01T00:00:00Z`, approvedBy: ['team'], waivers: [],
});

// Commits 1111... to 5555... form one line of history, in sprint order.
const history = {
  commitExists: (sha) => /^([1-5])\1{39}$/.test(sha),
  isAncestor: (older, newer) => older[0] <= newer[0],
};

function passingInput() {
  return {
    fingerprint: FINGERPRINT,
    isWorkingTreeClean: true,
    recordErrors: [],
    scanFindings: [],
    fileExists: () => true,
    history,
    limitations: REQUIRED_LIMITATION_SECTIONS.map((section) => `## ${section}\n\nRecorded.`).join('\n\n'),
    records: [
      ...[1, 2, 3, 4, 5].map(sprintPass),
      current('second-machine', { machine: 'raniya-laptop', operator: 'raniyahabachi', paidApiCalls: 0,
        steps: { setup: 'PASS', tests: 'PASS', demonstration: 'PASS', evidenceBundle: 'PASS' } }),
      current('handoff-drill', { backup: 'raniyahabachi', scenarioOwner: 'NXRJ', scenario: 'sprint-1 registration',
        onSecondMachine: true, result: 'PASS' }),
      current('incidents', { openCriticalOrMajor: [] }),
      current('metrics', { invariantsRelaxed: [], results: [
        { name: 'registration p95', criticalPath: true, status: 'Green', floorMet: true },
        { name: 'console polish', criticalPath: false, status: 'Amber', floorMet: null },
      ] }),
      current('live-cost', { paidApiUsed: true, amountAed: 12.5 }),
      current('approval', { outcome: 'APPROVED', approvedBy: ['team'], decisionReference: 'docs/sprint-5/minutes.md',
        demoPasswordCheck: 'tkylevalle', requiredReviews: ['certification'],
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
  const { isWorkingTreeClean, ...withoutState } = passingInput();
  assert.equal(isWorkingTreeClean, true);
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

test('sprint commits must exist and follow each other in git history', () => {
  const swapped = replaceRecord(passingInput(), 'sprint-pass', (record) => (
    record.sprint === 2 ? { ...record, sourceCommit: commitOf(4) } : record));
  assert.deepEqual(blockersOf(swapped), ['sprint 3: source commit does not follow sprint 2']);
  const invented = replaceRecord(passingInput(), 'sprint-pass', (record) => (
    record.sprint === 5 ? { ...record, sourceCommit: 'f'.repeat(40) } : record));
  assert.deepEqual(blockersOf(invented), ['sprint 5: source commit not found in git history']);
});

test('sprint waivers are disclosed, and a missing waiver list blocks', () => {
  const waived = replaceRecord(passingInput(), 'sprint-pass', (record) => (
    record.sprint === 1 ? { ...record, waivers: ['capability backup handoff'] } : record));
  const result = evaluateRelease(waived);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.waivers, ['sprint 1: capability backup handoff']);
  const unlisted = replaceRecord(passingInput(), 'sprint-pass', (record) => {
    if (record.sprint !== 2) return record;
    const { waivers, ...rest } = record;
    return rest;
  });
  assert.deepEqual(blockersOf(unlisted), ['sprint 2: waivers must be a list, empty when none']);
});

test('the handoff drill needs a backup other than the scenario owner', () => {
  const input = replaceRecord(passingInput(), 'handoff-drill', (record) => ({ ...record, backup: ' nxrj ' }));
  assert.deepEqual(blockersOf(input), ['handoff-drill: backup must differ from the scenario owner']);
});

test('the second-machine run must pass every step with no paid calls', () => {
  const input = replaceRecord(passingInput(), 'second-machine', (record) => ({
    ...record, paidApiCalls: 3, steps: { ...record.steps, evidenceBundle: 'FAIL' } }));
  assert.deepEqual(blockersOf(input), [
    'second-machine: step evidenceBundle is not PASS', 'second-machine: zero-paid path made paid API calls',
  ]);
});

test('open incidents, failed floors, Red or Unmeasured results and relaxed Invariants block', () => {
  let input = replaceRecord(passingInput(), 'incidents', (record) => ({ ...record, openCriticalOrMajor: ['INC-7'] }));
  input = replaceRecord(input, 'metrics', (record) => ({ ...record, invariantsRelaxed: ['exactly-once issuance'], results: [
    { name: 'grading accuracy', criticalPath: true, status: 'Unmeasured', floorMet: true },
    { name: 'latency', criticalPath: false, status: 'Amber', floorMet: false },
    null,
  ] }));
  assert.deepEqual(blockersOf(input), [
    'incidents: 1 Critical or Major incident open',
    'metrics: Invariant relaxed: exactly-once issuance',
    'metrics: grading accuracy is Unmeasured', 'metrics: latency misses its Acceptance Floor',
    'metrics: result 3 is not an object',
  ]);
});

test('a metric must say whether its floor applies', () => {
  const input = replaceRecord(passingInput(), 'metrics', (record) => ({ ...record,
    results: [{ name: 'latency', criticalPath: true, status: 'Green' }] }));
  assert.deepEqual(blockersOf(input), ['metrics: latency misses its Acceptance Floor']);
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
  const rejected = replaceRecord(input, 'approval', (record) => ({ ...record, outcome: 'REJECTED' }));
  assert.deepEqual(blockersOf(rejected), ['approval: outcome is not APPROVED']);
});

test('approval needs a team decision, the demo password check and every required review', () => {
  const input = replaceRecord(passingInput(), 'approval', (record) => ({ ...record,
    decisionReference: '', demoPasswordCheck: undefined, requiredReviews: ['certification', 'marketplace trust'] }));
  assert.deepEqual(blockersOf(input), [
    'approval: decisionReference missing', 'approval: demoPasswordCheck missing',
    'approval: required review "marketplace trust" not recorded',
  ]);
  const noList = replaceRecord(passingInput(), 'approval', (record) => ({ ...record, requiredReviews: [] }));
  assert.deepEqual(blockersOf(noList), ['approval: requiredReviews must list the mandatory independent reviews']);
});

test('live cost must be reported either way', () => {
  const input = replaceRecord(passingInput(), 'live-cost', (record) => ({ ...record, amountAed: undefined }));
  assert.deepEqual(blockersOf(input), ['live-cost: paid usage reported without an AED amount']);
});
