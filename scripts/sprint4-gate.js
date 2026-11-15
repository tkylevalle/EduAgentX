#!/usr/bin/env node
'use strict';

// Sprint 4 gate (docs/blueprint/spec.md, "Sprint 4 must deliver"). Runs on a
// running stack and records a result that can fail: every check uses
// node:assert, and a check that cannot run here is recorded as NOT_RUN,
// which makes the gate INCOMPLETE, never PASS. Results go to artifacts/gates.
//
//   node scripts/sprint4-gate.js        (stack up: EduAgentX-Start.bat or make up)
//
// Demonstrations the spec names, and where each is checked:
//   issuance and verification          -> issuance-and-verification
//   exactly-once issuance              -> exactly-once-issuance
//   suspension (and reinstatement)     -> suspension-is-enforced
//   tampering rejection                -> tampering-is-rejected
//   monitoring projection              -> monitoring-shows-credential
//   Certification restart recovery     -> NOT_RUN here (hero scenario 3, scripts/run-hero-stack.py)
//   correlated evidence regeneration   -> NOT_RUN here (no public route)

const assert = require('node:assert/strict');
const { requireActivePackage, runGate } = require('../packages/sprint-gates/src/stack');

// The signed overall score is raised to 100 without re-signing, as a
// dishonest holder would do.
function raiseScore(compactJws) {
  const [header, payload, signature] = compactJws.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const competency = claims.credentialSubject.competency;
  const raised = { ...claims, credentialSubject: { ...claims.credentialSubject,
    competency: { ...competency, scores: { ...competency.scores, overallPercent: 100 } } } };
  return [header, Buffer.from(JSON.stringify(raised)).toString('base64url'), signature].join('.');
}

runGate('sprint-4', async (gate, { driver, scriptedReviewerIds }) => {
  await gate.check('active-package', 'An Active package approved by two named reviewers governs the exam',
    () => requireActivePackage(driver, { scriptedReviewerIds }));
  const issued = await gate.check('issuance-and-verification', 'A passing attempt gets a signed credential that verifies as VALID', async () => {
    const agent = await driver.register('safe-escalation');
    await driver.train('safe-escalation');
    const exam = await driver.examine('safe-escalation');
    assert.equal(exam.status, 'complete', `the safe attempt ended ${exam.status} (${exam.failureReasons.join(', ')})`);
    const credential = await driver.certify(exam.attemptId);
    assert.equal((await driver.verify(credential.compactJws)).overall, 'VALID');
    return { agentLearnerKey: agent.agentLearnerKey, attemptId: exam.attemptId, credential };
  }, { needs: ['active-package'] });
  await gate.check('exactly-once-issuance', 'Certification holds exactly one credential for the passing attempt', async () =>
    assert.equal(await driver.credentialCount(issued.attemptId), 1), { needs: ['issuance-and-verification'] });
  await gate.check('tampering-is-rejected', 'A credential with its score raised without re-signing fails its signature check', async () => {
    const report = await driver.verify(raiseScore(issued.credential.compactJws));
    assert.equal(report.overall, 'INVALID');
    assert.ok(report.reasonCodes.includes('SIGNATURE_INVALID'), `reasons: ${report.reasonCodes}`);
    return { overall: report.overall, reasonCodes: report.reasonCodes };
  }, { needs: ['issuance-and-verification'] });
  await gate.check('suspension-is-enforced', 'A suspended credential fails as SUSPENDED, and verifies again after reinstatement', async () => {
    const cycle = await driver.statusCycle(issued.credential, issued.agentLearnerKey);
    assert.ok(cycle.whileSuspended.reasonCodes.includes('SUSPENDED'), `reasons: ${cycle.whileSuspended.reasonCodes}`);
    assert.equal(cycle.afterReinstate.overall, 'VALID');
    return cycle;
  }, { needs: ['issuance-and-verification'] });
  await gate.check('monitoring-shows-credential', 'Monitoring projects the verified credential for the agent', async () => {
    const view = await driver.monitor(issued.agentLearnerKey);
    assert.equal(view.assurancePosture, 'VERIFIED');
    return view;
  }, { needs: ['suspension-is-enforced'] });
  gate.notRun('certification-restart-recovery', 'Certification recovers after a restart and issues exactly once',
    'needs Compose control to stop and restart certification-service; run hero scenario 3 with scripts/run-hero-stack.py');
  gate.notRun('evidence-regeneration', 'The Evidence Bundle is regenerated with correlated evidence',
    'the Evidence Bundle has no public Gateway route; only the demo web server calls it');
});
