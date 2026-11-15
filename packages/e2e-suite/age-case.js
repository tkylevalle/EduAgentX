'use strict';
// Additional coverage, never part of the approved fresh-cohort 100-case matrix.
// Requires a naturally aged, still-valid lifecycle credential in a retained
// deployment. No backdating, clock override, fixture authority or DB access.
const { command, digest } = require('./identity');
const DAY = 86400000;
function assess(body, credentialId, validFrom) {
  const at = Date.parse(body?.check?.at), issued = Date.parse(validFrom);
  if (!Number.isFinite(at) || !Number.isFinite(issued) || at - issued <= DAY)
    return { status:'BLOCKED', reason:'naturally_aged_credential_required' };
  if ((body.eligible || []).some(c => c.credentialId === credentialId))
    return { status:'MISMATCH', reason:'over_age_credential_eligible' };
  const rows = (body.excluded || []).filter(c => c.credentialId === credentialId);
  if (rows.length !== 1) return { status:'BLOCKED', reason:'aged_projection_unmeasured' };
  const row = rows[0], reasons = row.reasons || [];
  if (!['verification','registry','package','lifecycleOrigin'].every(s => row.sources?.[s] === 'answered') ||
      reasons.some(r => r.tag === 'trust'))
    return { status:'BLOCKED', reason:'aged_trust_preconditions_unavailable' };
  if (reasons.length !== 1 || reasons[0].code !== 'CREDENTIAL_TOO_OLD' || reasons[0].gate !== 'age' || reasons[0].tag !== 'request')
    return { status:'MISMATCH', reason:'aged_explanation_mismatch' };
  return { status:'CONFORMANT', reason:null };
}
async function run({ admin, examinationId, now=Date.now }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(examinationId || ''))
    throw new Error('invalid_examination_selector');
  const c = command(`additional-age:${examinationId}`, 'age-exclusion-v1');
  const call = (method, route, body) => admin.call(method, route, body, c.correlationId);
  const found = await call('GET', `/v1/admin/certifications/by-examination/${examinationId}`);
  const record = found.body?.credential, vc = record?.credential;
  if (found.status !== 200 || !record?.credentialId || !record?.compactJws || !vc?.validFrom ||
      !Number.isFinite(Date.parse(vc.validFrom)) || now()-Date.parse(vc.validFrom) <= DAY)
    return { status:'BLOCKED', reason:'naturally_aged_credential_required' };
  const checked = await call('POST', '/v1/credentials/verify', { jws:record.compactJws });
  if (checked.status !== 200 || checked.body?.overall !== 'VALID')
    return { status:'BLOCKED', reason:'aged_credential_not_currently_valid' };
  const root = '/v1/marketplace';
  const made = await call('POST', `${root}/capability-requests`, {
    idempotencyKey:c.idempotencyKey,request:{...require('./golden-v2').golden.cases[0].request,
      title:'issue33-additional-natural-age-exclusion-v1',maxCredentialAgeDays:1} });
  if (![200,201].includes(made.status) || !made.body?.request?.id)
    return { status:'BLOCKED', reason:'aged_request_unavailable' };
  const requestId = made.body.request.id;
  const opened = await call('POST', `${root}/capability-requests/${requestId}/open`, {version:1});
  if (opened.status !== 200) return { status:'BLOCKED', reason:'aged_request_unavailable' };
  // A fresh observation key, stable within retries, preserves immutable history.
  const key = command(`additional-age:${examinationId}`, `check:${now()}`).idempotencyKey;
  const result = await call('POST', `${root}/capability-requests/${requestId}/eligibility-checks`, {idempotencyKey:key});
  if (![200,201].includes(result.status)) return { status:'BLOCKED', reason:'aged_check_unavailable' };
  const assessment = assess(result.body, record.credentialId, vc.validFrom);
  const replay = await call('POST', `${root}/capability-requests/${requestId}/eligibility-checks`, {idempotencyKey:key});
  const original = await call('GET', `${root}/eligibility-checks/${result.body.check.checkId}`);
  const snapshot = body => ({check:body?.check,eligible:body?.eligible,excluded:body?.excluded});
  const replayEqual = replay.status === 200 && original.status === 200 &&
    digest(snapshot(result.body)) === digest(snapshot(replay.body)) && digest(snapshot(result.body)) === digest(snapshot(original.body));
  if (!replayEqual) return { status:'MISMATCH', reason:'aged_snapshot_replay' };
  return {...assessment,caseId:'additional-natural-age-exclusion-v1',examinationId,credentialId:record.credentialId,
    requestId,checkId:result.body.check.checkId,checkedAt:result.body.check.at,validFrom:vc.validFrom,
    maximumAgeDays:1,replayEqual:true,explanationDigest:digest(snapshot(result.body))};
}
module.exports={assess,run,DAY};
