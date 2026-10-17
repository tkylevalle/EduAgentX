'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateServiceHealth, getServiceHealth, updateAgentAssurance, getAgentAssurance,
        updateKPI, getAllKPIs, raiseAttention, getAttention, ingestEvent, getSnapshot } = require('../src/projections');
const { ASSURANCE_POSTURE, OPERATIONAL_HEALTH, KPI_EVIDENCE, ATTENTION_SEVERITY } = require('../src/signals');

test('healthy service returns HEALTHY', () => {
  updateServiceHealth('api-gateway', 'ok', { latencyMs: 12 });
  const h = getServiceHealth('api-gateway');
  assert.strictEqual(h.health, OPERATIONAL_HEALTH.HEALTHY);
  assert.strictEqual(h.stale, false);
});

test('unknown service returns UNKNOWN', () => {
  const h = getServiceHealth('nonexistent-service');
  assert.strictEqual(h.health, OPERATIONAL_HEALTH.UNKNOWN);
});

test('unhealthy service returns UNHEALTHY', () => {
  updateServiceHealth('broken-service', 'error');
  const h = getServiceHealth('broken-service');
  assert.strictEqual(h.health, OPERATIONAL_HEALTH.UNHEALTHY);
});

test('credential issued event sets VERIFIED posture', () => {
  ingestEvent({ type: 'credential.issued', agentId: 'agent-001', certificationId: 'cert-001' });
  const a = getAgentAssurance('agent-001');
  assert.strictEqual(a.assurancePosture, ASSURANCE_POSTURE.VERIFIED);
  assert.strictEqual(a.certificationId, 'cert-001');
});

test('credential suspended event sets SUSPENDED posture', () => {
  ingestEvent({ type: 'credential.suspended', agentId: 'agent-002' });
  const a = getAgentAssurance('agent-002');
  assert.strictEqual(a.assurancePosture, ASSURANCE_POSTURE.SUSPENDED);
});

test('credential revoked event sets REVOKED posture', () => {
  ingestEvent({ type: 'credential.revoked', agentId: 'agent-003' });
  const a = getAgentAssurance('agent-003');
  assert.strictEqual(a.assurancePosture, ASSURANCE_POSTURE.REVOKED);
});

test('KPI met when value >= target', () => {
  updateKPI('grading', 0.85, 0.80, 'score');
  const kpis = getAllKPIs();
  assert.strictEqual(kpis.grading.evidence, KPI_EVIDENCE.MET);
});

test('KPI not met when value < target', () => {
  updateKPI('training', 0.60, 0.80, 'score');
  const kpis = getAllKPIs();
  assert.strictEqual(kpis.training.evidence, KPI_EVIDENCE.NOT_MET);
});

test('unmeasured domain returns UNMEASURED', () => {
  const kpis = getAllKPIs();
  assert.strictEqual(kpis.cost.evidence, KPI_EVIDENCE.UNMEASURED);
});

test('all 9 signal domains present in KPI snapshot', () => {
  const kpis = getAllKPIs();
  const domains = ['registration', 'curriculum', 'training', 'examination', 'certification', 'grading', 'operations', 'provider', 'cost'];
  for (const d of domains) assert.ok(d in kpis, `missing domain: ${d}`);
});

test('attention records deduplicated by scope+reason+severity', () => {
  const before = getAttention().length;
  raiseAttention({ severity: ATTENTION_SEVERITY.WARNING, scope: 'grading', reason: 'high_latency', safeState: 'continue', owner: 'team', nextAction: 'check logs' });
  raiseAttention({ severity: ATTENTION_SEVERITY.WARNING, scope: 'grading', reason: 'high_latency', safeState: 'continue', owner: 'team', nextAction: 'check logs' });
  const after = getAttention().length;
  assert.strictEqual(after, before + 1); // only one added
});

test('attention record has all required fields', () => {
  raiseAttention({ severity: ATTENTION_SEVERITY.CRITICAL, scope: 'certification', reason: 'service_down', safeState: 'halt_issuance', owner: 'raniya', nextAction: 'restart service', evidenceLink: '/logs/cert-001' });
  const records = getAttention();
  const record = records.find(r => r.scope === 'certification' && r.reason === 'service_down');
  for (const f of ['id', 'severity', 'scope', 'time', 'freshness', 'reason', 'safeState', 'owner', 'nextAction', 'evidenceLink']) {
    assert.ok(f in record, `missing field: ${f}`);
  }
});

test('assurance posture, operational health, KPI evidence stay separate in snapshot', () => {
  const snap = getSnapshot();
  assert.ok('assurancePosture' in snap);
  assert.ok('operationalHealth' in snap);
  assert.ok('kpiEvidence' in snap);
  assert.ok('attention' in snap);
  // They must be separate objects, never merged
  assert.notDeepEqual(snap.assurancePosture, snap.operationalHealth);
});

test('critical event auto-raises attention', () => {
  const before = getAttention().length;
  ingestEvent({ type: 'service.down', serviceId: 'exam-engine', severity: ATTENTION_SEVERITY.CRITICAL, reason: 'oom_killed', safeState: 'halt_exams', owner: 'neeraj', nextAction: 'restart container' });
  const after = getAttention().length;
  assert.ok(after > before);
});
