'use strict';
// Credentials come from the operator's environment, never CLI arguments/output.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {PublicClient,createPacer}=require('../packages/e2e-suite/client');
const {run}=require('../packages/e2e-suite/age-case');
const {sourceIdentity}=require('../packages/e2e-suite/run');
async function main(){
 const args=process.argv.slice(2),i=args.indexOf('--examination-id');
 if(i<0||!process.env.E2E_GATEWAY_URL||!process.env.ADMIN_CLIENT_ID||!process.env.ADMIN_CLIENT_SECRET)
  throw new Error('configured_retained_deployment_required');
 const source=sourceIdentity(),startedAt=new Date().toISOString();
 const admin=new PublicClient({gatewayUrl:process.env.E2E_GATEWAY_URL,clientId:process.env.ADMIN_CLIENT_ID,
  clientSecret:process.env.ADMIN_CLIENT_SECRET,pace:createPacer()});
 let result=await run({admin,examinationId:args[i+1]});
 if(sourceIdentity().fingerprint!==source.fingerprint)result={status:'MISMATCH',reason:'source_changed_during_run'};
 const directory=path.resolve('artifacts/issue-33',`additional-age-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({schemaVersion:'issue-33-additional-age/1.0.0',
  scope:'ADDITIONAL_REAL_PUBLIC_COVERAGE_NOT_FORMAL_GOLDEN',source,startedAt,finishedAt:new Date().toISOString(),
  result,formal1000:'NOT_RUN'},null,2)+'\n',{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(directory,'artifact-manifest.json'),JSON.stringify({schemaVersion:'1.0.0',artifacts:{
  'report.json':createHash('sha256').update(fs.readFileSync(path.join(directory,'report.json'))).digest('hex')}},null,2)+'\n');
 console.log(JSON.stringify({directory,status:result.status,reason:result.reason}));
 process.exitCode=result.status==='CONFORMANT'?0:result.status==='BLOCKED'?2:1;
}
if(require.main===module)main().catch(()=>{console.error('additional_age_configuration_or_transport_unavailable');process.exitCode=1;});
