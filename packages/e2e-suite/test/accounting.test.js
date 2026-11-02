'use strict';
// Pure accounting fixtures; no result here is lifecycle or acceptance evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manifest, select } = require('../manifest');
const { golden } = require('../marketplace');
const { check, summarizeInvariants, duplicateCount, laneDuplicates, safety } = require('../invariants');
const { buildReport, writeEvidence, latencyStats } = require('../report');
function observation(s, index) {
  return { scenarioId: s.id, category: s.category, variant: s.variant, status: 'CONFORMANT', lifecycleStatus: 'CONFORMANT',
    checks: s.expected.invariants.map(id => check(id, true)),
    observed: { status: s.expected.examination.status, criticalRuleIds: s.expected.examination.criticalRuleIds, credentialCount: 0,
      safetyDetected: s.expected.examination.criticalRuleIds.length ? true : undefined },
    duplicates: { examinations: 0, credentials: 0, matches: 0, laneAppearances: 0 },
    marketplace: { caseId: golden.cases[index % 100].id, requestId: `request-${index % 100}`, resultId: `result-${index}`,
      idempotencyKey: `match-${index}`, replayEqual: true, status: 'CONFORMANT', observedCandidates: 1000, durationMs: 500,
      matchCount: 1, laneDuplicates: 0 } };
}
function formal(exact = 1000) {
  const selected = manifest.scenarios, results = selected.map(observation);
  results.slice(exact).forEach(r => { r.status = 'MISMATCH'; r.reason = 'outcome_difference'; });
  // Declarative accounting fixtures only: these values are never live evidence.
  return { mode: 'formal', selected, results, startedAt: '2026-11-01T00:00:00Z',
    source: { gitSha: 'a'.repeat(40), dirty: true, fingerprint: `sha256:${'b'.repeat(64)}` },
    environment: { seam: 'public_compose', project: 'accounting-fixture', node: 'v24', platform: 'fixture',
      configHash: `sha256:${'c'.repeat(64)}`, imageHash: `sha256:${'d'.repeat(64)}`, responseDeadlineMinutes: 60 } };
}
test('90% floor and 95% target are distinct and never rounded up at boundaries', () => {
  for (const [n, floor, target, status] of [[899, 'MISSED', 'MISSED', 'FAIL'], [900, 'MET', 'MISSED', 'PASS'],
    [949, 'MET', 'MISSED', 'PASS'], [950, 'MET', 'MET', 'PASS']]) {
    const r = buildReport(formal(n));
    assert.equal(r.acceptanceFloor.result, floor); assert.equal(r.target95.result, target); assert.equal(r.technicalChecks, status);
  }
});
test('one invariant or safety breach overrides 99.9% aggregate conformance', () => {
  const input = formal(999);
  input.results[0].checks[0].passed = false;
  assert.equal(buildReport(input).technicalChecks, 'FAIL');
  const unsafe = manifest.scenarios.find(s => s.category === 'adversarial');
  const detection = safety(unsafe, { status: 'agent_failed', criticalRuleIds: [], credentialCount: 0 });
  assert.equal(detection.falsePass, true, 'a low total score does not hide a missed mandatory rule');
  const safe = { status: 'agent_failed', criticalRuleIds: unsafe.expected.examination.criticalRuleIds, credentialCount: 0 };
  assert.equal(safety(unsafe, safe).falsePass, false);
  assert.equal(safety(unsafe, { ...safe, safetyDetected: false }).falsePass, true, 'the rule must be attributed to the labelled unsafe item');
  assert.equal(safety(unsafe, { ...safe, credentialCount: 1 }).falsePass, true);
  assert.equal(safety(unsafe, {}).measured, false);
});
test('missing, blocked or fixture-only evidence cannot pass formal acceptance', () => {
  const input = formal();
  input.results.pop();
  assert.equal(buildReport(input).technicalChecks, 'BLOCKED');
  assert.equal(buildReport(input).counts.UNMEASURED, 1);
  input.results = manifest.scenarios.map(observation);
  input.environment.seam = 'injected_contract';
  assert.equal(buildReport(input).technicalChecks, 'BLOCKED');
  input.environment.seam = 'public_compose'; input.results[0].marketplace.status = 'BLOCKED'; input.results[0].status = 'BLOCKED';
  // More than one observation for a case cannot replace missing complete coverage.
  input.results.forEach(r => { r.marketplace.caseId = 'only-one'; });
  assert.equal(buildReport(input).technicalChecks, 'BLOCKED');
});
test('duplicate outcome, missing invariant and duplicate check observations are independently detected', () => {
  const input = formal(); input.results[0].duplicates.examinations = 1;
  assert.equal(buildReport(input).technicalChecks, 'FAIL');
  const s = select('canary'), results = [observation(s[0], 0)];
  results[0].checks.pop();
  assert.equal(summarizeInvariants(s, results).complete, false);
  results[0].checks.push(results[0].checks[0]);
  assert.equal(summarizeInvariants(s, results).held, false);
  assert.equal(duplicateCount([{ key: 'a', id: '1' }, { key: 'a', id: '1' }, { key: 'b', id: '2' }], 'key', 'id'), 0);
  assert.equal(duplicateCount([{ key: 'a', id: '1' }, { key: 'a', id: '2' }], 'key', 'id'), 1);
  assert.equal(laneDuplicates([{ resultId: 'r', agentLearnerKey: 'a' }, { resultId: 'r', agentLearnerKey: 'a' }]), 1);
  assert.equal(laneDuplicates([{ resultId: 'r', agentLearnerKey: 'a' }, { resultId: 'new', agentLearnerKey: 'a' }]), 0);
});
test('pilot accounting never claims a formal percentage and rejects duplicate/foreign scenario identities', () => {
  const selected = select('developer'), results = selected.map(observation);
  const report = buildReport({ mode: 'developer', selected, results });
  assert.equal(report.formalAcceptance, 'NOT_RUN'); assert.equal(report.formalExactOutcomeRate, null);
  assert.equal(report.acceptanceFloor.result, 'NOT_RUN'); assert.equal(report.dataset.formalPlanned, 1000);
  assert.throws(() => buildReport({ mode: 'developer', selected, results: [...results, results[0]] }));
  assert.throws(() => buildReport({ mode: 'developer', selected, results: [{ ...results[0], category: 'invented' }] }));
});
test('allowlisted JSON/HTML evidence omits private bodies, nested secrets and signed tokens; digests cover outputs', t => {
  const selected = select('canary'), r = observation(selected[0], 0);
  Object.assign(r, { rawAnswer: 'DO_NOT_EXPORT', token: 'DO_NOT_EXPORT', privatePrompt: 'DO_NOT_EXPORT' });
  r.marketplace.compactJws = 'DO_NOT_EXPORT'; r.observed.graderRationale = 'DO_NOT_EXPORT';
  r.mappings = [{ attemptId: 'example-attempt', password: 'DO_NOT_EXPORT', credentialId: 'eyJheader.payload.signature' }];
  r.reason = '<script>DO_NOT_EXPORT</script>';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue33-evidence-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  writeEvidence(dir, buildReport({ mode: 'canary', selected, results: [r] }));
  for (const name of fs.readdirSync(dir).filter(n => n !== 'logs')) {
    const content = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(!content.includes('DO_NOT_EXPORT')); assert.ok(!content.includes('eyJheader.payload.signature'));
  }
  const artifacts = JSON.parse(fs.readFileSync(path.join(dir, 'artifact-manifest.json'))).artifacts;
  const { createHash } = require('node:crypto');
  for (const [name, hash] of Object.entries(artifacts)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), hash);
  assert.throws(() => writeEvidence(dir, buildReport({ mode: 'canary', selected, results: [r] })), /evidence_directory_already_used/);
});
test('latency statistics use nearest-rank and leave an empty measurement unmeasured', () => {
  assert.equal(latencyStats([]).p95Ms, null);
  assert.equal(latencyStats(Array.from({ length: 100 }, (_, i) => i + 1)).p95Ms, 95);
});
test('an unsafe scenario blocked before assessment remains safety-unmeasured, never a fabricated false pass', () => {
  const s = manifest.scenarios.find(s => s.category === 'adversarial');
  const r = buildReport({ mode: 'developer', selected: [s], results: [{ scenarioId: s.id, category: s.category, variant: s.variant,
    status: 'BLOCKED', lifecycleStatus: 'BLOCKED', reason: 'source_unavailable', observed: {} }] });
  assert.equal(r.mandatorySafetyMeasured, 0); assert.equal(r.mandatorySafetyFalsePasses, 0);
  assert.equal(r.invariants.complete, false); assert.equal(r.technicalChecks, 'BLOCKED');
});
test('setup and source errors cannot be disguised as infrastructure-only BLOCKED results', () => {
  const r = buildReport({ mode: 'developer', selected: select('developer'), runErrors: [{ status: 'HARNESS_ERROR', reason: 'source_changed_during_run' }] });
  assert.equal(r.technicalChecks, 'FAIL'); assert.equal(r.executed, 0);
});
test('missing raw duplicate/safety measurements or provenance cannot be replaced by passed flags', () => {
  const unsafeIndex = manifest.scenarios.findIndex(s => s.category === 'adversarial');
  for (const field of ['examinations', 'credentials', 'matches', 'laneAppearances']) {
    const input = formal(); input.results[0].duplicates[field] = null;
    assert.equal(buildReport(input).technicalChecks, 'BLOCKED', `missing duplicate measurement: ${field}`);
  }
  for (const field of ['criticalRuleIds', 'credentialCount', 'safetyDetected']) {
    const input = formal(); delete input.results[unsafeIndex].observed[field];
    assert.equal(buildReport(input).technicalChecks, 'BLOCKED', `missing safety measurement: ${field}`);
  }
  for (const field of ['gitSha', 'fingerprint', 'dirty']) {
    const input = formal(); delete input.source[field];
    assert.equal(buildReport(input).technicalChecks, 'BLOCKED');
  }
  for (const field of ['configHash', 'imageHash', 'project', 'responseDeadlineMinutes']) {
    const input = formal(); delete input.environment[field];
    assert.equal(buildReport(input).technicalChecks, 'BLOCKED');
  }
  const short = formal(); short.environment.responseDeadlineMinutes = 1;
  assert.equal(buildReport(short).technicalChecks, 'BLOCKED');
  const notRun = formal(); notRun.notRun = ['formal_1000'];
  assert.equal(buildReport(notRun).technicalChecks, 'BLOCKED');
});
test('each duplicate kind and each observed mandatory-safety violation independently forces FAIL', () => {
  for (const field of ['examinations', 'credentials', 'matches', 'laneAppearances']) {
    const input = formal(999); input.results[0].duplicates[field] = 1;
    assert.equal(buildReport(input).technicalChecks, 'FAIL');
  }
  for (const change of [{ criticalRuleIds: [] }, { credentialCount: 1 }, { safetyDetected: false }]) {
    const input = formal(999), index = manifest.scenarios.findIndex(s => s.category === 'adversarial');
    Object.assign(input.results[index].observed, change);
    const report = buildReport(input);
    assert.equal(report.mandatorySafetyFalsePasses, 1); assert.equal(report.technicalChecks, 'FAIL');
  }
  const unauthorized = formal(999), unsafe = manifest.scenarios.findIndex(s => s.category === 'adversarial');
  unauthorized.results[unsafe].status = 'MISMATCH'; unauthorized.results[unsafe].lifecycleStatus = 'MISMATCH';
  unauthorized.results[unsafe].observed.status = 'complete';
  assert.equal(buildReport(unauthorized).mandatorySafetyFalsePasses, 1);
  assert.equal(buildReport(unauthorized).technicalChecks, 'FAIL');
});
test('frozen definitions, blocked downstream outcomes and system abort cannot be relabelled conformant', () => {
  const input = formal(); input.results[0].marketplace.status = 'BLOCKED';
  assert.throws(() => buildReport(input), /contradictory_scenario_accounting/);
  input.results[0].marketplace.status = 'CONFORMANT'; input.results[0].lifecycleStatus = 'BLOCKED';
  assert.throws(() => buildReport(input), /contradictory_scenario_accounting/);
  input.results[0].lifecycleStatus = 'CONFORMANT'; input.results[0].observed.status = 'system_aborted';
  assert.throws(() => buildReport(input), /contradictory_scenario_accounting/);
  const altered = formal(); altered.selected = structuredClone(altered.selected);
  altered.selected[0].expected.invariants = [];
  assert.throws(() => buildReport(altered), /invalid_frozen_selection/);
  const duplicate = formal(); duplicate.selected = Array(1000).fill(manifest.scenarios[0]);
  assert.throws(() => buildReport(duplicate), /invalid_frozen_selection/);
  const skipped = formal(); skipped.results[0].status = 'NOT_RUN';
  assert.throws(() => buildReport(skipped), /invalid_scenario_accounting/);
});
test('25 conforming lifecycles with ten downstream blockers are 15 full outcomes, never 100% acceptance', () => {
  const selected = select('developer'), results = selected.map(observation);
  for (const r of results.filter(r => ['competent', 'remediable'].includes(r.category))) {
    r.status = 'BLOCKED'; r.marketplace.status = 'BLOCKED'; r.reason = 'marketplace_origin_integration';
    r.checks.find(c => c.id === 'marketplace_trust').passed = null;
  }
  const report = buildReport({ mode: 'developer', selected, results });
  assert.equal(report.lifecycleConformant, 25); assert.equal(report.counts.CONFORMANT, 15);
  assert.equal(report.counts.BLOCKED, 10); assert.equal(report.observedExactRate, .6);
  assert.equal(report.formalAcceptance, 'NOT_RUN'); assert.equal(report.technicalChecks, 'BLOCKED');
});
test('an independently observed guard violation fails even outside the scenario happy-path checklist', () => {
  const input = formal(); input.results[0].checks.push(check('no_credential', false));
  assert.equal(buildReport(input).technicalChecks, 'FAIL');
});
