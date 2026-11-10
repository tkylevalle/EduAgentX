'use strict';
// Safe progress survives an interrupted long run. Distinct schema/scope: these
// rows are never inputs to acceptance accounting or a resume mechanism.
const fs=require('node:fs'),path=require('node:path');
const {safeScenario,safeMarket}=require('./report');
const {manifest,manifestHash}=require('./manifest');
function createJournal(directory,{source={},kind='lifecycle'}={}){
 if(fs.existsSync(path.join(directory,'report.json')))throw new Error('evidence_directory_already_used');
 fs.mkdirSync(directory,{recursive:true});
 const fd=fs.openSync(path.join(directory,'progress.jsonl'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 let closed=false;
 const append=row=>fs.writeSync(fd,JSON.stringify(row)+'\n');
 append({schemaVersion:'issue-33-progress/1.0.0',type:'start',scope:'PROVISIONAL_NOT_ACCEPTANCE_EVIDENCE',
  source:{gitSha:/^[0-9a-f]{40}$/.test(source.gitSha||'')?source.gitSha:null,
   fingerprint:/^sha256:[0-9a-f]{64}$/.test(source.fingerprint||'')?source.fingerprint:null,dirty:typeof source.dirty==='boolean'?source.dirty:null},
  dataset:kind==='golden'?{version:require('./golden-v2').golden.version,hash:require('./golden-v2').goldenHash,cohortHash:require('./cohort').hash}:
   {version:manifest.version,seed:manifest.seed,hash:manifestHash}});
 return{
  write(phase,result){
   if(closed)return false;
   if(!['lifecycle','final'].includes(phase))throw new Error('invalid_checkpoint_phase');
   const row=safeScenario({...result,status:phase==='lifecycle'&&result.status==='CONFORMANT'?'UNMEASURED':result.status});
   append({schemaVersion:'issue-33-progress/1.0.0',scope:'PROVISIONAL_NOT_ACCEPTANCE_EVIDENCE',phase,
    recordedAt:new Date().toISOString(),scenario:row});return true;
  },
  writeCase(result){if(closed)return false;append({schemaVersion:'issue-33-progress/1.0.0',scope:'PROVISIONAL_NOT_ACCEPTANCE_EVIDENCE',phase:'golden-case',recordedAt:new Date().toISOString(),marketplace:safeMarket(result)});return true;},
  writeCommand(result){if(closed)return false;append({schemaVersion:'issue-33-progress/1.0.0',scope:'PROVISIONAL_NOT_ACCEPTANCE_EVIDENCE',phase:'market-command',recordedAt:new Date().toISOString(),marketplace:safeMarket(result)});return true;},
  close(){if(!closed){fs.closeSync(fd);closed=true;}}
 };
}
module.exports={createJournal};
