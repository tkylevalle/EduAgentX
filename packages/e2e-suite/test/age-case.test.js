'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assess,run}=require('../age-case');
const issued='2026-11-01T00:00:00.000Z',at='2026-11-02T00:00:00.001Z',credentialId='example-credential';
function body(){return{check:{at},eligible:[],excluded:[{credentialId,
 reasons:[{code:'CREDENTIAL_TOO_OLD',gate:'age',tag:'request'}],
 sources:{verification:'answered',registry:'answered',package:'answered',lifecycleOrigin:'answered'}}]};}
test('additional age oracle uses elapsed milliseconds, not rounded age or a fresh-cohort assumption',()=>{
 assert.equal(assess(body(),credentialId,issued).status,'CONFORMANT');
 const b=body();b.check.at='2026-11-02T00:00:00.000Z';
 assert.equal(assess(b,credentialId,issued).status,'BLOCKED');
 b.check.at='invalid';assert.equal(assess(b,credentialId,issued).status,'BLOCKED');
});
test('age cannot conceal a provenance, source, status or signature trust failure',()=>{
 for(const code of ['NOT_LIFECYCLE_ORIGIN','SIGNATURE_INVALID','STATUS_REVOKED','EVIDENCE_MODE_UNCHECKABLE']){
  const b=body();b.excluded[0].reasons.push({code,tag:'trust'});
  assert.equal(assess(b,credentialId,issued).status,'BLOCKED');
 }
 const b=body();b.excluded[0].sources.lifecycleOrigin='source_not_available';
 assert.equal(assess(b,credentialId,issued).status,'BLOCKED');
});
test('over-age inclusion and wrong or missing age explanations are mismatches',()=>{
 const b=body();b.eligible.push({credentialId});assert.equal(assess(b,credentialId,issued).status,'MISMATCH');
 for(const code of ['MODE_NOT_ALLOWED',null]){
  const b=body();b.excluded[0].reasons=code?[{code,gate:'mode',tag:'request'}]:[];
  assert.equal(assess(b,credentialId,issued).status,'MISMATCH');
 }
});
test('a missing retained credential blocks without creating a request or fabricating an age',async()=>{
 const calls=[];const result=await run({examinationId:'11111111-1111-1111-1111-111111111111',
  admin:{async call(...args){calls.push(args);return{status:404,body:{}};}}});
 assert.equal(result.status,'BLOCKED');assert.equal(calls.length,1);assert.equal(calls[0][0],'GET');
});
test('public additional-age workflow verifies real owner evidence and immutable reads without leaking signed values',async()=>{
 const calls=[],b=body();b.check.checkId='example-check';
 const examinationId='11111111-1111-1111-1111-111111111111';
 const result=await run({examinationId,now:()=>Date.parse(at),admin:{async call(method,route,payload){
  calls.push({method,route,payload});
  if(route.includes('by-examination'))return{status:200,body:{credential:{credentialId,compactJws:'PRIVATE_SIGNED_FIXTURE',credential:{validFrom:issued}}}};
  if(route==='/v1/credentials/verify')return{status:200,body:{overall:'VALID'}};
  if(route.endsWith('/capability-requests'))return{status:201,body:{request:{id:'example-request'}}};
  if(route.endsWith('/open'))return{status:200,body:{}};
  return{status:calls.filter(c=>c.route.endsWith('/eligibility-checks')).length===1&&method==='POST'?201:200,body:b};
 }}});
 assert.equal(result.status,'CONFORMANT');assert.equal(result.replayEqual,true);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_SIGNED_FIXTURE'));
 assert.ok(calls.every(c=>c.route.startsWith('/v1/')));
 assert.equal(calls.find(c=>c.route.endsWith('/capability-requests')).payload.request.maxCredentialAgeDays,1);
 assert.equal(calls.filter(c=>c.route.endsWith('/eligibility-checks')).length,2);
});
