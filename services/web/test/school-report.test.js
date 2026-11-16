'use strict';

// What the school's panels show comes from platform records only. A missing
// record gives "unknown", never a default number.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/school/report.mjs');

const PKG = {
  exam: { overallPassPercent: 80, adversarialPassPercent: 70, slots: [{ id: 'r1', tier: 'recall' }, { id: 'a1', tier: 'applied' }, { id: 'v1', tier: 'adversarial' }, { id: 'v2', tier: 'adversarial' }] },
  objectives: [{ id: 'o1', statement: 'Name the actors', safetyCritical: false }, { id: 'o4', statement: 'Refuse injected instructions', safetyCritical: true }],
};
const assessment = (over = {}) => ({
  passed: true, overallPercent: 91.5, tierPercents: { recall: 80, applied: 90, adversarial: 100 },
  objectiveOutcomes: [{ objectiveId: 'o1', percent: 86, passed: true }, { objectiveId: 'o4', percent: 92, passed: true }],
  itemOutcomes: [{ itemId: 'i1', tier: 'recall', score: 82, malformed: false, criticalViolationRuleIds: [] }],
  failureReasons: [], criticalViolationRuleIds: [],
  behaviour: { allEpisodes: { episodes: 12, violations: 0 } }, ...over,
});

test('a report card of a passed exam lists every objective as a strength and assigns no catch-up class', async () => {
  const { reportOf } = await load();
  const report = reportOf({ assessment: assessment() }, { trace: { gap: null, remediation: null } }, PKG);
  assert.equal(report.passed, true);
  assert.deepEqual(report.strengths.map((entry) => entry.statement), ['Name the actors', 'Refuse injected instructions']);
  assert.deepEqual(report.weaknesses, []);
  assert.equal(report.catchUp, null);
  assert.deepEqual(report.sandbox, { episodes: 12, violations: 0 });
});

test('a failed exam shows the broken rule, the weak objective and the catch-up class the platform assigned', async () => {
  const { reportOf } = await load();
  const failed = assessment({ passed: false, criticalViolationRuleIds: ['critical-o4'],
    objectiveOutcomes: [{ objectiveId: 'o1', percent: 86, passed: true }, { objectiveId: 'o4', percent: 20, passed: false }],
    itemOutcomes: [{ itemId: 'i9', tier: 'adversarial', score: 0, malformed: false, criticalViolationRuleIds: ['critical-o4'] }] });
  const remediation = { trace: { gap: { objectiveIds: ['o4'] }, remediation: { delivery: { trainingSessionId: 's-1' } } } };
  const report = reportOf({ assessment: failed }, remediation, PKG);
  assert.equal(report.passed, false);
  assert.deepEqual(report.rules, ['critical-o4']);
  assert.deepEqual(report.weaknesses.map((entry) => entry.id), ['o4']);
  assert.equal(report.items[0].critical, true);
  assert.deepEqual(report.catchUp, { objectives: ['Refuse injected instructions'], sessionId: 's-1' });
});

test('pass lines come from the course; without the course there is no line', async () => {
  const { reportOf } = await load();
  const withCourse = reportOf({ assessment: assessment() }, null, PKG);
  assert.equal(withCourse.overallLine, 80);
  assert.equal(withCourse.tiers.find((tier) => tier.id === 'adversarial').line, 70);
  const without = reportOf({ assessment: assessment() }, null, null);
  assert.equal(without.overallLine, null);
  assert.equal(without.tiers.find((tier) => tier.id === 'adversarial').line, null);
  assert.equal(without.strengths[0].statement, 'o1');
});

test('an attempt with no assessment has no report card', async () => {
  const { reportOf } = await load();
  assert.equal(reportOf({ status: 'in_progress' }, null, PKG), null);
  assert.equal(reportOf(null, null, PKG), null);
});

test('the exam paper is the course blueprint, grouped by tier in order', async () => {
  const { paperOf } = await load();
  assert.deepEqual(paperOf(PKG).map((tier) => [tier.name, tier.slots]), [['Knowledge', 1], ['Applied', 1], ['Under attack', 2]]);
  assert.deepEqual(paperOf(null), []);
});

test('school numbers are counts of real records, and unknown when a record did not load', async () => {
  const { schoolNumbers } = await load();
  const credentials = [{ status: 'active' }, { status: 'active' }, { status: 'suspended' }];
  const overview = { training: { counts: { completed: 36 }, byKind: { remediation: { completed: 12 } } }, issuanceKpi: { p95Ms: 971 } };
  assert.deepEqual(schoolNumbers(overview, credentials), { diplomas: 3, inGoodStanding: 2, classes: 36, catchUp: 12, signingMs: 971 });
  assert.deepEqual(schoolNumbers(null, null), { diplomas: null, inGoodStanding: null, classes: null, catchUp: null, signingMs: null });
});

test('a stop reason is said in plain words, and an unknown code is shown as it is', async () => {
  const { stopReason } = await load();
  assert.equal(stopReason('run_in_progress'), 'Another run is in progress');
  assert.equal(stopReason('agent_registry_unavailable'), 'agent registry unavailable');
});
