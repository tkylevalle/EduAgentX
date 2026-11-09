'use strict';
// End-of-run public/admin reconciliation, separate from per-command replay checks.
const { command } = require('./identity');
const { laneDuplicates, check } = require('./invariants');
async function reconcile({ scenario, result, admin, actor, now = Date.now }) {
  const put = (id, passed) => {
    const prior = result.checks.find(c => c.id === id);
    if (prior) prior.passed = prior.passed === false ? false : passed;
    else result.checks.push(check(id, passed));
    if (!passed) throw Object.assign(new Error('final_reconciliation_mismatch'), { measuredFailure:true });
  };
  const read = async route => {
    const r = await admin.call('GET', route, undefined, command(scenario.id || scenario.learnerId, 'final-reconciliation').correlationId);
    if (r.status !== 200 || !Number.isInteger(r.body?.count) || r.body.count < 0)
      throw new Error('final_reconciliation_unavailable');
    return r.body;
  };
  let commands = 0, examinations = 0, credentials = 0;
  try {
    const admissions = result.mappings.filter(m => m.operation.endsWith(':admission'));
    result.observed ||= {};
    if (!admissions.length) throw new Error('final_reconciliation_unavailable');
    for (const m of admissions) {
      const a = await read(`/v1/admin/reconciliation/examinations?${new URLSearchParams({agentLearnerKey:scenario.learnerId,idempotencyKey:m.idempotencyKey})}`);
      if (!Array.isArray(a.attemptIds) || a.attemptIds.length !== a.count) throw new Error('final_reconciliation_unavailable');
      examinations += Math.max(0,a.count-1); result.duplicates.examinations = examinations;
      put('admission_once', a.count===1 && a.attemptIds?.[0]===m.attemptId); commands++;
      const c = await read(`/v1/admin/reconciliation/credentials?${new URLSearchParams({examinationId:m.attemptId})}`);
      if (!Array.isArray(c.credentialIds) || c.credentialIds.length !== c.count) throw new Error('final_reconciliation_unavailable');
      if (m.operation === 'initial:admission') { result.observed.credentialCount = c.count; result.observed.originalCredentialCount = c.count; }
      credentials += Math.max(0,c.count-1); result.duplicates.credentials = credentials;
      put('credential_once',c.count<=1); commands++;
      const certified = result.mappings.find(x=>x.operation==='certification'&&x.attemptId===m.attemptId);
      if (certified) put('certification_expected',c.count===1&&c.credentialIds?.[0]===certified.credentialId);
      else if (m.operation === 'initial:admission' && scenario.expected?.certification?.original === 'required') throw new Error('final_reconciliation_unavailable');
      else put('no_credential',c.count===0);
    }
    if (result.marketplace?.resultId) {
      const m=result.marketplace;
      const inventory=await read(`/v1/admin/reconciliation/matches?${new URLSearchParams({actor,idempotencyKey:m.idempotencyKey})}`);
      if (!Array.isArray(inventory.resultIds) || inventory.resultIds.length !== inventory.count || !Array.isArray(inventory.appearances)) throw new Error('final_reconciliation_unavailable');
      result.duplicates.matches=Math.max(0,inventory.count-1);
      result.duplicates.laneAppearances=laneDuplicates(inventory.appearances||[]);
      put('match_once',inventory.count===1&&inventory.resultIds?.[0]===m.resultId);
      put('lane_unique',result.duplicates.laneAppearances===0);commands++;
    }
    result.reconciliation={status:'CONFORMANT',measuredAt:new Date(now()).toISOString(),commands};
  } catch(e) {
    const status=e.measuredFailure?'MISMATCH':'BLOCKED';
    result.reconciliation={status,measuredAt:new Date(now()).toISOString(),commands};
    if(!['MISMATCH','HARNESS_ERROR'].includes(result.status)){result.status=status;result.reason=e.measuredFailure?'final_reconciliation_mismatch':'final_reconciliation_unavailable';}
  }
  return result;
}
module.exports={reconcile};
