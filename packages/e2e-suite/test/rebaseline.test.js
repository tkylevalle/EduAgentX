'use strict';
// Pure adversarial accounting fixtures; NOT public deployment evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const {complete}=require('../golden-evidence');
const {golden,goldenHash}=require('../golden-v2');
const {hash:cohortHash}=require('../cohort');
const {rebaselineReadiness}=require('../readiness');
const {assemble}=require('../../../scripts/finalize-issue-33');
const source={gitSha:'a'.repeat(40),fingerprint:`sha256:${'b'.repeat(64)}`};
function evidence(){return{schemaVersion:'issue-33-golden-execution/2.0.0',mode:'golden',status:'PASS',source,
 datasetHash:goldenHash,cohortHash,measuredAgents:1000,executedCases:100,formalGoldenRequirementsMeasured:true,finalReconciliationComplete:true,
 reconciledMatchCommands:100,matchDuplicateCount:0,latency:{p95Ms:500},
 results:golden.cases.map((c,i)=>({caseId:c.id,status:'CONFORMANT',requestId:`q-${i}`,resultId:`r-${i}`,idempotencyKey:`k-${i}`,
 observedCandidates:1001,matchCount:1,laneDuplicates:0,replayEqual:true,policyVersion:'MATCH-POLICY-1.0.0',
 explanationDigest:`sha256:${'c'.repeat(64)}`,durationMs:500}))};}
test('full golden evidence requires the exact dataset, cohort, source, measurements and unique case/request/result sets',()=>{
 assert.equal(complete(evidence(),source),true);
 for(const edit of [e=>e.mode='golden-developer',e=>e.measuredAgents=999,e=>e.datasetHash='wrong',e=>e.cohortHash='wrong',
 e=>e.results.pop(),e=>e.results[0].requestId=e.results[1].requestId,e=>e.results[0].resultId=e.results[1].resultId,
 e=>e.results[0].matchCount=2,e=>e.results[0].laneDuplicates=1,e=>e.results[0].status='BLOCKED',
 e=>e.source={...source,fingerprint:'wrong'},e=>e.latency.p95Ms=30001,e=>e.results[0].explanationDigest=null]){
 const e=evidence();edit(e);assert.equal(complete(e,source),false);
 }
});
test('readiness cannot become green from a merge, pilot aggregate or unapproved candidate matrix alone',()=>{
 const r=rebaselineReadiness({merged:true,dependenciesPresent:true,resources:{freeDiskGiB:100,availableMemoryGiB:12}});
 assert.equal(r.readiness,'NEEDS_FIXES');assert.equal(r.gates.length,14);
 assert.equal(r.gates.find(g=>g.id==='golden_harness').reason,'golden_v2_matrix_review_pending');
 assert.equal(r.formal1000,'NOT_RUN');assert.throws(()=>assemble({mode:'developer',executed:25},evidence(),{}));
});
