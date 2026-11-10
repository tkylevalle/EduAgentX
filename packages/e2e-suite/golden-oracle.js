'use strict';
// Independent arithmetic and state ledger from the published MATCH-POLICY-1.0.0
// specification. No production matching/eligibility imports, no match result input.
const { facts } = require('./golden-v2');
const { digest } = require('./identity');
const DAY = 86400000;
const codeOrder = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function expected(request, ledger, at) {
  if (!Number.isFinite(Date.parse(at))) throw new Error('authoritative_match_time_required');
  const all = ledger.map(c => {
    const reasons = [];
    // Current HTTP verifier adapter maps an INVALID overall report with passing
    // signature/schema parts to schema=invalid. Suspension/revocation therefore
    // have this additional fail-closed code (clients.js:toSignatureAndSchema).
    // Model that observable contract explicitly; do not loosen the exact check.
    if (c.status !== 'active') reasons.push('SCHEMA_INVALID', c.status === 'suspended' ? 'STATUS_SUSPENDED' : 'STATUS_REVOKED');
    if (c.discoverable !== true) reasons.push('NOT_DISCOVERABLE');
    if (c.fingerprintCurrent === false) reasons.push('FINGERPRINT_MISMATCH');
    if (request.requiredEnvironment !== facts.environment) reasons.push('ENVIRONMENT_MISMATCH');
    const age = (Date.parse(at)-Date.parse(c.issuedAt))/DAY;
    if (age < 0 || Date.parse(at) >= Date.parse(c.validUntil)) throw new Error('fresh_credential_precondition');
    const missing = request.requiredObjectiveIds.filter(o=>!facts.objectiveIds.includes(o));
    const gapCodes = missing.map(()=> 'OBJECTIVE_MISSING');
    const totalGap = Math.max(0,request.minOverallPercent-facts.overallPercent)/request.minOverallPercent;
    const advGap = Math.max(0,request.minAdversarialPercent-facts.adversarialPercent)/request.minAdversarialPercent;
    const ageGap = Math.min(1,Math.max(0,age-request.maxCredentialAgeDays)/request.maxCredentialAgeDays);
    const modeGap = request.allowedAssessmentModes.includes(facts.assessmentMode)?0:1;
    if (totalGap) gapCodes.push('SCORE_OVERALL_BELOW');
    if (advGap) gapCodes.push('SCORE_ADVERSARIAL_BELOW');
    if (ageGap) gapCodes.push('CREDENTIAL_TOO_OLD');
    if (modeGap) gapCodes.push('MODE_NOT_ALLOWED');
    // Hard trust failure excludes BOTH lanes, but the public contract reports
    // every failed gate, including simultaneous request shortfalls. Do not
    // truncate its explanation at the first category of failure. A missing
    // objective contributes one exclusion reason (multiple detailed gaps below).
    if (reasons.length) return { ...c, lane: 'excluded', reasons: [...reasons, ...new Set(gapCodes)] };
    const gaps = [...missing].sort(codeOrder).map(objectiveId=>({code:'OBJECTIVE_MISSING',objectiveId}));
    if(totalGap)gaps.push({code:'SCORE_OVERALL_BELOW',actual:facts.overallPercent,required:request.minOverallPercent});
    if(advGap)gaps.push({code:'SCORE_ADVERSARIAL_BELOW',actual:facts.adversarialPercent,required:request.minAdversarialPercent});
    if(ageGap)gaps.push({code:'CREDENTIAL_TOO_OLD',actualDays:age,maximumDays:request.maxCredentialAgeDays});
    if(modeGap)gaps.push({code:'MODE_NOT_ALLOWED',actual:facts.assessmentMode,allowed:[...request.allowedAssessmentModes]});
    const requestGates={objectives:'OBJECTIVE_MISSING',score_overall:'SCORE_OVERALL_BELOW',score_adversarial:'SCORE_ADVERSARIAL_BELOW',age:'CREDENTIAL_TOO_OLD',mode:'MODE_NOT_ALLOWED'};
    const satisfiedRequirements=['lifecycle_origin','discoverable','signature','schema','status','expiry','fingerprint','environment','domain',
      ...Object.keys(requestGates).filter(g=>!gapCodes.includes(requestGates[g]))];
    const preferences = request.preferredObjectiveIds || [];
    const points = { totalPerformance: 33.04, adversarialPerformance: 30.1,
      preferredCoverage: preferences.length ? 20*preferences.filter(o=>facts.objectiveIds.includes(o)).length/preferences.length : 20,
      credentialRecency: 10*Math.max(0,1-age/request.maxCredentialAgeDays) };
    const sum = Object.values(points).reduce((a,b)=>a+b,0);
    return { ...c, lane: gapCodes.length?'near':'eligible', points, matchScore: Math.round((sum+Number.EPSILON)*100)/100,
      gapCount: gapCodes.length, normalizedShortfall: (missing.length/request.requiredObjectiveIds.length+totalGap+advGap+ageGap+modeGap)/5,
      reasons: gapCodes, gaps, satisfiedRequirements, ageDays: age, maximumAgeDays: request.maxCredentialAgeDays,
      coveredObjectives: preferences.filter(o=>facts.objectiveIds.includes(o)).sort(codeOrder), requestedPreferences: [...preferences].sort(codeOrder),
      shortfallComponents: { objectives: missing.length/request.requiredObjectiveIds.length, overall: totalGap, adversarial: advGap, age: ageGap, mode: modeGap } };
  });
  const compare = (a,b,near) => (near ? a.gapCount-b.gapCount || a.normalizedShortfall-b.normalizedShortfall : 0) ||
    b.matchScore-a.matchScore || Date.parse(b.issuedAt)-Date.parse(a.issuedAt) || codeOrder(a.agentLearnerKey,b.agentLearnerKey) ||
    codeOrder(a.credentialId,b.credentialId);
  const chosen = new Set();
  function lane(name,limit) {
    return all.filter(c=>c.lane===name).sort((a,b)=>compare(a,b,name==='near')).filter(c=>{
      if(chosen.has(c.agentLearnerKey)){c.lane='excluded';c.reasons=['OTHER_CREDENTIAL_SELECTED'];return false;}
      chosen.add(c.agentLearnerKey);return true;
    }).map((c,i,array)=>{
      const next=array[i+1],criteria=name==='near'?['gapCount','normalizedShortfall','matchScore','issuedAt','agentLearnerKey']:['matchScore','issuedAt','agentLearnerKey'];
      const decisive=next&&criteria.find(k=>c[k]!==next[k]);
      return {...c,rank:i+1,decisiveCriterion:decisive||'only_or_last_candidate',comparedWith:next?.agentLearnerKey||null,
        criteria: criteria.map(field=>({field,direction:['gapCount','normalizedShortfall','agentLearnerKey'].includes(field)?'asc':'desc'})),
        tiedCriteria: decisive ? criteria.slice(0,criteria.indexOf(decisive)) : []};
    }).slice(0,limit);
  }
  const eligible=lane('eligible',5),near=lane('near',3);
  return { eligible,near,exclusions:all.filter(c=>c.lane==='excluded'),
    totalEligible:all.filter(c=>c.lane==='eligible').length,totalNearMatches:all.filter(c=>c.lane==='near').length };
}
function compare(result, prediction) {
  const errors=[];
  const eq=(ok,name)=>{if(!ok)errors.push(name);};
  eq(result?.policyVersion==='MATCH-POLICY-1.0.0','policy');
  eq(result?.totalEligible===prediction.totalEligible,'eligible_total');
  eq(result?.totalNearMatches===prediction.totalNearMatches,'near_total');
  for(const [key,name] of [['eligibleMatches','eligible'],['nearMatches','near']]){
    const actual=result?.[key]||[],wanted=prediction[name];
    eq(actual.length===wanted.length,`${name}_length`);
    for(let n=0;n<wanted.length;n++){
      const a=actual[n],e=wanted[n];
      eq(a?.agentLearnerKey===e.agentLearnerKey&&a?.credentialId===e.credentialId,`${name}_membership_${n}`);
      eq(a?.matchScore===e.matchScore,`${name}_score_${n}`);
      eq(a?.rank===e.rank&&a?.ordering?.decisiveCriterion===e.decisiveCriterion&&a?.ordering?.comparedWith===e.comparedWith,`${name}_order_${n}`);
      for(const [part,points] of Object.entries(e.points))eq(Math.abs(a?.components?.[part]?.points-points)<1e-9,`${name}_${part}_${n}`);
      eq(JSON.stringify(a?.ordering?.criteria)===JSON.stringify(e.criteria)&&JSON.stringify(a?.ordering?.tiedCriteria)===JSON.stringify(e.tiedCriteria),`${name}_order_explanation_${n}`);
      eq(a?.gapCount===e.gapCount&&Math.abs(a?.normalizedShortfall-e.normalizedShortfall)<1e-12&&a?.shortfallDivisor===5,`${name}_shortfall_${n}`);
      eq(Object.entries(e.shortfallComponents).every(([k,v])=>Math.abs(a?.shortfallComponents?.[k]-v)<1e-12),`${name}_shortfall_components_${n}`);
      eq(a?.components?.totalPerformance?.actual===facts.overallPercent&&a?.components?.totalPerformance?.weight===35&&a?.components?.totalPerformance?.denominator===100,`${name}_overall_component_${n}`);
      eq(a?.components?.adversarialPerformance?.actual===facts.adversarialPercent&&a?.components?.adversarialPerformance?.weight===35&&a?.components?.adversarialPerformance?.denominator===100,`${name}_adversarial_component_${n}`);
      eq(a?.components?.preferredCoverage?.weight===20&&a?.components?.credentialRecency?.weight===10,`${name}_component_weights_${n}`);
      eq(JSON.stringify(a?.components?.preferredCoverage?.coveredObjectiveIds)===JSON.stringify(e.coveredObjectives)&&JSON.stringify(a?.components?.preferredCoverage?.requestedObjectiveIds)===JSON.stringify(e.requestedPreferences),`${name}_preferred_component_${n}`);
      eq(Math.abs(a?.components?.credentialRecency?.ageDays-e.ageDays)<1e-12&&a?.components?.credentialRecency?.maximumAgeDays===e.maximumAgeDays,`${name}_age_component_${n}`);
      if(e.configurationFingerprint)eq(a?.evidence?.configurationFingerprint===e.configurationFingerprint,`${name}_fingerprint_evidence_${n}`);
      eq(a?.evidence?.assessmentMode==='standard'&&a?.evidence?.credentialStatus==='active',`${name}_credential_evidence_${n}`);
      const requestGates={objectives:'OBJECTIVE_MISSING',score_overall:'SCORE_OVERALL_BELOW',score_adversarial:'SCORE_ADVERSARIAL_BELOW',age:'CREDENTIAL_TOO_OLD',mode:'MODE_NOT_ALLOWED'};
      eq(Object.entries(requestGates).every(([gate,code])=>(a?.checks||[]).filter(c=>c.tag==='request'&&c.gate===gate&&c.passed===!e.reasons.includes(code)).length===1),`${name}_request_gates_${n}`);
      eq(a?.evidence?.environment==='simulation'&&a?.evidence?.evidenceMode==='synthetic',`${name}_provenance_${n}`);
      const gates=['lifecycle_origin','discoverable','signature','schema','status','expiry','fingerprint','environment','domain','identity','evidence_mode'];
      eq(gates.every(g=>(a?.checks||[]).filter(c=>c.tag==='trust'&&c.gate===g&&c.passed===true).length===1),`${name}_trust_${n}`);
      eq(['verification','registry','package','lifecycleOrigin'].every(k=>a?.sources?.[k]==='answered'),`${name}_sources_${n}`);
      eq(e.reasons.length===(a?.gaps||[]).length&&e.reasons.every(c=>(a?.gaps||[]).some(g=>g.code===c)),`${name}_gaps_${n}`);
      eq(digest(a?.gaps||null)===digest(e.gaps),`${name}_gap_details_${n}`);
      eq(digest(a?.satisfiedRequirements||null)===digest(e.satisfiedRequirements),`${name}_satisfied_requirements_${n}`);
      eq(name==='eligible'?a?.eligible===true&&a?.lane==='Eligible Matches':a?.eligible===false&&a?.lane==='Not Eligible',`${name}_lane_${n}`);
    }
  }
  const ex=result?.exclusions||[];
  eq(ex.length===prediction.exclusions.length,'exclusion_count');
  for(const e of prediction.exclusions){const a=ex.find(x=>x.credentialId===e.credentialId&&x.agentLearnerKey===e.agentLearnerKey);
    eq(!!a&&JSON.stringify(a.reasons.map(r=>r.code).sort())===JSON.stringify([...e.reasons].sort()),'exclusion_reason');}
  const ids=[...(result?.eligibleMatches||[]),...(result?.nearMatches||[])].map(c=>c.agentLearnerKey);
  eq(ids.length===new Set(ids).size,'duplicate_lane');
  return {status:errors.length?'MISMATCH':'CONFORMANT',errors:[...new Set(errors)]};
}
function assess(request, ledger, result) {
  const blocked = (result?.exclusions || []).filter(c => c.reasons?.some(r => /^[A-Z_]+_UNCHECKABLE$/.test(r.code)));
  const baseline = compare(result, expected(request, ledger, result.generatedAt));
  if (!blocked.length) return baseline;
  if (blocked.some(c => !ledger.some(row => row.credentialId === c.credentialId && row.agentLearnerKey === c.agentLearnerKey)))
    return {status:'MISMATCH',errors:['unknown_candidate']};
  const unavailable = new Set(blocked.map(c => c.credentialId));
  // An outage cannot conceal a wrong score, unsafe inclusion, bad explanation,
  // duplicate or incorrect rank among the still-observable candidates.
  const observable = compare({...result,exclusions:result.exclusions.filter(c=>!unavailable.has(c.credentialId))},
    expected(request,ledger.filter(c=>!unavailable.has(c.credentialId)),result.generatedAt));
  if (observable.status !== 'CONFORMANT') return observable;
  return {status:'BLOCKED',errors:[],reason:'trust_sources_uncheckable',blockedCodes:[...new Set(blocked.flatMap(c=>
    c.reasons.map(r=>r.code).filter(code=>/^[A-Z_]+_UNCHECKABLE$/.test(code))))]};
}
module.exports={expected,compare,assess};
