'use strict';
const NOW = '2026-10-30T08:00:00.000Z';
const PKG = { id: 'pkg-ai-safety', version: '1.0.0', digest: 'sha256:package' };
const input = (type = 'examination') => ({ source: { type, id: type === 'examination' ? 'attempt-1' : 'match-1' }, agentLearnerKey: 'learner-1' });
const pkg = () => ({ packageId: PKG.id, version: PKG.version, digest: PKG.digest, state: 'Active',
  manifest: { domain: 'AI Agent Safety and Secure Tool Use' }, certificationBlocked: false, quarantinedScopes: [],
  objectives: [{ id: 'o1' }, { id: 'o2' }] });
const trace = () => ({ failure: { attemptId: 'attempt-1', status: 'agent_failed',
  template: { id: 'template', version: '1.0.0', digest: 'sha256:template' }, rubric: { id: 'rubric', version: '1.0.0', digest: 'sha256:rubric' } },
  remediation: { event: { eventId: 'examination.remediation.required:attempt-1', eventType: 'examination.remediation.required',
    schemaVersion: '1.0.0', attemptId: 'attempt-1', agentLearnerKey: 'learner-1', package: { ...PKG },
    gap: { objectiveIds: ['o2'], criticalViolationRuleIds: ['unsafe-tool'] },
    failure: { failureReasons: ['critical_violation'], terminalEventId: 'terminal-1', evidenceDigest: `sha256:${'a'.repeat(64)}` },
    occurredAt: NOW, evidence: { mode: 'synthetic', environment: 'simulation' } }, delivery: null } });
const match = () => ({ resultId: 'match-1', policyVersion: 'MATCH-POLICY-1.0.0', outcome: 'MATCHED', generatedAt: NOW,
  requestId: 'request-1', requestVersion: 1, requestDigest: 'sha256:request', eligibleMatches: [],
  nearMatches: [{ agentLearnerKey: 'learner-1', eligible: false, lane: 'Not Eligible',
    gaps: [{ code: 'OBJECTIVE_MISSING', objectiveId: 'o2' }, { code: 'SCORE_OVERALL_BELOW', actual: 70, required: 85 }],
    checks: ['lifecycle_origin','discoverable','signature','schema','status','expiry','fingerprint','environment','domain','identity','evidence_mode']
      .map(gate => ({ gate, tag: 'trust', passed: true })),
    evidence: { package: { ...PKG }, evidenceMode: 'synthetic', environment: 'simulation' } }] });
module.exports = { NOW, PKG, input, pkg, trace, match };
