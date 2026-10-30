'use strict';
// Real Gateway, Skill Gap, Examination, Marketplace and Training HTTP apps.
// Memory stores and injected curriculum/registry/grader/trust authorities isolate these contract tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
process.env.JWT_ISSUER='issue32-tests'; process.env.JWT_AUDIENCE='issue32-tests';
process.env.JWT_PRIVATE_KEY_PATH=path.resolve(__dirname,'../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH=path.resolve(__dirname,'../../../keys/dev-jwt-public.pem');
process.env.ADMIN_CLIENT_ID='skill-gap-admin'; process.env.ADMIN_CLIENT_SECRET='skill-gap-test-admin-secret';
process.env.AGENT_CLIENT_ID='skill-gap-agent'; process.env.AGENT_CLIENT_SECRET='skill-gap-test-agent-secret';
process.env.LIVE_AGENT_CLIENT_SECRET='skill-gap-test-live-secret';
const { createApp: gateway } = require('../../api-gateway');
const { createApp: skillGap } = require('../index');
const { createSources } = require('../clients');
const { createMemoryStore } = require('../store');
const { createApp: training } = require('../../training-service');
const { createMemoryStore: trainingStore } = require('../../training-service/store');
const { createFakePackageSource, createFakeRegistrySource } = require('../../training-service/sources');
const { createApp: marketplace } = require('../../marketplace-service');
const { createMemoryStore: marketStore, applyProjectionEvent } = require('../../marketplace-service/store');
const { createRemediationRelay } = require('../../examination-engine/remediation-relay');
const h = require('../../examination-engine/test/exam-harness');

async function serve(t,app) {
  const server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function send(url,method,route,body,headers={}) {
  const response=await fetch(`${url}${route}`,{method,headers:{'content-type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
}
async function setup(t,override={}) {
  const {pkg,registration}=h.fixture(), store=trainingStore();
  const train=await serve(t,training({internalKey:'training-key',store,
    packageSource:createFakePackageSource([{id:pkg.packageId,version:pkg.version,digest:pkg.digest,state:'Active',payload:pkg}]),
    registrySource:createFakeRegistrySource([{...registration,configurationVersion:1}])}));
  const packageApp=express(); packageApp.get('/packages/:id',(_req,res)=>res.json(pkg));
  const packageUrl=await serve(t,packageApp);
  const sources=createSources({packageUrl,packageKey:'package-key',trainingUrl:train,trainingKey:'training-key',...override});
  return {pkg,store,train,sources};
}
async function publicGateway(t,sources) {
  const sg=await serve(t,skillGap({store:createMemoryStore(),sources,internalKey:'skill-gap-key'}));
  const url=await serve(t,gateway({skillGapServiceUrl:sg,skillGapInternalKey:'skill-gap-key'}));
  const token=async(clientId,clientSecret)=>(await send(url,'POST','/v1/auth/tokens',{clientId,clientSecret})).body.accessToken;
  const admin=await token('skill-gap-admin','skill-gap-test-admin-secret');
  const agent=await token('skill-gap-agent','skill-gap-test-agent-secret');
  const call=(method,route,body,which=admin)=>send(url,method,route,body,which?{authorization:`Bearer ${which}`} : {});
  return {call,agent};
}
const ROOT='/v1/admin/skill-gap/recommendations';

test('public Examination recommendation observes one existing Training session and preserves original failure',async t=>{
  const engine=await h.boot(t,{grader:h.fakeGrader({score:0})});
  const attempt=await h.startAndAnswer(engine); await h.grade(engine,attempt);
  const original=await h.adminView(engine,attempt);
  assert.equal(original.status,'agent_failed');
  const c=await setup(t);
  c.sources.examination=async id=>(await engine.call('GET',`/internal/admin/attempts/${id}/remediation`,undefined,h.ADMIN)).body.trace;
  const g=await publicGateway(t,c.sources);
  const input={source:{type:'examination',id:attempt.attemptId},agentLearnerKey:h.ACTOR,idempotencyKey:'examination'};
  assert.equal((await g.call('POST',ROOT,input,g.agent)).status,403);
  assert.equal((await g.call('POST',ROOT,input,null)).status,401);
  const created=await g.call('POST',ROOT,input); assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.recommendation.recommendationId;
  assert.equal((await c.store.listSessions()).length,0);
  assert.equal((await g.call('POST',`${ROOT}/${id}/training-handoff`,{})).status,202);
  const relay=createRemediationRelay({store:engine.store,url:c.train,key:'training-key',clock:engine.clock});
  assert.equal((await relay.sweep()).delivered,1);
  const results=await Promise.all([g.call('POST',`${ROOT}/${id}/training-handoff`,{}),g.call('POST',`${ROOT}/${id}/training-handoff`,{})]);
  assert.equal(results[0].body.delivery.outcome,'delivered');
  assert.deepEqual(results[0].body.delivery,results[1].body.delivery);
  assert.equal((await c.store.listSessions()).length,1);
  assert.deepEqual(await h.adminView(engine,attempt),original);
  assert.ok(!JSON.stringify(created.body).includes('fake grader'));
});

test('real stored Near Match passes public recommendation/handoff; lost Training reply replays one assignment',async t=>{
  const c=await setup(t), store=marketStore(), pkg=c.pkg;
  const market=await serve(t,marketplace({store,internalKey:'market-key',sources:{
    verification:{verify:async()=>({signature:'valid',schema:'valid',status:'active'})},
    registry:{getCurrentFingerprint:async()=> 'sha256:grading-run'},
    package:{getPackage:async()=>({digest:pkg.digest,domain:'ai-agent-safety-secure-tool-use',objectiveIds:[pkg.objectives[0].id]})},
    lifecycle:{isLifecycleOrigin:async()=>true},
  }}));
  const marketCall=(method,route,body,actor='market-admin')=>send(market,method,route,body,{'x-internal-service-key':'market-key','x-actor-subject':actor});
  const req=await marketCall('POST','/internal/capability-requests',{idempotencyKey:'request',request:{
    domain:'ai-agent-safety-secure-tool-use',title:'Controlled safety request',requiredObjectiveIds:pkg.objectives.slice(0,2).map(o=>o.id),
    minOverallPercent:85,minAdversarialPercent:75,maxCredentialAgeDays:90,allowedAssessmentModes:['standard'],requiredEnvironment:'simulation'}});
  assert.equal(req.status,201);
  const requestId=req.body.request.id;
  await marketCall('POST',`/internal/capability-requests/${requestId}/open`,{version:1});
  await marketCall('POST','/internal/listings/publish',{idempotencyKey:'publish'},h.ACTOR);
  const now=Date.now();
  await applyProjectionEvent(store,{eventId:'issued',eventType:'credential.issued',credentialId:'credential-1',agentLearnerKey:h.ACTOR,
    occurredAt:new Date(now-1000).toISOString(),credential:{configurationFingerprint:'sha256:grading-run',
      package:{id:pkg.packageId,version:pkg.version,digest:pkg.digest},overallPercent:90,adversarialPercent:80,
      assessmentMode:'standard',evidenceMode:'synthetic',environment:'simulation',validFrom:new Date(now-1000).toISOString(),validUntil:new Date(now+86400000).toISOString()}});
  const matched=await marketCall('POST',`/internal/capability-requests/${requestId}/matches`,{idempotencyKey:'match'});
  assert.equal(matched.status,201); assert.equal(matched.body.matchResult.nearMatches.length,1);
  const result=matched.body.matchResult;
  const actual=createSources({marketplaceUrl:market,marketplaceKey:'market-key'});
  c.sources.marketplace=actual.marketplace;
  const g=await publicGateway(t,c.sources);
  const created=await g.call('POST',ROOT,{source:{type:'marketplace',id:result.resultId},agentLearnerKey:h.ACTOR,idempotencyKey:'market'});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.recommendation.recommendationId;
  assert.equal((await c.store.listSessions()).length,0);
  const actualTraining=c.sources.training; let lose=true;
  c.sources.training=async(...args)=>{const response=await actualTraining(...args);if(lose){lose=false;throw new Error('reply lost after commit');}return response;};
  assert.equal((await g.call('POST',`${ROOT}/${id}/training-handoff`,{})).status,202);
  const retry=await g.call('POST',`${ROOT}/${id}/training-handoff`,{});
  assert.equal(retry.body.delivery.outcome,'delivered');
  const sessions=await c.store.listSessions(); assert.equal(sessions.length,1);
  const detail=await c.store.readSession(retry.body.delivery.trainingSessionId);
  assert.deepEqual(detail.session.remediation.objectiveIds,[pkg.objectives[1].id]);
  assert.equal(detail.session.remediation.cause.type,'skill_gap');
  assert.deepEqual((await marketCall('GET',`/internal/match-results/${result.resultId}`)).body.matchResult,result);
  assert.equal((await g.call('POST',ROOT,{source:{type:'marketplace',id:result.resultId},agentLearnerKey:h.ACTOR,idempotencyKey:'bad',score:100})).status,400);
});
