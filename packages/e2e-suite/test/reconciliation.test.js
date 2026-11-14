'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../reconciliation');
function fixture({lateDuplicate=false,unavailable=false,forbidden=false}={}){
 const scenario={learnerId:'learner'},result={status:'CONFORMANT',checks:[],duplicates:{},mappings:[
  {operation:'initial:admission',attemptId:'failed',idempotencyKey:'first'},
  {operation:'reexamination:admission',attemptId:'pass',idempotencyKey:'second'},
  {operation:'certification',attemptId:'pass',credentialId:'credential'}],
  marketplace:{resultId:'result',idempotencyKey:'match'}};
 const calls=[];
 const admin={async call(method,route){calls.push(route);if(unavailable)return{status:503};
 let body;
 if(route.includes('/examinations?')){const q=new URLSearchParams(route.split('?')[1]);const id=q.get('idempotencyKey')==='first'?'failed':'pass';
 body={count:lateDuplicate?2:1,attemptIds:lateDuplicate?[id,'extra']:[id]};}
 if(route.includes('/credentials?')){const id=new URLSearchParams(route.split('?')[1]).get('examinationId');body={count:id==='pass'||forbidden?1:0,credentialIds:id==='pass'||forbidden?['credential']:[]};}
 if(route.includes('/matches?'))body={count:1,resultIds:['result'],appearances:[{resultId:'result',agentLearnerKey:'learner'}]};
 return{status:200,body};}};
 return{scenario,result,admin,actor:'admin',now:()=>0,calls};
}
test('final sweep keeps a deliberate remediation retake separate and rereads every logical command',async()=>{
 const f=fixture();const r=await reconcile(f);assert.equal(r.status,'CONFORMANT');assert.equal(r.reconciliation.commands,5);
 assert.equal(r.reconciliation.status,'CONFORMANT');assert.equal(r.duplicates.examinations,0);assert.equal(r.duplicates.credentials,0);
 assert.equal(r.duplicates.matches,0);assert.equal(new Set(f.calls).size,5);
});
test('late duplicates, a forbidden credential and unavailable final inventory cannot be hidden by earlier conformance',async()=>{
 for(const options of [{lateDuplicate:true},{forbidden:true},{unavailable:true}]){
 const r=await reconcile(fixture(options));assert.notEqual(r.status,'CONFORMANT');assert.notEqual(r.reconciliation.status,'CONFORMANT');
 if(options.lateDuplicate)assert.equal(r.duplicates.examinations,1);
 }
});

test('final sweep reconciles an attempted command without a returned result ID',async()=>{
 const f=fixture();delete f.result.marketplace.resultId;
 f.result.status='BLOCKED';f.result.reason='matching_unavailable';
 const r=await reconcile(f);
 assert.equal(r.reconciliation.commands,5);assert.equal(r.reconciliation.status,'CONFORMANT');
 assert.equal(r.marketplace.reconciliation.state,'committed_without_reply');
 assert.equal(r.duplicates.matches,0);assert.equal(r.status,'BLOCKED'); // Missing outcome/explanations are not invented.
});

test('unavailable match inventory clears earlier duplicate zeros and cannot be counted as measured',async()=>{
 const f=fixture(),read=f.admin.call;
 f.result.duplicates.matches=0;f.result.duplicates.laneAppearances=0;
 f.admin.call=async(method,route)=>route.includes('/matches?')?{status:503}:read(method,route);
 const r=await reconcile(f);
 assert.equal(r.reconciliation.status,'BLOCKED');assert.equal(r.duplicates.matches,null);
 assert.equal(r.duplicates.laneAppearances,null);
});

test('every attempted match is reconciled even when a different final inventory fails or violates an invariant',async()=>{
 for(const options of [{lateDuplicate:true},{unavailable:true},{forbidden:true}]) {
  const f=fixture(options);await reconcile(f);
  assert.ok(f.calls.some(route=>route.includes('/matches?')));
  assert.ok(f.calls[0].includes('/matches?'));
  if(options.unavailable)assert.equal(f.result.duplicates.matches,null);
 }
});
