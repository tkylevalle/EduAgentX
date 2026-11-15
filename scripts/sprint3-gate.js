#!/usr/bin/env node
'use strict';

// Sprint 3 gate (Issue #22; docs/blueprint/spec.md, "Sprint 3 must deliver").
// Runs on a running stack through public routes and records a result that
// can fail: every check uses node:assert, and a check that cannot run here is
// recorded as NOT_RUN, which makes the gate INCOMPLETE, never PASS.
//
//   node scripts/sprint3-gate.js        (stack up: EduAgentX-Start.bat or make up)
//
// Demonstrations the spec names, and where each is checked:
//   safe pass                         -> safe-reexamination-passes
//   adversarial failure + remediation -> adversarial-failure, remediation-handoff
//   malformed grading fails closed    -> NOT_RUN here (needs a faulty grader)
//   separate fallback attempt         -> NOT_RUN here (needs a grading outage)
// plus the grading-validation runner -> grading-validity (packages/grading-validity)

const assert = require('node:assert/strict');
const { EXAM_SCENARIOS, EXAM_FAILURE_PROFILES } = require('../services/synthetic-agent-learner/exam-scenarios');
const { measure } = require('../packages/grading-validity/src/measure');
const { createGate } = require('../packages/sprint-gates/src/gate');
const { printResult, requireActivePackage, stackDriver, writeResult } = require('../packages/sprint-gates/src/stack');

// A failed attempt must not produce a credential. driver.certify polls for
// one for 30 seconds, far longer than issuance takes after a pass, and
// reports certification_timeout when none appears.
async function assertNoCredential(driver, attemptId) {
  const found = await driver.certify(attemptId).then(() => true, (error) => {
    if (error.code === 'certification_timeout') return false;
    throw error;
  });
  assert.equal(found, false, `attempt ${attemptId} failed but has a credential`);
}

async function main() {
  const gate = createGate('sprint-3');
  const driver = stackDriver();
  const state = {};
  const hostile = EXAM_SCENARIOS['hostile-instruction'];

  await gate.check('active-package', 'An Active package approved by two reviewers governs the exam', async () =>
    (state.pkg = await requireActivePackage(driver)));
  await gate.check('adversarial-failure', 'A hostile-instruction answer fails the exam with its critical rule', async () => {
    state.agent = await driver.register('hostile-instruction');
    await driver.train('hostile-instruction');
    const exam = await driver.examine('hostile-instruction');
    assert.equal(exam.status, hostile.expected.status);
    for (const rule of hostile.expected.criticalViolationRuleIds) assert.ok(exam.criticalViolationRuleIds.includes(rule), `missing ${rule}`);
    state.failedAttemptId = exam.attemptId;
    return exam;
  }, { needs: ['active-package'] });
  await gate.check('failed-attempt-has-no-credential', 'The failed attempt produces no credential', async () =>
    assertNoCredential(driver, state.failedAttemptId), { needs: ['adversarial-failure'] });
  await gate.check('remediation-handoff', 'The next training session is remediation for the failed objective', async () => {
    const training = await driver.train('safe-escalation');
    assert.equal(training.kind, 'remediation');
    assert.ok(training.remediationObjectiveIds.length > 0, 'remediation names no objective');
    return training;
  }, { needs: ['adversarial-failure'] });
  await gate.check('safe-reexamination-passes', 'A safe re-examination after remediation passes', async () => {
    const exam = await driver.examine('safe-escalation');
    assert.equal(exam.status, EXAM_SCENARIOS['safe-escalation'].expected.status);
    assert.deepEqual(exam.criticalViolationRuleIds, []);
    return exam;
  }, { needs: ['remediation-handoff'] });
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
  await gate.check('grading-validity', 'The production grader is not Red on the validity measurement', async () => {
    const report = await measure();
    assert.notEqual(report.status, 'Red', `grading validity is Red: ${report.reasons.join(', ')}`);
    return { status: report.status, grader: report.grader };
  });

  const result = gate.result();
  printResult(result, writeResult(result, 'sprint-3'));
  process.exitCode = result.exitCode;
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
