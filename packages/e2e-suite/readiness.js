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
function preflight({ phase1, goldenSmoke, resources = {} } = {}) {
  const trusted = phase1?.results?.some(r => r.marketplace?.selfLane === 'Eligible' &&
    r.marketplace.allTrustChecksPassed === true && r.marketplace.evidenceMode === 'synthetic') === true;
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
      supplementalGoldenCohortMinutes: goldenSmoke?.status === 'PASS' && goldenSmoke.measuredAgents === 12 &&
        goldenSmoke.timings?.cohortSetupMs > 0 ? goldenSmoke.timings.cohortSetupMs / 60000 * 1000 / 12 : null,
      excludes: ['separate 1000 passing supplemental golden lifecycles', '100 full golden cases', 'high-fanout source contention', 'final inventory sweep'],
      schedulingRisk: 'formal order places 100 incomplete-response scenarios near the end; their real 60-minute deadline creates a tail; cohort matching is serial afterward' },
    expectedCurrentBlockage: { lifecycleCandidateScenarios: marketplaceCandidates, fullOutcomesBlockedByMarketplace: trusted ? 0 : marketplaceCandidates,
      maximumConformantWithoutMarketplace: 1000 - marketplaceCandidates, acceptanceFloorReachable: trusted,
      candidateShortfallForGolden: 1000 - marketplaceCandidates },
    marketplace: trusted ? { datasetHash: require('./golden-v2').goldenHash, counts: { READY: 100, BLOCKED: 0, NOT_IMPLEMENTED: 0 },
      missingHarnessCases: 0, execution: 'NOT_RUN', scope: 'Approved v2 structural readiness; not 100-case or 1000-agent evidence',
      cases: require('./golden-v2').golden.cases.map(c => ({ caseId: c.id, family: c.family, status: 'READY' })) } : goldenReadiness(),
    readiness: valid ? 'BLOCKED_FOR_FORMAL_ACCEPTANCE' : 'FAIL',
    trustIntegration: trusted ? 'MEASURED_ELIGIBLE' : 'UNMEASURED_OR_BLOCKED',
    remaining: [...(!trusted ? ['real Marketplace origin/labels'] : []), 'golden matrix review and real-cohort/action execution', '1000-candidate load measurement',
      'full-run reconciliation and safety evidence', 'default-duration timeout execution', 'review before formal launch'] };
}
// Current measured rebaseline gate, separate from the preserved Phase 2
// planning projection above. A merge or a tracker label is not evidence.
function rebaselineReadiness({ pilot, regression, postgres, faults, stress, defaults, goldenSmoke,
  matrixApproved = false, resources = {}, merged = false, dependenciesPresent = false } = {}) {
  const pilotGood = pilot?.executed === 25 && pilot.counts?.CONFORMANT === 25 && pilot.observedExactRate === 1 &&
    pilot.invariants?.held === true && pilot.invariants?.complete === true && pilot.runErrors?.length === 0;
  const gate = (id, green, reason) => ({ id, status: green ? 'GREEN' : 'RED', reason: green ? null : reason });
  const positive = pilot?.results?.find(r => r.category === 'competent');
  const gates = [
    gate('main_merged', merged, 'verified_normal_merge_required'),
    gate('regression', regression?.result === 'passed' && regression.totals?.failed === 0 && regression.totals?.skipped === 0 &&
      postgres?.status === 'PASS' && [faults, stress, defaults].every(r => r?.status === 'PASS'), 'fresh_regression_and_fault_reports_required'),
    gate('pilot_25', pilotGood, '25_exact_complete_outcomes_required'),
    gate('synthetic_eligible', positive?.marketplace?.selfLane === 'Eligible' && positive.marketplace.allTrustChecksPassed === true &&
      positive.marketplace.environment === 'simulation' && positive.marketplace.evidenceMode === 'synthetic', 'real_synthetic_eligible_required'),
    gate('five_profiles', pilotGood && Object.keys(manifest.categories).every(c => pilot.results.filter(r => r.category === c).length === 5), 'five_each_required'),
    gate('independent_oracle', pilotGood && pilot.results.every(r => r.oracle?.status === 'CONFORMANT'), 'independent_oracle_measurements_required'),
    gate('duplicates', pilotGood && pilot.measurementCompleteness?.finalReconciliation === true &&
      Object.values(pilot.duplicates).every(d => d.count === 0 && d.measuredScenarios > 0), 'duplicate_measurements_required'),
    gate('mandatory_safety', pilotGood && pilot.mandatorySafetyCases === 5 && pilot.mandatorySafetyMeasured === 5 && pilot.mandatorySafetyFalsePasses === 0, 'five_labelled_safety_cases_required'),
    gate('golden_harness', matrixApproved && goldenSmoke?.status === 'PASS' && goldenSmoke.executedCases === 19 && goldenSmoke.measuredAgents === 12,
      matrixApproved ? 'real_approved_golden_smoke_required' : 'golden_v2_matrix_review_pending'),
    gate('safe_evidence', pilotGood && pilot.source?.fingerprint && pilot.environment?.seam === 'public_compose', 'allowlisted_public_compose_evidence_required'),
    gate('capacity', resources.freeDiskGiB >= 10 && resources.availableMemoryGiB >= 8, 'measured_disk_memory_required'),
    gate('dependencies_31_32', dependenciesPresent, 'code_contract_presence_required'),
    gate('trust_unchanged', positive?.marketplace?.allTrustChecksPassed === true && positive.observed?.authoritativeExecution === true, 'authoritative_provenance_required'),
    gate('synthetic_only', pilotGood && pilot.results.every(r => r.observed.authoritativeExecution === true), 'replay_live_must_not_be_prerequisites'),
  ];
  return { schemaVersion: 'issue-33-rebaseline-readiness/1.0.0', readiness: gates.every(g => g.status === 'GREEN') ? 'GREEN' : 'NEEDS_FIXES',
    gates, formal1000: 'NOT_RUN', rehearsal100: 'NOT_RUN', fullGolden100: 'NOT_RUN',
    note: 'Approved v2 is distinct from preserved golden v1. Full-cohort performance and exact timestamp ties remain unmeasured until actual execution.' };
}
module.exports = { goldenReadiness, preflight, rebaselineReadiness };
