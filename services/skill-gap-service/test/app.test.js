'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const f = require('./fixtures');

async function boot(t, patch = {}) {
  const state = { trainingCalls: 0, trace: f.trace(), match: f.match() };
  const sources = { examination: async()=>structuredClone(state.trace), marketplace: async()=>structuredClone(state.match),
    package: async()=>f.pkg(), training: async()=>{ state.trainingCalls++; return {status:201,body:{sessionId:'session-1'}}; }, ...patch };
  const store=createMemoryStore();
  const server=createApp({store,sources,internalKey:'key',clock:()=>f.NOW}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const call=async(method,path,body,headers={})=>{
    const res=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,
      headers:{'content-type':'application/json','x-internal-service-key':'key','x-actor-subject':'admin','x-actor-role':'admin',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:res.status,body:await res.json()};
  };
  const create=async(type='examination',key='k')=>call('POST','/internal/recommendations',{...f.input(type),idempotencyKey:key});
  const handoff=async(id,body={})=>call('POST',`/internal/recommendations/${id}/training-handoff`,body);
  return {state,sources,store,call,create,handoff};
}
test('create/read do not assign training; duplicate commands and source identities replay; changed key content conflicts',async t=>{
  const c=await boot(t), created=await c.create(); assert.equal(created.status,201);
  const id=created.body.recommendation.recommendationId;
  assert.equal((await c.call('GET',`/internal/recommendations/${id}`)).status,200);
  assert.equal((await c.create()).status,200);
  assert.equal((await c.create('examination','other-key')).body.recommendation.recommendationId,id);
  assert.equal((await c.create('marketplace')).status,409);
  assert.equal(c.state.trainingCalls,0);
  c.sources.examination=async()=>{throw new Error('secret upstream error');};
  assert.equal((await c.create()).status,200,'stored replay works during outage');
  const unavailable=await c.create('examination','fresh-key'); assert.equal(unavailable.status,503);
  assert.ok(!JSON.stringify(unavailable).includes('secret'));
});
test('Examination handoff observes existing relay; no duplicate assignment during pending or delivered',async t=>{
  const c=await boot(t), before=structuredClone(c.state.trace), r=(await c.create()).body.recommendation;
  assert.equal((await c.handoff(r.recommendationId)).status,202);
  c.state.trace.remediation.delivery={eventId:r.source.eventId,outcome:'delivered',trainingSessionId:'existing-session'};
  assert.equal((await c.handoff(r.recommendationId)).body.delivery.trainingSessionId,'existing-session');
  assert.equal((await c.handoff(r.recommendationId)).body.delivery.outcome,'delivered');
  assert.equal(c.state.trainingCalls,0);
  assert.deepEqual(c.state.trace.failure,before.failure);
});
test('explicit Marketplace handoff retries lost responses and serializes concurrent commands',async t=>{
  const c=await boot(t), before=structuredClone(c.state.match), r=(await c.create('marketplace')).body.recommendation;
  c.sources.training=async()=>{throw new Error('down');};
  assert.equal((await c.handoff(r.recommendationId)).status,202);
  c.sources.training=async()=>{c.state.trainingCalls++;return {status:201,body:{sessionId:'same-session'}};};
  const results=await Promise.all([c.handoff(r.recommendationId),c.handoff(r.recommendationId)]);
  assert.deepEqual(results.map(x=>x.body.delivery.trainingSessionId),['same-session','same-session']);
  assert.equal(c.state.trainingCalls,1);
  assert.deepEqual(c.state.match,before);
  assert.equal((await c.handoff(r.recommendationId,{score:100})).status,400);
});
test('authorization, missing sources, unknown reads, unsupported domain and no-targeted-training are safe',async t=>{
  const c=await boot(t);
  assert.equal((await c.call('POST','/internal/recommendations',{}, {'x-actor-role':'viewer'})).status,403);
  assert.equal((await c.call('GET','/internal/recommendations/missing',undefined,{'x-internal-service-key':'wrong'})).status,401);
  assert.equal((await c.call('GET','/internal/recommendations/missing')).status,404);
  c.sources.package=async()=>({...f.pkg(),manifest:{domain:'Other'}});
  assert.equal((await c.create()).body.error,'unsupported_domain');
  c.sources.package=async()=>f.pkg(); c.state.match.nearMatches[0].gaps=[{code:'MODE_NOT_ALLOWED',actual:'fallback',allowed:['standard']}];
  const r=(await c.create('marketplace')).body.recommendation;
  assert.equal((await c.handoff(r.recommendationId)).body.delivery.reason,'no_targeted_training');
  assert.equal(c.state.trainingCalls,0);
});
test('changed source digest, invalid success replies and permanent Training refusals are handled explicitly',async t=>{
  const c=await boot(t); await c.create(); c.state.trace.remediation.event.failure.failureReasons=['other'];
  assert.equal((await c.create('examination','new-key')).status,409);
  const r=(await c.create('marketplace','market')).body.recommendation;
  c.sources.training=async()=>({status:200,body:{}});
  assert.equal((await c.handoff(r.recommendationId)).status,202);
  c.sources.training=async()=>({status:422,body:{error:'unknown_objectives'}});
  assert.equal((await c.handoff(r.recommendationId)).body.delivery.outcome,'refused');
});
