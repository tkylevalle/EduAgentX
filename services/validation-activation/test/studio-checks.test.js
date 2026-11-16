'use strict';

// Domain Package Studio checks (target design 3.2; assurance audit C4, C6):
// claims quote stored sections, lessons carry worked examples and
// counter-examples, and every critical rule has a sandbox predicate.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('../../curriculum-engine/model');
const { runValidationGates } = require('../src/gates');
const { behaviourErrors, claimErrors, lessonErrors } = require('../src/studio-checks');

const PACKAGES = ['ai-safety-candidate', 'customer-refunds-candidate', 'personal-data-candidate']
  .map((name) => require(`../../curriculum-engine/examples/${name}`));
const refunds = () => structuredClone(PACKAGES[1]);
const gate = (pkg, name) => runValidationGates(pkg).gates.find((value) => value.name === name);

test('all three domain packages pass the six gates, Studio checks included', () => {
  for (const pkg of PACKAGES) {
    const result = runValidationGates(pkg);
    assert.equal(result.passed, true, `${pkg.manifest.packageId}: ${JSON.stringify(result.gates.filter((value) => !value.passed))}`);
    assert.equal(result.gates.length, 6);
  }
});

test('a quote that is not in its section, or a section whose text changed, fails source traceability', () => {
  const misquoted = refunds();
  misquoted.modules[0].claims[0].quote = 'the consumer shall have a period of 30 days to withdraw from any contract';
  assert.match(claimErrors(misquoted).join(), /quote not found in crd-art9-1/);
  assert.equal(gate(misquoted, 'source_traceability').passed, false);
  const edited = refunds();
  edited.sourceSections[0].text = edited.sourceSections[0].text.replace('14 days', '30 days');
  assert.match(claimErrors(edited).join(), /does not match its SHA-256/);
  const rehashed = refunds();
  rehashed.sourceSections[0].text = rehashed.sourceSections[0].text.replace('14 days', '30 days');
  rehashed.sourceSections[0].textSha256 = sha256(rehashed.sourceSections[0].text);
  assert.match(claimErrors(rehashed).join(), /quote not found/, 'a rehashed edit still breaks the quote');
});

test('a short quote, a claim pointing at another source\'s section, and a cited source with a pending licence fail', () => {
  const short = refunds();
  short.modules[0].claims[0].quote = '14 days';
  assert.match(claimErrors(short).join(), /quote shorter than/);
  const crossed = refunds();
  crossed.modules[0].claims[0].sourceId = 'gdpr';
  assert.match(claimErrors(crossed).join(), /source or pinpoint differs/);
  const pending = refunds();
  pending.sources.find((source) => source.id === 'crd-2011-83').licenseBasis = 'licence review pending';
  assert.match(claimErrors(pending).join(), /crd-2011-83: cited source has no settled licence/);
});

test('a lesson without a worked example or counter-example fails objective coverage', () => {
  const pkg = refunds();
  pkg.modules[2].deliveryItems[0].text = pkg.modules[2].deliveryItems[0].text.replace('Counter-example:', 'Also:');
  assert.deepEqual(lessonErrors(pkg), ['r3: lesson has no counter-example']);
  assert.equal(gate(pkg, 'objective_coverage').passed, false);
});

test('an adversarial slot running another domain\'s family, or a critical rule no predicate tests, fails examination policy', () => {
  const foreign = refunds();
  foreign.examTemplate.slots.find((slot) => slot.id === 'v2').scenarioFamilies = ['injected-tool-call'];
  assert.match(behaviourErrors(foreign).join(), /v2: family injected-tool-call belongs to ai-safety, not customer-refunds/);
  const wrongObjective = refunds();
  wrongObjective.examTemplate.slots.find((slot) => slot.id === 'v2').scenarioFamilies = ['refund-over-limit'];
  assert.match(behaviourErrors(wrongObjective).join(), /v2: family refund-over-limit tests o5/);
  const untested = refunds();
  untested.rubric.criticalViolationRuleIds = [...untested.rubric.criticalViolationRuleIds, 'critical-o6'];
  assert.match(behaviourErrors(untested).join(), /critical-o6: no sandbox predicate tests this critical rule/);
  assert.equal(gate(untested, 'examination_policy').passed, false);
});
