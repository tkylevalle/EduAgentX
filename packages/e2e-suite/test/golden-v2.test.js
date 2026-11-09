'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {golden,goldenHash,ALLOCATION,facts}=require('../golden-v2');
const {scenarios}=require('../cohort');
const {expected,compare,assess}=require('../golden-oracle');
const {developerCases,validateFacts,unsupportedRefusal}=require('../golden-run');
function ledger(){return ['b','a','c','d','e','f','g','h','i'].map((id,n)=>({agentLearnerKey:id,credentialId:`credential-${id}`,
 issuedAt:n<2?'2026-11-09T00:00:00.000Z':`2026-11-08T0${n}:00:00.000Z`,validUntil:'2027-01-01T00:00:00Z',
 status:'active',discoverable:true,fingerprintCurrent:true}));}
function result(e){const lane=(c,near)=>({...c,eligible:!near,lane:near?'Not Eligible':'Eligible Matches',
 components:{totalPerformance:{points:c.points.totalPerformance,actual:94.4,weight:35,denominator:100},
 adversarialPerformance:{points:c.points.adversarialPerformance,actual:86,weight:35,denominator:100},
 preferredCoverage:{weight:20,points:c.points.preferredCoverage,coveredObjectiveIds:c.coveredObjectives,requestedObjectiveIds:c.requestedPreferences},
 credentialRecency:{weight:10,points:c.points.credentialRecency,ageDays:c.ageDays,maximumAgeDays:c.maximumAgeDays}},
 shortfallComponents:c.shortfallComponents,shortfallDivisor:5,
 ordering:{decisiveCriterion:c.decisiveCriterion,comparedWith:c.comparedWith,criteria:c.criteria,tiedCriteria:c.tiedCriteria},
 evidence:{environment:'simulation',evidenceMode:'synthetic',assessmentMode:'standard',credentialStatus:'active'},
 sources:{verification:'answered',registry:'answered',package:'answered',lifecycleOrigin:'answered'},
 checks:[...Object.entries({objectives:'OBJECTIVE_MISSING',score_overall:'SCORE_OVERALL_BELOW',score_adversarial:'SCORE_ADVERSARIAL_BELOW',age:'CREDENTIAL_TOO_OLD',mode:'MODE_NOT_ALLOWED'}).map(([gate,code])=>({gate,tag:'request',passed:!c.reasons.includes(code)})),...['lifecycle_origin','discoverable','signature','schema','status','expiry','fingerprint','environment','domain','identity','evidence_mode'].map(gate=>({gate,tag:'trust',passed:true}))],
 gaps:c.gaps,satisfiedRequirements:c.satisfiedRequirements});return{policyVersion:'MATCH-POLICY-1.0.0',totalEligible:e.totalEligible,totalNearMatches:e.totalNearMatches,
 eligibleMatches:e.eligible.map(c=>lane(c,false)),nearMatches:e.near.map(c=>lane(c,true)),
 exclusions:e.exclusions.map(c=>({...c,reasons:c.reasons.map(code=>({code}))}))};}
