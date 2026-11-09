'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { golden, goldenHash, facts } = require('./golden-v2');
const oracle = require('./golden-oracle');
const { scenarios, hash: cohortHash } = require('./cohort');
const { PublicClient, createPacer, poll } = require('./client');
const { setupPackage, createOrchestrator, registrationPayload, SuiteError, requireReply } = require('./lifecycle');
const { command, digest } = require('./identity');
const { laneDuplicates } = require('./invariants');
const { sourceIdentity } = require('./run');
const { latencyStats } = require('./report');
const { createJournal } = require('./checkpoint');
const root = '/v1/marketplace';
const developerCases = () => golden.cases.filter(c => (c.family === 'eligible' && c.index < 4) ||
  (['gaps','trust'].includes(c.family) && c.index < 5) || (c.family === 'history' && c.index < 3) ||
  (['ranking','limits'].includes(c.family) && c.index === 0));
function ensure(value, reason) { if (!value) throw new SuiteError('MISMATCH', reason); }
function validateFacts(f) {
  return f && f.overallPercent === facts.overallPercent && f.adversarialPercent === facts.adversarialPercent &&
    f.environment === facts.environment && f.evidenceMode === facts.evidenceMode && f.assessmentMode === facts.assessmentMode &&
    Number.isFinite(Date.parse(f.issuedAt)) && Date.parse(f.validUntil) > Date.parse(f.issuedAt);
}
function unsupportedRefusal(reply) {
  return reply.status === 400 && reply.body?.error === 'invalid_request' &&
    Array.isArray(reply.body.details) && reply.body.details.includes('domain_unsupported');
}
async function execute({ mode = 'golden-developer', env = process.env } = {}) {
  if (!['golden-developer','golden'].includes(mode)) throw new Error('invalid_golden_mode');
  const source = sourceIdentity(), startedAt = new Date().toISOString(), records = [], ledger = [], contexts = [], matchCommands = [];
  const journal = createJournal(env.E2E_OUTPUT_DIR, { source, kind:'golden' });
  const selected = mode === 'golden' ? scenarios : scenarios.slice(0,12), specs = mode === 'golden' ? golden.cases : developerCases();
  const roster = JSON.parse(fs.readFileSync(env.E2E_CLIENTS_PATH,'utf8')), pace = createPacer();
  const make = (id, secret) => new PublicClient({ gatewayUrl:env.E2E_GATEWAY_URL,clientId:id,clientSecret:secret,pace });
  const admin = make(env.ADMIN_CLIENT_ID,env.ADMIN_CLIENT_SECRET);
  const clientFor = s => {const row=roster.find(r=>r.clientId===s.clientId);if(!row)throw new Error('identity_missing');return make(row.clientId,row.clientSecret);};
  let status = 'PASS', reason = null, setupCount = 0, cohortFinishedAt = null;
  const correlation = command('golden-v2','setup').correlationId;
  const call = async(method, route, body, statuses=[200]) => requireReply(await admin.call(method,route,body,correlation),statuses,'golden_public_operation');
  try {
    const pkg=await setupPackage({admin,reviewers:[1,2].map(i=>make(env[`REVIEWER_${i}_CLIENT_ID`],env[`REVIEWER_${i}_CLIENT_SECRET`]))});
    const orchestrator=createOrchestrator({admin,actor:env.ADMIN_CLIENT_ID,pkg,authoritativeExecution:true});
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(cursor<selected.length){const s=selected[cursor++],ctx=await orchestrator.prepare(s,clientFor(s));
        await orchestrator.observe(ctx);journal.write('lifecycle',ctx.result);ensure(ctx.result.lifecycleStatus==='CONFORMANT','golden_cohort_lifecycle');
        ensure(ctx.credentialFacts?.length===1&&validateFacts(ctx.credentialFacts[0]),'golden_declared_credential_facts');
        contexts.push(ctx);setupCount++;
      }
    }));
    contexts.sort((a,b)=>a.scenario.id<b.scenario.id?-1:1);
    // One deliberate additional admission/credential, not a duplicate command.
    await orchestrator.additionalCredential(contexts[0],'golden-representative');
    for(const ctx of contexts){
      ensure([200,201].includes((await ctx.agent.interact(ctx.scenario,'golden-publish','marketplace.listing.publish')).status),'golden_publish');
      for(const f of ctx.credentialFacts){ensure(validateFacts(f),'golden_declared_credential_facts');ledger.push({...f,status:'active',discoverable:true,fingerprintCurrent:true});}
    }
    // Pre-projection readiness uses fresh CHECK keys, never immutable match keys.
    let probe=0;
    const made=await call('POST',`${root}/capability-requests`,{idempotencyKey:command('golden-v2','projection-request').idempotencyKey,
      request:{...golden.cases[0].request,title:'issue33-golden-projection'}},[200,201]);
    await call('POST',`${root}/capability-requests/${made.request.id}/open`,{version:1});
    const projected=await poll(()=>admin.call('POST',`${root}/capability-requests/${made.request.id}/eligibility-checks`,{
      idempotencyKey:command('golden-v2',`projection:${probe++}`).idempotencyKey},correlation),r=>{
      const rows=[...(r.body?.eligible||[]),...(r.body?.excluded||[])];return rows.length===ledger.length&&ledger.every(c=>rows.some(r=>r.credentialId===c.credentialId));
    },{deadline:Date.now()+120000});
    if(!projected)throw new SuiteError('BLOCKED','golden_projection_incomplete');
    cohortFinishedAt = new Date().toISOString();
    for(const spec of specs){
      const before=records.length, target=contexts.slice(1).find((c,i)=>i>=spec.index%(contexts.length-1)&&ledger.filter(r=>r.agentLearnerKey===c.scenario.learnerId).every(r=>r.status!=='revoked'))||contexts.slice(1).find(c=>ledger.filter(r=>r.agentLearnerKey===c.scenario.learnerId).every(r=>r.status!=='revoked')), key=target.scenario.learnerId;
      const targetRows=()=>ledger.filter(c=>c.agentLearnerKey===key);
      const statusChange=async action=>{for(const c of targetRows()){await call('POST',`/v1/admin/credentials/${c.credentialId}/${action}`,{reason:'Issue33 isolated golden scenario',agentLearnerKey:key});c.status=action==='reinstate'?'active':action==='suspend'?'suspended':'revoked';}};
      const fingerprint=async changed=>{const payload=registrationPayload(target.scenario);if(changed)payload.policyConfigurationHash=digest({case:spec.id});
        requireReply(await target.agent.register(target.scenario,payload,`${spec.id}:fingerprint:${changed}`),[200,201],'golden_fingerprint');
        targetRows().forEach(c=>c.fingerprintCurrent=!changed);};
      const listing=async publish=>{requireReply(await target.agent.interact(target.scenario,`${spec.id}:listing:${publish}`,
        publish?'marketplace.listing.publish':'marketplace.listing.withdraw'),[200,201],'golden_listing');targetRows().forEach(c=>c.discoverable=publish);};
      let requestId;
      try {
        if(['suspend','revoke'].includes(spec.action))await statusChange(spec.action);
        if(spec.action==='fingerprint')await fingerprint(true);
        if(spec.action==='withdraw')await listing(false);
        const created=await call('POST',`${root}/capability-requests`,{idempotencyKey:command(spec.id,'create').idempotencyKey,
          request:{...spec.request,title:spec.logicalRequestId}},[200,201]);requestId=created.request.id;
        await call('POST',`${root}/capability-requests/${requestId}/open`,{version:1});
        const commandKey=command(spec.id,'match').idempotencyKey,start=Date.now();
        const fresh=await call('POST',`${root}/capability-requests/${requestId}/matches`,{idempotencyKey:commandKey},[201,200]);
        const durationMs=Date.now()-start,result=fresh.matchResult;
        const prediction=oracle.expected(spec.request,ledger,result.generatedAt);
        const assessment=oracle.assess(spec.request,ledger,result);
        if(spec.expectedPrincipalReason)ensure([...prediction.near,...prediction.exclusions].some(c=>c.reasons.includes(spec.expectedPrincipalReason)), 'golden_reason_precondition');
        const firstHash=digest(result);
        if(spec.action==='close')await call('POST',`${root}/capability-requests/${requestId}/close`,{});
        if(spec.action==='version'){
          await call('POST',`${root}/capability-requests/${requestId}/versions`,{idempotencyKey:command(spec.id,'version2').idempotencyKey,
            request:{...spec.request,title:`${spec.logicalRequestId}-v2`,minOverallPercent:95}},[200,201]);
          await call('POST',`${root}/capability-requests/${requestId}/open`,{version:2});
        }
        if(spec.action==='suspend-history'){
          await statusChange('suspend');
          const fresh2=await call('POST',`${root}/capability-requests/${requestId}/matches`,{idempotencyKey:command(spec.id,'fresh-after-change').idempotencyKey},[200,201]);
          ensure(oracle.compare(fresh2.matchResult,oracle.expected(spec.request,ledger,fresh2.matchResult.generatedAt)).status==='CONFORMANT','golden_fresh_state');
          const secondKey=command(spec.id,'fresh-after-change').idempotencyKey;
          const secondInventory=await call('GET',`/v1/admin/reconciliation/matches?${new URLSearchParams({actor:env.ADMIN_CLIENT_ID,idempotencyKey:secondKey})}`);
          ensure(secondInventory.count===1&&laneDuplicates(secondInventory.appearances)===0,'golden_fresh_command_duplicates');
          matchCommands.push({idempotencyKey:secondKey,resultId:fresh2.matchResult.resultId});
        }
        const retry=await call('POST',`${root}/capability-requests/${requestId}/matches`,{idempotencyKey:commandKey},[200]);
        const historical=await call('GET',`${root}/match-results/${result.resultId}`);
        ensure(firstHash===digest(retry.matchResult)&&firstHash===digest(historical.matchResult),'golden_historical_replay');
        const inventory=await call('GET',`/v1/admin/reconciliation/matches?${new URLSearchParams({actor:env.ADMIN_CLIENT_ID,idempotencyKey:commandKey})}`);
        const duplicates=Math.max(0,inventory.count-1),lanes=laneDuplicates(inventory.appearances);
        ensure(inventory.count===1&&duplicates===0&&lanes===0,'golden_duplicates');
        matchCommands.push({idempotencyKey:commandKey,resultId:result.resultId});
        records.push({caseId:spec.id,family:spec.family,status:assessment.status,reason:assessment.reason||assessment.errors.join(':')||null,
          blockedCodes:assessment.blockedCodes||[],
          requestId,resultId:result.resultId,idempotencyKey:commandKey,durationMs,observedCandidates:ledger.length,
          matchCount:inventory.count,laneDuplicates:lanes,replayEqual:true,explanationDigest:firstHash,
          expectedDigest:digest(prediction),policyVersion:result.policyVersion,eligible:result.totalEligible,near:result.totalNearMatches,
          exclusions:result.exclusions.length});
        journal.writeCase(records.at(-1));
        if(assessment.status==='BLOCKED')throw new SuiteError('BLOCKED','golden_trust_sources_uncheckable');
        ensure(assessment.status==='CONFORMANT','golden_oracle_mismatch');
      }finally{
        if(['suspend','suspend-history'].includes(spec.action)&&targetRows().every(c=>c.status!=='revoked'))await statusChange('reinstate');
        if(spec.action==='fingerprint')await fingerprint(false);
        if(spec.action==='withdraw')await listing(true);
      }
      ensure(records.length===before+1,'golden_case_accounting');
    }
    // The public contract refuses unsupported request creation before matching.
    const denied=await admin.call('POST',`${root}/capability-requests`,{idempotencyKey:command('golden-v2','unsupported').idempotencyKey,
      request:{...golden.cases[0].request,title:'unsupported',domain:'unsupported-domain'}},correlation);
    ensure(unsupportedRefusal(denied),'golden_unsupported_domain');
    for(const c of matchCommands){
      const inventory=await call('GET',`/v1/admin/reconciliation/matches?${new URLSearchParams({actor:env.ADMIN_CLIENT_ID,idempotencyKey:c.idempotencyKey})}`);
      ensure(inventory.count===1&&inventory.resultIds?.[0]===c.resultId&&Array.isArray(inventory.appearances)&&
        laneDuplicates(inventory.appearances)===0,'golden_final_match_reconciliation');
    }
    for(const ctx of contexts){
      await orchestrator.reconcile(ctx);
      ensure(ctx.result.reconciliation?.status==='CONFORMANT','golden_final_reconciliation');
    }
  }catch(e){status=e instanceof SuiteError&&e.status==='BLOCKED'?'BLOCKED':'FAIL';reason=e instanceof SuiteError?e.reason:'golden_execution_error';}
  if(sourceIdentity().fingerprint!==source.fingerprint){status='FAIL';reason='source_changed_during_run';}
  journal.close();
  const report={schemaVersion:'issue-33-golden-execution/2.0.0',mode,label:'NOT FORMAL ISSUE #33 ACCEPTANCE',source,
    datasetHash:goldenHash,cohortHash,startedAt,finishedAt:new Date().toISOString(),status,reason,
    plannedCases:specs.length,executedCases:records.length,plannedAgents:selected.length,measuredAgents:setupCount,
    timings: { cohortSetupMs: cohortFinishedAt ? Date.parse(cohortFinishedAt)-Date.parse(startedAt) : null,
      caseExecutionMs: cohortFinishedAt ? Date.now()-Date.parse(cohortFinishedAt) : null },
    finalReconciliationComplete:status==='PASS'&&contexts.length===selected.length&&contexts.every(c=>c.result.reconciliation?.status==='CONFORMANT'),
    reconciledMatchCommands: status==='PASS'?matchCommands.length:null, matchDuplicateCount:status==='PASS'?0:null,
    formalGoldenRequirementsMeasured:mode==='golden'&&status==='PASS'&&records.length===100&&setupCount>=1000,
    uniqueCapabilityRequests:new Set(records.map(r=>r.requestId)).size,latency:latencyStats(records.map(r=>r.durationMs)),results:records,
    formal1000:'NOT_RUN',limitations:golden.additionalCoverage,
    environment:{project:env.E2E_PROJECT,configHash:env.E2E_CONFIG_HASH,imageHash:env.E2E_IMAGE_HASH,seam:'public_compose'}};
  const directory=env.E2E_OUTPUT_DIR;fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(directory,'marketplace.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const artifacts=Object.fromEntries(['report.json','marketplace.jsonl','progress.jsonl'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(directory,n))).digest('hex')]));
  fs.writeFileSync(path.join(directory,'artifact-manifest.json'),JSON.stringify({schemaVersion:'1.0.0',artifacts},null,2)+'\n');
  return report;
}
if(require.main===module)execute({mode:process.argv[process.argv.indexOf('--mode')+1]}).then(r=>{
  console.log(JSON.stringify({status:r.status,reason:r.reason,agents:r.measuredAgents,cases:r.executedCases}));process.exitCode=r.status==='PASS'?0:r.status==='BLOCKED'?2:1;
}).catch(()=>{console.error('golden_configuration_error');process.exitCode=1;});
module.exports={execute,developerCases,validateFacts,unsupportedRefusal};
