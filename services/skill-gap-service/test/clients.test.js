'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createSources}=require('../clients');
test('HTTP sources use configured keys, bounded timeouts and safe fixed errors',async t=>{
  const app=express(), seen=[];
  app.use((req,res)=>{seen.push(req.headers);if(req.path.includes('slow'))return;res.status(req.path.includes('missing')?404:200).json({trace:{ok:true}});});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const config={examinationUrl:`http://127.0.0.1:${server.address().port}`,examinationKey:'test-key',timeoutMs:2000};
  const s=createSources(config);
  assert.deepEqual(await s.examination('found','corr-32'),{ok:true});
  assert.equal(seen[0]['x-internal-service-key'],'test-key');assert.equal(seen[0]['x-actor-role'],'admin');
  assert.equal(seen[0]['x-correlation-id'],'corr-32');
  await assert.rejects(s.examination('missing','corr'),{code:'source_not_found'});
  await assert.rejects(createSources({...config,timeoutMs:100}).examination('slow','corr'),{code:'source_unavailable'});
  await assert.rejects(createSources().marketplace('x','corr'),{code:'source_unavailable'});
});
