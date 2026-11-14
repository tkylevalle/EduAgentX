'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { golden, assessGolden, observeMarketplace } = require('../marketplace');
const base = () => ({ resultId: 'r', policyVersion: 'MATCH-POLICY-1.0.0', eligibleMatches: [], nearMatches: [], exclusions: [] });
test('real origin/label exclusions remain BLOCKED; empty lanes are not golden success', () => {
  const r = base(); r.exclusions.push({ agentLearnerKey: 'a', reasons: [{ code: 'LIFECYCLE_ORIGIN_UNCHECKABLE' }] });
  assert.equal(assessGolden(golden.cases[0], r).status, 'BLOCKED');
  assert.equal(assessGolden(golden.cases[0], base()).status, 'UNMEASURED');
});
test('independent literal orders and explanations detect changed ranking, score, lane and replay', () => {
  const r = base();
  r.eligibleMatches.push({ agentLearnerKey: 'a', eligible: true, matchScore: 78.5,
    checks: ['lifecycle_origin', 'discoverable', 'signature', 'schema', 'status', 'expiry', 'fingerprint', 'environment', 'domain', 'identity', 'evidence_mode']
      .map(gate => ({ gate, tag: 'trust', passed: true })), ordering: { decisiveCriterion: 'matchScore' } });
  const expected = { expectedEligible: ['a'], expectedNear: [], expectedExclusions: [], expectedScores: { a: 78.5 }, expectedOrdering: { a: 'matchScore' } };
  assert.equal(assessGolden(golden.cases[0], r, expected).status, 'CONFORMANT');
  assert.equal(assessGolden(golden.cases[0], r, { ...expected, expectedScores: { a: 79 } }).status, 'MISMATCH');
  r.nearMatches.push({ ...r.eligibleMatches[0], eligible: false, lane: 'Not Eligible' });
  assert.equal(assessGolden(golden.cases[0], r, expected).status, 'MISMATCH');
});
test('an upstream blocker cannot conceal an invalid inclusion or duplicate lane', () => {
  const r = base(); r.exclusions = [{ agentLearnerKey: 'blocked', reasons: [{ code: 'LIFECYCLE_ORIGIN_UNCHECKABLE' }] }];
  r.eligibleMatches.push({ agentLearnerKey: 'unsafe', eligible: true, checks: [{ tag: 'trust', gate: 'status', passed: false }] });
  assert.equal(assessGolden(golden.cases[0], r).status, 'MISMATCH');
});
test('pilot projection absence cannot downgrade an observable trust violation to BLOCKED', async () => {
  async function observe(result) {
    const interactions = [];
    const agent = { async interact(_s, _op, type) { interactions.push(type); return { status: 201 }; } };
    const admin = { async call(_method, route) {
      if (route === '/v1/marketplace/capability-requests') return { status: 201, body: { request: { id: 'request' } } };
      if (route.endsWith('/open')) return { status: 200 };
      if (route.endsWith('/matches')) return { status: 200, body: { matchResult: result } };
      return { status: 200, body: { count: 1, appearances: [] } };
    } };
    const observed = await observeMarketplace({ scenario: { id: 'competent-001', learnerId: 'not-projected' },
      agent, admin, pkg: { objectiveIds: ['o1'] }, actor: 'admin', projectionWaitMs: 0 });
    assert.deepEqual(interactions, ['marketplace.listing.publish', 'marketplace.listing.withdraw']);
    return observed;
  }
  assert.equal((await observe(base())).status, 'BLOCKED');
  const unsafe = base(); unsafe.eligibleMatches.push({ agentLearnerKey: 'untrusted-other', eligible: true, checks: [] });
  assert.equal((await observe(unsafe)).status, 'MISMATCH');
});

test('failed or malformed match replies retain their logical command for final reconciliation', async () => {
  for(const status of [504,200]) {
    const agent={interact:async()=>({status:201})};
    const admin={call:async(_method,route)=>route==='/v1/marketplace/capability-requests'
      ?{status:201,body:{request:{id:'request'}}}:route.endsWith('/open')?{status:200}:
      route.endsWith('/matches')?{status,body:{error:'upstream_timeout'},commandAttempts:[{attempt:1,httpStatus:status}]}:{status:200,body:{eligible:[],excluded:[]}}};
    const r=await observeMarketplace({scenario:{id:'competent-001',learnerId:'learner'},agent,admin,
      pkg:{objectiveIds:['o1']},actor:'admin',projectionWaitMs:0});
    assert.equal(r.status,'BLOCKED');assert.ok(r.idempotencyKey);assert.ok(r.correlationId);
    assert.equal(r.requestId,'request');assert.equal(r.commandAttempts.length,1);assert.ok(Number.isFinite(r.durationMs));
  }
});

test('withdrawal failure retains an attempted match and never downgrades an observed safety mismatch', async () => {
 for(const unsafe of [false,true]) {
  const result=base();
  if(unsafe)result.eligibleMatches.push({agentLearnerKey:'unsafe-other',eligible:true,checks:[]});
  const agent={interact:async(_s,op)=>({status:op==='withdraw-after-observation'?503:201})};
  const admin={call:async(_method,route)=>route==='/v1/marketplace/capability-requests'
    ?{status:201,body:{request:{id:'request'}}}:route.endsWith('/open')?{status:200}:
    route.endsWith('/matches')?{status:200,body:{matchResult:result},commandAttempts:[{attempt:1,httpStatus:200}]}:
    {status:200,body:{count:1,appearances:[],eligible:[],excluded:[]}}};
  const r=await observeMarketplace({scenario:{id:'competent-001',learnerId:'learner'},agent,admin,
    pkg:{objectiveIds:['o1']},actor:'admin',projectionWaitMs:0});
  assert.equal(r.status,unsafe?'MISMATCH':'BLOCKED');assert.equal(r.cleanupStatus,'BLOCKED');
  assert.ok(r.idempotencyKey);assert.equal(r.resultId,'r');assert.equal(r.commandAttempts.length,3);
  if(!unsafe)assert.equal(r.reason,'listing_cleanup_unavailable');
 }
});

test('an unexpected post-dispatch observation error retains the logical key without retaining private exception text', async () => {
 const agent={interact:async()=>({status:201})};
 const admin={call:async(_method,route)=>{
  if(route==='/v1/marketplace/capability-requests')return{status:201,body:{request:{id:'request'}}};
  if(route.endsWith('/open'))return{status:200};
  if(route.endsWith('/matches'))throw Error('PRIVATE_DIAGNOSTIC_TEXT');
  return{status:200,body:{eligible:[],excluded:[]}};
 }};
 const r=await observeMarketplace({scenario:{id:'competent-001',learnerId:'learner'},agent,admin,
   pkg:{objectiveIds:['o1']},actor:'admin',projectionWaitMs:0});
 assert.equal(r.status,'HARNESS_ERROR');assert.ok(r.idempotencyKey);assert.equal(r.requestId,'request');
 assert.ok(!JSON.stringify(r).includes('PRIVATE_DIAGNOSTIC_TEXT'));
});
