#!/usr/bin/env node
'use strict';

// Sprint 4 gate (docs/blueprint/spec.md, "Sprint 4 must deliver"). Runs on a
// running stack through public routes and records a result that can fail:
// every check uses node:assert, and a check that cannot run here is recorded
// as NOT_RUN, which makes the gate INCOMPLETE, never PASS.
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
const { createGate } = require('../packages/sprint-gates/src/gate');
const { printResult, requireActivePackage, stackDriver, writeResult } = require('../packages/sprint-gates/src/stack');

// The signed score is changed without re-signing, as an attacker would.
function tamper(compactJws) {
  const [header, payload, signature] = compactJws.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const tampered = { ...claims, tamperedByGate: true };
  return [header, Buffer.from(JSON.stringify(tampered)).toString('base64url'), signature].join('.');
}

async function main() {
  const gate = createGate('sprint-4');
  const driver = stackDriver();
  const state = {};

  await gate.check('active-package', 'An Active package approved by two reviewers governs the exam', async () =>
    requireActivePackage(driver));
  await gate.check('issuance-and-verification', 'A passing attempt gets one signed credential that verifies as VALID', async () => {
    state.agent = await driver.register('safe-escalation');
    await driver.train('safe-escalation');
    const exam = await driver.examine('safe-escalation');
    assert.equal(exam.status, 'complete', `the safe attempt ended ${exam.status} (${exam.failureReasons.join(', ')})`);
    state.credential = await driver.certify(exam.attemptId);
    state.attemptId = exam.attemptId;
    const report = await driver.verify(state.credential.compactJws);
    assert.equal(report.overall, 'VALID');
    return { attemptId: exam.attemptId, credentialId: state.credential.credentialId, keyId: state.credential.keyId };
  }, { needs: ['active-package'] });
  await gate.check('exactly-once-issuance', 'Reading the decision again returns the same single credential', async () => {
    const again = await driver.certify(state.attemptId);
    assert.equal(again.credentialId, state.credential.credentialId);
    assert.equal(again.compactJws, state.credential.compactJws);
  }, { needs: ['issuance-and-verification'] });
  await gate.check('tampering-is-rejected', 'A credential changed without re-signing fails its signature check', async () => {
    const report = await driver.verify(tamper(state.credential.compactJws));
    assert.equal(report.overall, 'INVALID');
    assert.equal(report.signature?.status, 'FAIL');
    return { overall: report.overall, reasonCodes: report.reasonCodes };
  }, { needs: ['issuance-and-verification'] });
  await gate.check('suspension-is-enforced', 'A suspended credential stops verifying, and verifies again after reinstatement', async () =>
    driver.statusCycle(state.credential, state.agent.agentLearnerKey), { needs: ['issuance-and-verification'] });
  await gate.check('monitoring-shows-credential', 'Monitoring projects the verified credential for the agent', async () => {
    const view = await driver.monitor(state.agent.agentLearnerKey);
    assert.equal(view.assurancePosture, 'VERIFIED');
    return view;
  }, { needs: ['suspension-is-enforced'] });
  gate.notRun('certification-restart-recovery', 'Certification recovers after a restart and issues exactly once',
    'needs Compose control to stop and restart certification-service; run hero scenario 3 with scripts/run-hero-stack.py');
  gate.notRun('evidence-regeneration', 'The Evidence Bundle is regenerated with correlated evidence',
    'the Evidence Bundle has no public Gateway route; only the demo web server calls it');

  const result = gate.result();
  printResult(result, writeResult(result, 'sprint-4'));
  process.exitCode = result.exitCode;
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
