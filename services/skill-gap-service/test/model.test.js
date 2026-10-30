'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { command, normalizeExamination, normalizeMarketplace, recommend, trainingRequest } = require('../model');
const { parseRemediationRequest } = require('../../training-service/remediation-request');
const f = require('./fixtures');
test('examination recommendation preserves exact objectives/rules and governing versions without private content', () => {
  const trace = f.trace(), original = structuredClone(trace);
  trace.privateAnswers = 'secret';
  trace.remediation.event.package.privatePrompt = 'secret';
  trace.remediation.event.evidence.privateContext = 'secret';
  const r = recommend(f.input(),normalizeExamination(trace,f.input()),f.pkg(),f.NOW);
  assert.deepEqual(r.objectiveIds,['o2']);
  assert.deepEqual(r.criticalRuleIds,['unsafe-tool']);
  assert.equal(r.governing.rubric.version,'1.0.0');
  assert.equal(r.trainingOwner,'examination-engine');
  assert.ok(!JSON.stringify(r).includes('secret'));
  delete trace.privateAnswers;
  delete trace.remediation.event.package.privatePrompt;
  delete trace.remediation.event.evidence.privateContext;
  assert.deepEqual(trace,original);
});
test('Marketplace recommendation links immutable request and only targets known missing objectives', () => {
  const input = f.input('marketplace'), normalized = normalizeMarketplace(f.match(),input);
  const r = recommend(input,normalized,f.pkg(),f.NOW);
  assert.deepEqual(r.trainingScope.objectiveIds,['o2']);
  assert.deepEqual(r.reasonCodes,['OBJECTIVE_MISSING','SCORE_OVERALL_BELOW']);
  assert.equal(r.governing.requestVersion,1);
  assert.equal(parseRemediationRequest(trainingRequest(r)).details,undefined);
  assert.equal(recommend(input,normalized,f.pkg(),f.NOW).recommendationId,r.recommendationId);
});
test('age/mode/aggregate-score gaps alone produce no invented training targets', () => {
  const result = f.match(); result.nearMatches[0].gaps = [{ code: 'CREDENTIAL_TOO_OLD', actualDays: 91, maximumDays: 90 }];
  const r = recommend(f.input('marketplace'),normalizeMarketplace(result,f.input('marketplace')),f.pkg(),f.NOW);
  assert.equal(r.trainingScope.outcome,'no_targeted_training');
  assert.deepEqual(r.objectiveIds,[]);
});
test('source identity/version, mode, missing evidence and trust failures are refused', () => {
  for (const mutate of [x=>x.failure.status='system_aborted',x=>x.remediation.event.agentLearnerKey='other',
    x=>x.remediation.event.schemaVersion='9',x=>x.remediation.event.gap.objectiveIds=[],x=>x.remediation.event.evidence.environment='live',
    x=>x.remediation.event.failure.evidenceDigest='fake',x=>delete x.failure.template]) {
    const value=f.trace(); mutate(value); assert.throws(()=>normalizeExamination(value,f.input()));
  }
  for (const mutate of [x=>x.resultId='other',x=>x.policyVersion='9',x=>x.nearMatches[0].eligible=true,
    x=>x.nearMatches[0].checks[0].passed=false,x=>x.nearMatches[0].gaps[0].code='SIGNATURE_INVALID',
    x=>x.nearMatches=[],x=>x.nearMatches[0].evidence.evidenceMode='unknown']) {
    const value=f.match(); mutate(value); assert.throws(()=>normalizeMarketplace(value,f.input('marketplace')));
  }
});
test('unsupported domain, unknown objectives, quarantine and changed pinned package fail closed', () => {
  for (const mutate of [x=>x.manifest.domain='Other',x=>x.objectives=[{id:'o1'}],x=>x.quarantinedScopes=['o2'],x=>x.digest='changed']) {
    const pkg=f.pkg(); mutate(pkg);
    assert.throws(()=>recommend(f.input(),normalizeExamination(f.trace(),f.input()),pkg,f.NOW));
  }
});
test('commands accept only source references and reject injected scores, actors and prototype-like evidence modes', () => {
  const body={...f.input(),idempotencyKey:'key'};
  assert.deepEqual(command(body),f.input());
  for (const extra of [{score:100},{actor:'admin'},{source:{...body.source,digest:'forged'}}]) assert.throws(()=>command({...body,...extra}));
  const value=f.trace(); value.remediation.event.evidence.mode='toString'; assert.throws(()=>normalizeExamination(value,f.input()));
});
