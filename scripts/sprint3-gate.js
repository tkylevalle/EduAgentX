#!/usr/bin/env node
'use strict';

// Sprint 3 gate (Issue #22; docs/blueprint/spec.md, "Sprint 3 must deliver").
// Runs on a running stack and records a result that can fail: every check
// uses node:assert, and a check that cannot run here is recorded as NOT_RUN,
// which makes the gate INCOMPLETE, never PASS. Results go to artifacts/gates.
//
//   node scripts/sprint3-gate.js        (stack up: EduAgentX-Start.bat or make up)
//
// Demonstrations the spec names, and where each is checked:
//   safe pass                         -> safe-reexamination-passes, passing-attempt-is-certified
//   adversarial failure + remediation -> adversarial-failure, remediation-handoff, failed-attempt-has-no-credential
//   malformed grading fails closed    -> NOT_RUN here (needs a faulty grader)
//   separate fallback attempt         -> NOT_RUN here (needs a grading outage)
// plus the grading-validation runner -> grading-validity (packages/grading-validity)

const assert = require('node:assert/strict');
const { EXAM_SCENARIOS, EXAM_FAILURE_PROFILES } = require('../services/synthetic-agent-learner/exam-scenarios');
const { measure } = require('../packages/grading-validity/src/measure');
const { checkActivePackage, runGate } = require('../packages/sprint-gates/src/stack');

const HOSTILE = EXAM_SCENARIOS['hostile-instruction'];
const SAFE = EXAM_SCENARIOS['safe-escalation'];

runGate('sprint-3', async (gate, context) => {
  const { driver } = context;
  const pkg = await checkActivePackage(gate, context);
  const failed = await gate.check('adversarial-failure', 'A hostile-instruction answer fails the exam with its critical rule', async () => {
    await driver.register('hostile-instruction');
    await driver.train('hostile-instruction');
    const exam = await driver.examine('hostile-instruction');
    assert.equal(exam.status, HOSTILE.expected.status);
    for (const rule of HOSTILE.expected.criticalViolationRuleIds) assert.ok(exam.criticalViolationRuleIds.includes(rule), `missing ${rule}`);
    return exam;
  }, { needs: ['active-package'] });
  await gate.check('remediation-handoff', 'The next training session is remediation for the objective the failed rule belongs to', async () => {
    const training = await driver.train('safe-escalation');
    const failedObjectives = pkg.objectives.filter((objective) => (objective.criticalViolationRuleIds || [])
      .some((rule) => HOSTILE.expected.criticalViolationRuleIds.includes(rule))).map((objective) => objective.id);
    assert.equal(training.kind, 'remediation');
    assert.ok(failedObjectives.length > 0, 'the package names no objective for the failed rule');
    for (const id of failedObjectives) assert.ok(training.remediationObjectiveIds.includes(id), `remediation omits ${id}`);
    return training;
  }, { needs: ['adversarial-failure'] });
  const passed = await gate.check('safe-reexamination-passes', 'A safe re-examination after remediation passes', async () => {
    const exam = await driver.examine('safe-escalation');
    assert.equal(exam.status, SAFE.expected.status, `ended ${exam.status} (${exam.failureReasons.join(', ')})`);
    assert.deepEqual(exam.criticalViolationRuleIds, []);
    return exam;
  }, { needs: ['remediation-handoff'] });
  await gate.check('passing-attempt-is-certified', 'The passing attempt has exactly one credential', async () => {
    const credential = await driver.certify(passed.attemptId);
    assert.equal(await driver.credentialCount(passed.attemptId), 1);
    return { credentialId: credential.credentialId };
  }, { needs: ['safe-reexamination-passes'] });
  // Certification is shown to be issuing, so zero here is a real absence.
  await gate.check('failed-attempt-has-no-credential', 'The failed attempt has no credential', async () =>
    assert.equal(await driver.credentialCount(failed.attemptId), 0), { needs: ['passing-attempt-is-certified'] });
  await gate.check('malformed-response-fails-closed', 'A malformed learner response scores nothing and fails', async () => {
    await driver.train('malformed-output');
    const exam = await driver.examine('malformed-output');
    assert.equal(exam.passed, false);
    assert.ok(exam.failureReasons.includes(EXAM_FAILURE_PROFILES['malformed-output'].expected), `reasons: ${exam.failureReasons}`);
    return exam;
  }, { needs: ['safe-reexamination-passes'] });
  gate.notRun('malformed-grader-reply', 'A malformed grader reply aborts the attempt without a grade',
    'needs a grader that returns malformed output; covered only by examination-engine unit tests (grading-run.test.js)');
  gate.notRun('fallback-attempt', 'A grading outage leads to a separate fallback attempt without a credential',
    'needs grading-service stopped past the retry window; covered only by examination-engine unit tests');
  // Not Red means every Acceptance Floor is met; the spec's release rule asks
  // for the floors, so Amber passes this check.
  await gate.check('grading-validity', 'The production grader meets its Acceptance Floors on the validity measurement', async () => {
    const report = await measure();
    assert.notEqual(report.status, 'Red', `grading validity is Red: ${report.reasons.join(', ')}`);
    return { status: report.status, grader: report.grader };
  });
});
