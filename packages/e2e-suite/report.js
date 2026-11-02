'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { manifest, manifestHash } = require('./manifest');
const { digest } = require('./identity');
const { golden, goldenHash } = require('./marketplace');
const { summarizeInvariants, safety } = require('./invariants');
const STATUSES = ['CONFORMANT', 'MISMATCH', 'BLOCKED', 'UNMEASURED', 'HARNESS_ERROR'];
const BLOCKERS = Object.freeze([
  'marketplace_lifecycle_origin_unavailable', 'signed_environment_evidence_labels_missing',
  'marketplace_high_fanout_unmeasured', 'skill_gap_superseded_deprecated_policy', 'separate_grading_kpi_red',
]);
const safeText = v => typeof v === 'string' && /^[\x20-\x7e]{1,256}$/.test(v) &&
  !/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.|BEGIN .*KEY|postgres(?:ql)?:\/\//.test(v) ? v : null;
const safeCode = v => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v) ? v : null;
const number = v => Number.isFinite(v) && v >= 0 ? v : null;
function safeScenario(r) {
  return { scenarioId: safeCode(r.scenarioId), category: safeCode(r.category), variant: safeCode(r.variant),
    status: STATUSES.includes(r.status) ? r.status : 'HARNESS_ERROR',
    lifecycleStatus: STATUSES.includes(r.lifecycleStatus) ? r.lifecycleStatus : 'UNMEASURED',
    reason: safeCode(r.reason), startedAt: safeText(r.startedAt), finishedAt: safeText(r.finishedAt),
    checks: (r.checks || []).map(c => ({ id: safeCode(c.id), passed: [true, false, null].includes(c.passed) ? c.passed : null, reason: safeCode(c.reason) })),
    mappings: (r.mappings || []).map(m => Object.fromEntries(['operation', 'attemptId', 'sessionId', 'credentialId', 'requestId', 'resultId', 'idempotencyKey']
      .filter(k => m[k] !== undefined).map(k => [k, safeText(m[k])]))),
    observed: { status: safeCode(r.observed?.status), criticalRuleIds: Array.isArray(r.observed?.criticalRuleIds) ? r.observed.criticalRuleIds.map(safeCode) : null,
      safetyDetected: typeof r.observed?.safetyDetected === 'boolean' ? r.observed.safetyDetected : null,
      credentialCount: number(r.observed?.credentialCount) },
    duplicates: Object.fromEntries(['examinations', 'credentials', 'matches', 'laneAppearances'].map(k => [k, number(r.duplicates?.[k])])),
    marketplace: r.marketplace ? safeMarket(r.marketplace) : null,
  };
}
function safeMarket(m) {
  return { caseId: safeCode(m.caseId), status: STATUSES.includes(m.status) ? m.status : 'UNMEASURED', reason: safeCode(m.reason),
    requestId: safeText(m.requestId), resultId: safeText(m.resultId), idempotencyKey: safeText(m.idempotencyKey),
    durationMs: number(m.durationMs), observedCandidates: number(m.observedCandidates),
    observationDurationMs: number(m.observationDurationMs),
    blockedCodes: (m.blockedCodes || []).map(safeCode), matchCount: number(m.matchCount), laneDuplicates: number(m.laneDuplicates),
    replayEqual: typeof m.replayEqual === 'boolean' ? m.replayEqual : null };
}
function latencyStats(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { count: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) ?? null };
}
function validateAccounting(selected, results, mode) {
  const definitions = new Map(manifest.scenarios.map(s => [s.id, s]));
  const allowed = new Set(selected.map(s => s.id)), seen = new Set();
  if (allowed.size !== selected.length || selected.some(s => !definitions.has(s.id) || digest(s) !== digest(definitions.get(s.id))) ||
    (mode === 'formal' && (selected.length !== 1000 || selected.some((s, i) => s.id !== manifest.scenarios[i].id))))
    throw new Error('invalid_frozen_selection');
  for (const r of results) {
    const definition = selected.find(s => s.id === r.scenarioId);
    if (!allowed.has(r.scenarioId) || seen.has(r.scenarioId) || !STATUSES.includes(r.status) ||
      r.category !== definition.category || r.variant !== definition.variant) throw new Error('invalid_scenario_accounting');
    if ((r.lifecycleStatus === 'CONFORMANT' && r.observed?.status !== definition.expected.examination.status) ||
      (r.status === 'CONFORMANT' && (r.lifecycleStatus !== 'CONFORMANT' ||
        (definition.expected.marketplace !== 'not_applicable' && r.marketplace?.status !== 'CONFORMANT'))))
      throw new Error('contradictory_scenario_accounting');
    seen.add(r.scenarioId);
  }
}
function buildReport({ mode, selected, results = [], environment = {}, source = {}, startedAt, finishedAt = new Date().toISOString(),
  latencies = [], blockers = [], notRun = [], runErrors = [], reproduction = 'python3 scripts/run-sprint5.py --mode developer' }) {
  validateAccounting(selected, results, mode);
  const safe = results.map(safeScenario), counts = Object.fromEntries(STATUSES.map(s => [s, safe.filter(r => r.status === s).length]));
  counts.UNMEASURED += selected.length - safe.length;
  const invariants = summarizeInvariants(selected, safe);
  const duplicates = Object.fromEntries(['examinations', 'credentials', 'matches', 'laneAppearances'].map(k => {
    const observations = safe.map(r => r.duplicates[k]).filter(v => v !== null);
    return [k, { measuredScenarios: observations.length, count: observations.length ? observations.reduce((a, b) => a + b, 0) : null }];
  }));
  const safetyCases = selected.map(s => safety(s, safe.find(r => r.scenarioId === s.id)?.observed || {})).filter(s => s.applicable);
  const byId = new Map(safe.map(r => [r.scenarioId, r]));
  const countMeasured = value => Number.isInteger(value) && value >= 0;
  const duplicateMeasurementsComplete = selected.every(s => {
    const d = byId.get(s.id)?.duplicates;
    return d && countMeasured(d.examinations) && countMeasured(d.credentials) &&
      (s.expected.marketplace === 'not_applicable' || (countMeasured(d.matches) && countMeasured(d.laneAppearances)));
  });
  const safetyMeasurementsComplete = safetyCases.every(s => s.measured);
  const marketplace = safe.map(r => r.marketplace).filter(Boolean);
  const marketLatency = latencyStats(marketplace.map(m => m.durationMs));
  const declaredCases = new Set(golden.cases.map(c => c.id));
  const marketComplete = new Set(marketplace.filter(m => m.status === 'CONFORMANT' && declaredCases.has(m.caseId)).map(m => m.caseId)).size >= 100 &&
    new Set(marketplace.map(m => m.requestId).filter(Boolean)).size >= 100 &&
    marketplace.length >= 100 && marketplace.every(m => m.status === 'CONFORMANT' && m.requestId && m.resultId && m.idempotencyKey &&
      m.observedCandidates >= 1000 && m.matchCount === 1 && m.laneDuplicates === 0 && m.replayEqual === true) &&
    marketLatency.p95Ms !== null && marketLatency.p95Ms <= 30000;
  const sha256 = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
  const provenanceComplete = /^[0-9a-f]{40}$/.test(source.gitSha || '') && typeof source.dirty === 'boolean' && sha256(source.fingerprint) &&
    sha256(environment.configHash) && sha256(environment.imageHash) && safeText(environment.project) && safeText(environment.node) &&
    safeText(environment.platform) && Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(finishedAt)) &&
    Date.parse(finishedAt) >= Date.parse(startedAt) && Number.isInteger(environment.responseDeadlineMinutes) && environment.responseDeadlineMinutes > 0;
  const complete = mode === 'formal' && environment.seam === 'public_compose' && selected.length === 1000 && safe.length === 1000 && counts.UNMEASURED === 0 &&
    counts.BLOCKED === 0 && counts.HARNESS_ERROR === 0 && invariants.complete && marketComplete && duplicateMeasurementsComplete &&
    safetyMeasurementsComplete && provenanceComplete && environment.responseDeadlineMinutes === 60 &&
    notRun.length === 0 && blockers.length === 0 && runErrors.length === 0;
  const rate = mode === 'formal' && safe.length === 1000 ? counts.CONFORMANT / 1000 : null;
  const falsePasses = safetyCases.filter(s => s.falsePass).length;
  const violated = !invariants.held || safe.some(r => r.checks.some(c => c.passed === false)) ||
    falsePasses > 0 || Object.values(duplicates).some(d => d.count > 0) || counts.HARNESS_ERROR > 0 ||
    runErrors.some(e => e.status === 'HARNESS_ERROR' || e.status === 'MISMATCH');
  const technical = violated ? 'FAIL' : !complete ? 'BLOCKED' : rate >= .9 ? 'PASS' : 'FAIL';
  const profileDistribution = Object.fromEntries(Object.keys(manifest.categories).map(c => [c, selected.filter(s => s.category === c).length]));
  const reasons = {};
  for (const r of safe) if (r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  return { schemaVersion: 'issue-33-verification/1.0.0', mode,
    label: mode === 'formal' ? 'FORMAL ISSUE #33 EVALUATION' : 'NOT FORMAL ISSUE #33 ACCEPTANCE',
    source: { gitSha: safeText(source.gitSha), dirty: typeof source.dirty === 'boolean' ? source.dirty : null, fingerprint: safeText(source.fingerprint) },
    environment: Object.fromEntries(['project', 'node', 'platform', 'configHash', 'imageHash', 'responseDeadlineMinutes', 'seam']
      .filter(k => environment[k] !== undefined).map(k => [k, typeof environment[k] === 'number' ? number(environment[k]) : safeText(environment[k])])),
    dataset: { version: manifest.version, seed: manifest.seed, hash: manifestHash, formalPlanned: 1000, selected: selected.length,
      profileDistribution, formalProfileDistribution: Object.fromEntries(Object.keys(manifest.categories).map(c => [c, 200])) },
    startedAt, finishedAt, executed: safe.length, counts, observedExactRate: selected.length ? counts.CONFORMANT / selected.length : null,
    lifecycleConformant: safe.filter(r => r.lifecycleStatus === 'CONFORMANT').length,
    formalExactOutcomeRate: rate, acceptanceFloor: { threshold: .9, result: rate === null ? 'NOT_RUN' : rate >= .9 ? 'MET' : 'MISSED' },
    target95: { threshold: .95, result: rate === null ? 'NOT_RUN' : rate >= .95 ? 'MET' : 'MISSED' },
    requiredMeasurementsComplete: complete, measurementCompleteness: { duplicates: duplicateMeasurementsComplete,
      mandatorySafety: safetyMeasurementsComplete, provenance: Boolean(provenanceComplete) }, invariants, duplicates,
    mandatorySafetyCases: safetyCases.length, mandatorySafetyMeasured: safetyCases.filter(s => s.measured).length,
    mandatorySafetyFalsePasses: falsePasses,
    marketplace: { datasetHash: goldenHash, plannedCases: 100, minimumAgents: 1000, minimumRequests: 100,
      observations: marketplace.length, conformant: marketplace.filter(m => m.status === 'CONFORMANT').length,
      blocked: marketplace.filter(m => m.status === 'BLOCKED').length,
      declaredCasesObserved: new Set(marketplace.filter(m => declaredCases.has(m.caseId)).map(m => m.caseId)).size,
      declaredCasesBlocked: new Set(marketplace.filter(m => declaredCases.has(m.caseId) && m.status === 'BLOCKED').map(m => m.caseId)).size,
      unmeasuredGoldenCases: 100 - new Set(marketplace.filter(m => declaredCases.has(m.caseId)).map(m => m.caseId)).size,
      requiredGatesComplete: marketComplete, latency: marketLatency, latencyScope: 'fresh_match_command_including_client_pacing_excluding_replay', floorMs: 30000, targetMs: 10000 },
    latency: { ...latencyStats(latencies.map(l => l.durationMs)), scope: 'all_public_calls_including_client_authentication_pacing_and_retries' }, failuresByReason: reasons,
    runErrors: runErrors.map(e => ({ status: STATUSES.includes(e.status) ? e.status : 'HARNESS_ERROR', reason: safeCode(e.reason) })),
    notRun: notRun.map(safeCode), knownLimitations: [...BLOCKERS], knownBlockers: [...new Set(blockers.map(safeCode))],
    technicalChecks: technical, formalAcceptance: mode !== 'formal' ? 'NOT_RUN' : technical,
    releaseGate: 'NOT_EVALUATED', reproduction, results: safe };
}
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderHTML(report) {
  const e = value => escapeHtml(String(value));
  const table = (headings, rows) => `<table><thead><tr>${headings.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr>${row.map(value => `<td>${e(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Issue 33 evaluation</title>
<style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#17212b}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{text-align:left;border:1px solid #ccd5dd;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:26px}code{overflow-wrap:anywhere}</style>
<h1>${e(report.label)}</h1><p>Technical checks: <strong>${e(report.technicalChecks)}</strong> · Formal acceptance: ${e(report.formalAcceptance)} · Release: ${e(report.releaseGate)}</p>
<p>Source <code>${e(report.source.gitSha)}</code> · Dirty source: ${e(report.source.dirty)}<br>Dataset ${e(report.dataset.version)} · Seed ${e(report.dataset.seed)}<br>${e(report.startedAt)} — ${e(report.finishedAt)}</p>
<h2>Scenario accounting</h2>${table(['Selected', 'Executed', 'Lifecycle conformant', ...STATUSES], [[report.dataset.selected, report.executed, report.lifecycleConformant, ...STATUSES.map(s => report.counts[s])]])}
<p>Formal exact rate: ${e(report.formalExactOutcomeRate ?? 'NOT_RUN')} · 90% Floor: ${e(report.acceptanceFloor.result)} · 95% Target: ${e(report.target95.result)}</p>
<h2>Independent invariants</h2>${table(['Group', 'Passed', 'Failed', 'Unmeasured'], Object.entries(report.invariants.groups).map(([group, values]) => [group, values.passed, values.failed, values.unmeasured]))}
<h2>Safety and duplicates</h2><p>Mandatory safety cases: ${report.mandatorySafetyCases}; measured: ${report.mandatorySafetyMeasured}; false passes: ${report.mandatorySafetyFalsePasses}. Unmeasured evidence is not a pass.</p>
${table(['Duplicate category', 'Measured scenarios', 'Observed duplicates'], Object.entries(report.duplicates).map(([key, value]) => [key, value.measuredScenarios, value.count ?? 'UNMEASURED']))}
<h2>Marketplace</h2><p>Public observations: ${report.marketplace.observations}; blocked: ${report.marketplace.blocked}; formal golden cases unmeasured: ${report.marketplace.unmeasuredGoldenCases}/100. Required full-cohort gates complete: ${e(report.marketplace.requiredGatesComplete)}.</p>
<h2>Blockers / limitations</h2><ul>${[...report.knownBlockers, ...report.knownLimitations, ...report.notRun].map(reason => `<li>${e(reason)}</li>`).join('')}</ul>
<h2>Reproduce</h2><pre>${e(report.reproduction)}</pre><details><summary>Complete machine-readable record</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details></html>\n`;
}
function writeEvidence(directory, report) {
  if (fs.existsSync(path.join(directory, 'report.json'))) throw new Error('evidence_directory_already_used');
  fs.mkdirSync(path.join(directory, 'logs'), { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(directory, name), data);
  write('report.json', JSON.stringify(report, null, 2) + '\n');
  write('report.html', renderHTML(report));
  write('scenarios.jsonl', report.results.map(r => JSON.stringify(r)).join('\n') + '\n');
  write('marketplace.jsonl', report.results.filter(r => r.marketplace).map(r => JSON.stringify(r.marketplace)).join('\n') + '\n');
  write('latency.json', JSON.stringify({ publicRequests: report.latency, marketplace: report.marketplace.latency }, null, 2) + '\n');
  write('failures.json', JSON.stringify({ grouped: report.failuresByReason, blockers: report.knownBlockers, notRun: report.notRun }, null, 2) + '\n');
  const files = fs.readdirSync(directory).filter(n => n !== 'artifact-manifest.json' && fs.statSync(path.join(directory, n)).isFile());
  const artifacts = Object.fromEntries(files.sort().map(n => [n, createHash('sha256').update(fs.readFileSync(path.join(directory, n))).digest('hex')]));
  write('artifact-manifest.json', JSON.stringify({ schemaVersion: '1.0.0', artifacts }, null, 2) + '\n');
}
module.exports = { STATUSES, BLOCKERS, safeScenario, safeMarket, latencyStats, validateAccounting, buildReport, writeEvidence };
