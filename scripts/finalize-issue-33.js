'use strict';
// Assemble executed public evidence only; this command cannot execute scenarios.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { manifest } = require('../packages/e2e-suite/manifest');
const { buildReport, writeEvidence } = require('../packages/e2e-suite/report');
function read(file) {
  const bytes = fs.readFileSync(file), inventory = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'artifact-manifest.json')));
  if (inventory.artifacts?.[path.basename(file)] !== createHash('sha256').update(bytes).digest('hex')) throw new Error('artifact_digest_mismatch');
  return JSON.parse(bytes);
}
function assemble(lifecycle, golden, faults) {
  if (lifecycle.mode !== 'formal' || lifecycle.executed !== 1000 || lifecycle.results?.length !== 1000 ||
    lifecycle.results.some(r => !r.oracle || r.oracle.status !== 'CONFORMANT' && r.status === 'CONFORMANT'))
    throw new Error('complete_formal_lifecycle_evidence_required');
  for (const r of lifecycle.results) {
    const definition = manifest.scenarios.find(s => s.id === r.scenarioId);
    if (!definition) throw new Error('unknown_formal_scenario');
    const calculated = require('../packages/e2e-suite/oracle').compare(definition, r.observed, r.marketplace);
    if (calculated.expectedHash !== r.oracle?.expectedHash ||
      (r.status === 'CONFORMANT' && calculated.status !== 'CONFORMANT')) throw new Error('independent_oracle_disagrees');
  }
  const completeGolden = require('../packages/e2e-suite/golden-evidence').complete(golden, lifecycle.source) === true;
  const requiredFaults = ['outage_system_aborted_grading_unavailable','post_deadline_trusted_grading_complete',
    'outage_no_credential','partial_learner_timeout','unavailable_learner_timeout'];
  const completeFaults = faults?.kind === 'faults' && faults.status === 'PASS' && faults.source?.fingerprint === lifecycle.source.fingerprint &&
    faults.source?.gitSha === lifecycle.source.gitSha && requiredFaults.every(id => faults.checks?.some(c => c.id === id && c.passed === true)) &&
    faults.checks.every(c => c.passed === true) && faults.details?.retryWindowMs === 900000;
  const resolved = [...(completeGolden ? ['full_marketplace_golden','marketplace_1000_candidate_load'] : []),
    ...(completeFaults ? ['real_system_abort_fault','grading_after_deadline_fault'] : [])];
  return buildReport({ mode:'formal',selected:manifest.scenarios,results:lifecycle.results,
    source:lifecycle.source,environment:lifecycle.environment,startedAt:lifecycle.startedAt,
    finishedAt:golden?.finishedAt || lifecycle.finishedAt,blockers:lifecycle.knownBlockers,runErrors:lifecycle.runErrors,
    notRun:lifecycle.notRun.filter(code=>!resolved.includes(code)),goldenEvidence:golden,
    reproduction:'Run the reviewed formal lifecycle, full golden cohort and fault commands; assemble with scripts/finalize-issue-33.js.' });
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
    for(const key of ['--lifecycle','--golden','--faults','--output'])if(!args.includes(key))throw new Error('missing_argument');
    const report=assemble(read(value('--lifecycle')),read(value('--golden')),read(value('--faults')));
    writeEvidence(value('--output'),report);
    console.log(JSON.stringify({technicalChecks:report.technicalChecks,formalAcceptance:report.formalAcceptance}));
    process.exitCode=report.technicalChecks==='PASS'?0:report.technicalChecks==='FAIL'?1:2;
  }catch{console.error('issue33_finalization_refused');process.exitCode=1;}
}
module.exports={assemble,read};