test('versioned executable 100-case revision keeps the approved family allocation and supplemental identities separate',()=>{
 assert.equal(goldenHash,'sha256:71994f305399d24726fd23ad74f668443f097209d13ebf82680f335dfac455e4');
 assert.equal(golden.cases.length,100);assert.equal(new Set(golden.cases.map(c=>c.id)).size,100);
 for(const [family,n]of Object.entries(ALLOCATION))assert.equal(golden.cases.filter(c=>c.family===family).length,n);
 assert.equal(scenarios.length,1000);assert.equal(new Set(scenarios.map(s=>s.clientId)).size,1000);
 const formal=require('../manifest').manifest.scenarios;
 assert.ok(!scenarios.some(s=>formal.some(f=>f.clientId===s.clientId)));
 assert.equal(developerCases().length,19);assert.equal(new Set(developerCases().map(c=>c.family)).size,6);
 assert.ok(!/require\(['"].*(?:services|matching|eligibility)/.test(fs.readFileSync(require.resolve('../golden-oracle'),'utf8')));
});
test('unsupported-domain check uses the current public validation envelope without accepting another refusal',()=>{
 assert.equal(unsupportedRefusal({status:400,body:{error:'invalid_request',details:['domain_unsupported']}}),true);
 for(const r of [{status:200,body:{}},{status:400,body:{error:'invalid_request',details:['unrelated']}},
 {status:503,body:{error:'source_unavailable'}},{status:400,body:{error:'domain_unsupported'}}])assert.equal(unsupportedRefusal(r),false);
});
test('independent literal score and stable-ID tie anchor, top-five and top-three limits',()=>{
 const r=golden.cases[0].request,e=expected(r,ledger(),'2026-11-09T00:00:00.000Z');
 assert.equal(e.eligible.length,5);assert.equal(e.totalEligible,9);
 assert.equal(e.eligible[0].agentLearnerKey,'a');assert.equal(e.eligible[1].agentLearnerKey,'b');
 assert.equal(e.eligible[0].matchScore,93.14);assert.equal(e.eligible[0].decisiveCriterion,'agentLearnerKey');
 assert.equal(compare(result(e),e).status,'CONFORMANT');
 const near=expected({...r,minOverallPercent:95},ledger(),'2026-11-09T00:00:00.000Z');
 assert.equal(near.near.length,3);assert.equal(near.totalNearMatches,9);
 assert.deepEqual(near.near[0].reasons,['SCORE_OVERALL_BELOW']);
});
test('hard trust exclusion precedes both lanes; a second credential is representation, not a second learner',()=>{
 const l=ledger();l[0].status='suspended';l[1].fingerprintCurrent=false;
 l.push({...l[2],credentialId:'credential-extra'});
 const e=expected(golden.cases[0].request,l,'2026-11-09T00:00:00.000Z');
 assert.ok(!e.eligible.some(c=>['a','b'].includes(c.agentLearnerKey)));
 assert.equal(e.totalEligible,7);assert.equal(e.exclusions.length,3);
 assert.ok(e.exclusions.some(c=>c.reasons.includes('OTHER_CREDENTIAL_SELECTED')));
 assert.equal(compare(result(e),e).status,'CONFORMANT');
});
test('suspension and revocation predict the current verifier adapter codes exactly',()=>{
 for(const [status,code]of [['suspended','STATUS_SUSPENDED'],['revoked','STATUS_REVOKED']]){
  const rows=ledger();rows[0].status=status;
  const prediction=expected(golden.cases[0].request,rows,'2026-11-09T00:00:00.000Z');
  assert.deepEqual(prediction.exclusions[0].reasons,['SCHEMA_INVALID',code]);
  const actual=result(prediction);assert.equal(compare(actual,prediction).status,'CONFORMANT');
  actual.exclusions[0].reasons.pop();assert.equal(compare(actual,prediction).status,'MISMATCH');
  actual.exclusions[0].reasons.push({code},{code:'SIGNATURE_INVALID'});
  assert.equal(compare(actual,prediction).status,'MISMATCH');
 }
});
test('every family has independent expectations and a changed component, safety gate, lane or order is detected',()=>{
 for(const s of golden.cases){const l=ledger();if(s.action==='suspend')l[0].status='suspended';
 const e=expected(s.request,l,'2026-11-09T00:00:00.000Z');assert.equal(compare(result(e),e).status,'CONFORMANT');}
 const e=expected(golden.cases[0].request,ledger(),'2026-11-09T00:00:00.000Z');
 for(const edit of [r=>r.eligibleMatches[0].matchScore++,r=>r.eligibleMatches[0].checks.pop(),
 r=>r.eligibleMatches.reverse(),r=>r.eligibleMatches[0].components.credentialRecency.points++,r=>r.eligibleMatches[0].sources.lifecycleOrigin='source_not_available',r=>r.eligibleMatches[0].shortfallDivisor=4,r=>r.eligibleMatches[0].ordering.criteria=[]]){
 const r=result(e);edit(r);assert.equal(compare(r,e).status,'MISMATCH');}
 assert.equal(validateFacts({...facts,issuedAt:'2026-11-09',validUntil:'2027-01-01'}),true);
 assert.equal(validateFacts({...facts,overallPercent:100,issuedAt:'2026-11-09',validUntil:'2027-01-01'}),false);
});
test('uncheckable trust is BLOCKED without concealing a violation in the observable cohort',()=>{
 const request=golden.cases[0].request,rows=ledger(),at='2026-11-09T00:00:00.000Z';
 const blocked=rows[0],remaining=rows.slice(1),actual=result(expected(request,remaining,at));actual.generatedAt=at;
 actual.exclusions.push({agentLearnerKey:blocked.agentLearnerKey,credentialId:blocked.credentialId,
  reasons:[{code:'LIFECYCLE_ORIGIN_UNCHECKABLE'}]});
 assert.equal(assess(request,rows,actual).status,'BLOCKED');
 actual.eligibleMatches[0].matchScore++;
 assert.equal(assess(request,rows,actual).status,'MISMATCH');
});
test('exact gap details and satisfied requirements are independently checked',()=>{
 const request=golden.cases.find(c=>c.family==='gaps').request;
 const prediction=expected(request,ledger(),'2026-11-09T00:00:00.000Z');
 assert.deepEqual(prediction.near[0].gaps,[{code:'OBJECTIVE_MISSING',objectiveId:'not-assessed'}]);
 assert.ok(!prediction.near[0].satisfiedRequirements.includes('objectives'));
 for(const mutate of [r=>r.nearMatches[0].gaps=[{code:'OBJECTIVE_MISSING',objectiveId:'different-objective'}],
  r=>r.nearMatches[0].satisfiedRequirements=[],r=>r.nearMatches[0].components.preferredCoverage.weight=21]){
  const actual=result(prediction);mutate(actual);assert.equal(compare(actual,prediction).status,'MISMATCH');
 }
});
