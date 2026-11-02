'use strict';
// Pure preflight: never executes the formal scenarios or fabricates authority.
const { manifest, manifestHash } = require('./manifest');
const { golden, goldenHash } = require('./marketplace');
const { command } = require('./identity');
const CATEGORIES = ['competent', 'adversarial', 'remediable', 'underqualified', 'robustness'];
function goldenReadiness({ lifecycleOrigin = false, signedLabels = false, cohortDriver = false } = {}) {
  const cases = golden.cases.map(c => {
    const blockers = [...(!lifecycleOrigin ? ['lifecycle_origin_adapter'] : []), ...(!signedLabels ? ['signed_environment_evidence_labels'] : [])];
    const missing = [...(!cohortDriver ? ['real_cohort_setup_action_driver', 'case_bound_independent_oracle'] : []),
      ...(['gaps', 'ranking'].includes(c.family) ? ['governed_aged_or_tied_cohort'] : []),
      ...(c.family === 'limits' ? ['multiple_real_credentials_per_learner'] : [])];
    return { caseId: c.id, family: c.family, status: blockers.length ? 'BLOCKED' : missing.length ? 'NOT_IMPLEMENTED' : 'READY',
      blockers, missing, capabilities: c.family === 'ranking' ? ['ranking', 'score_components', 'deterministic_explanations'] :
        c.family === 'history' ? ['replay', 'historical_immutability'] : c.family === 'limits' ? ['lane_limits', 'representative_credential'] : [c.family] };
  });
  const counts = Object.fromEntries(['READY', 'BLOCKED', 'NOT_IMPLEMENTED'].map(s => [s, cases.filter(c => c.status === s).length]));
  return { datasetHash: goldenHash, counts, missingHarnessCases: cases.filter(c => c.missing.length).length,
    note: 'Primary status prioritizes upstream blockers. Missing harness work is an independent overlapping count, never hidden by BLOCKED.', cases };
}
function preflight({ phase1, resources = {} } = {}) {
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, manifest.scenarios.filter(s => s.category === c).length]));
  const variants = Object.fromEntries(['malformed', 'inconsistent', 'timing-out', 'unavailable'].map(v => [v, manifest.scenarios.filter(s => s.variant === v).length]));
  const operations = ['register', 'initial:admission', 'initial:answer:example-item', 'reexamination:admission', 'market-match'];
  const keys = manifest.scenarios.flatMap(s => operations.map(op => command(s.id, op).idempotencyKey));
  const valid = manifest.scenarios.length === 1000 && Object.values(counts).every(n => n === 200) &&
    Object.values(variants).every(n => n === 50) && new Set(manifest.scenarios.map(s => s.id)).size === 1000 &&
    new Set(manifest.scenarios.map(s => s.clientId)).size === 1000 && new Set(keys).size === keys.length;
  const marketplaceCandidates = manifest.scenarios.filter(s => s.expected.marketplace !== 'not_applicable').length;
  // Timings must come from a measured report, not a guessed planning constant.
  const elapsed = phase1 ? Date.parse(phase1.finishedAt) - Date.parse(phase1.startedAt) : NaN;
  const measured25 = phase1?.executed === 25 && phase1?.lifecycleConformant === 25 && elapsed > 0;
  const minutes = measured25 ? elapsed / 60000 : null;
  return { schemaVersion: 'issue-33-preflight/1.0.0', formal1000: 'NOT_RUN', formalGolden100: 'NOT_RUN',
    manifest: { valid, count: manifest.scenarios.length, counts, variants, hash: manifestHash },
    identities: { explicitCount: 1000, provisioningCapacity: 2000, executed1000: 'NOT_RUN', authenticatedPath: 'real_gateway_RS256' },
    deterministicCommands: { sampledOperationsPerScenario: operations.length, unique: new Set(keys).size === keys.length },
    execution: { workers: 4, maximumWorkers: 8, sharedRequestPacerMs: 150, requestBudgetPerMinute: 400, gatewayLimitPerMinute: 600,
      timeoutObservers: 'parked promises, separate from preparation workers; polling shares the HTTP budget',
      responseDeadlineMinutes: 60, gradingRetryWindowMinutes: 15, sourceLock: 'content fingerprint before/after execution and between runner stages',
      isolation: 'new private project/volumes/keys/roster per invocation; normal stack untouched',
      resume: 'NO in-place resume: interrupted evidence retained; rerun in fresh volumes with same logical IDs and new server mappings',
      cleanup: 'only invocation-owned project volumes; no developer volume deletion',
      output: 'artifacts/issue-33/<private-run-id>/', requiredFreeDiskGiB: 10, recommendedAvailableMemoryGiB: 8,
      resources, capacityProvenAt1000: false },
    measuredPilot: { verified25: measured25, elapsedMinutes: minutes, sourceFingerprint: phase1?.source?.fingerprint || null,
      note: 'Phase 1 timing extrapolation only; includes accelerated timeout scheduling, not a 1000-load measurement.' },
    runtimeEstimate: { naive1000Minutes: minutes === null ? null : minutes * 40,
      planningRangeMinutes: minutes === null ? null : [Math.ceil(minutes * 40 + 59), Math.ceil(minutes * 40 * 1.5 + 75)],
      excludes: ['additional 600 passing candidate lifecycles to reach 1000 credentialed agents', '100 full golden cases', 'high-fanout source contention'],
      schedulingRisk: 'formal order places 100 incomplete-response scenarios near the end; their real 60-minute deadline creates a tail; cohort matching is serial afterward' },
    expectedCurrentBlockage: { lifecycleCandidateScenarios: marketplaceCandidates, fullOutcomesBlockedByMarketplace: marketplaceCandidates,
      maximumConformantWithoutMarketplace: 1000 - marketplaceCandidates, acceptanceFloorReachable: false,
      candidateShortfallForGolden: 1000 - marketplaceCandidates },
    marketplace: goldenReadiness(), readiness: valid ? 'BLOCKED_FOR_FORMAL_ACCEPTANCE' : 'FAIL',
    remaining: ['real Marketplace origin/labels', 'complete golden real-cohort/action driver and per-case oracle', '1000-candidate load measurement',
      'full-run reconciliation and safety evidence', 'default-duration timeout execution', 'review before formal launch'] };
}
module.exports = { goldenReadiness, preflight };
