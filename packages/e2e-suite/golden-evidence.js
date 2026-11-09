'use strict';
const { golden, goldenHash } = require('./golden-v2');
const { hash: cohortHash } = require('./cohort');
function complete(evidence, source) {
  const rows = evidence?.results || [], ids = new Set(rows.map(r => r.caseId));
  return evidence?.schemaVersion === 'issue-33-golden-execution/2.0.0' && evidence.mode === 'golden' &&
    evidence.status === 'PASS' && evidence.formalGoldenRequirementsMeasured === true && evidence.finalReconciliationComplete === true &&
    evidence.reconciledMatchCommands >= 100 && evidence.matchDuplicateCount === 0 &&
    evidence.datasetHash === goldenHash && evidence.cohortHash === cohortHash && evidence.measuredAgents === 1000 &&
    evidence.source?.gitSha === source.gitSha && evidence.source?.fingerprint === source.fingerprint &&
    rows.length === 100 && ids.size === 100 && golden.cases.every(c => ids.has(c.id)) &&
    new Set(rows.map(r => r.requestId)).size === 100 && new Set(rows.map(r => r.resultId)).size === 100 &&
    rows.every(r => r.status === 'CONFORMANT' && r.requestId && r.resultId && r.idempotencyKey &&
      r.observedCandidates >= 1000 && r.matchCount === 1 && r.laneDuplicates === 0 && r.replayEqual === true &&
      r.policyVersion === 'MATCH-POLICY-1.0.0' && /^sha256:[0-9a-f]{64}$/.test(r.explanationDigest || '') &&
      Number.isFinite(r.durationMs) && r.durationMs >= 0) &&
    evidence.latency?.p95Ms !== null && evidence.latency?.p95Ms <= 30000;
}
module.exports = { complete };
