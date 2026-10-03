const { runValidationGates } = require('../src/gates');

const validPackage = {
  id: 'pkg-001', version: '1.0.0',
  manifest: { title: 'AI Safety Course' },
  modules: [
    { id: 'm1', source: 'NIST SP 800-53', source_hash: 'abc123' },
    { id: 'm2', source: 'OWASP Top 10 2021', source_hash: 'def456' },
    { id: 'm3', source: 'OECD AI Principles 2024', source_hash: 'ghi789' },
    { id: 'm4', source: 'NIST AI RMF 1.0', source_hash: 'jkl012' },
    { id: 'm5', source: 'OWASP LLM Top 10', source_hash: 'mno345' },
  ],
  objectives: [
    { id: 'o1', module_id: 'm1', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: false },
    { id: 'o2', module_id: 'm2', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: true, adversarial_coverage: true, critical_rule: 'no-bypass' },
  ],
  examination_template: { pass_threshold: 0.7, question_count: 10, tiers: [1, 2] },
  rubric: { score_floor: 3.5, score_target: 4.0, criteria: ['accuracy', 'coverage', 'traceability'] },
  fallback_bank: { version: '1.0', items: ['f1','f2','f3','f4','f5'] }
};

async function run() {
  console.log('=== Gate Tests ===');

  // Test 1: valid package passes all gates
  const result = await runValidationGates(validPackage);
  console.assert(result.passed === true, 'FAIL: valid package should pass all gates');
  console.assert(result.gates.length === 6, 'FAIL: should have 6 gates');
  console.log('PASS: valid package passes all 6 gates');

  // Test 2: missing manifest field fails schema gate
  const noManifest = { ...validPackage, manifest: undefined };
  const r2 = await runValidationGates(noManifest);
  console.assert(r2.passed === false, 'FAIL: missing manifest should fail');
  console.assert(r2.gates[0].name === 'schema_manifest', 'FAIL: first gate should be schema');
  console.log('PASS: missing manifest fails schema gate');

  // Test 3: missing source hash fails source traceability gate
  const badSource = { ...validPackage, modules: [{ id: 'm1', source: 'NIST SP 800-53' }] };
  const r3 = await runValidationGates(badSource);
  console.assert(r3.gates[1].passed === false, 'FAIL: missing hash should fail source gate');
  console.log('PASS: missing source hash fails source traceability gate');

  // Test 4: safety-critical objective without adversarial coverage fails
  const badObj = { ...validPackage, objectives: [
    { id: 'o1', module_id: 'm1', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: true }
  ]};
  const r4 = await runValidationGates(badObj);
  console.assert(r4.gates[2].passed === false, 'FAIL: safety-critical without adversarial should fail');
  console.log('PASS: safety-critical objective without adversarial coverage fails');

  // Test 5: low pass threshold fails exam policy gate
  const badExam = { ...validPackage, examination_template: { pass_threshold: 0.5, question_count: 10, tiers: [1, 2] } };
  const r5 = await runValidationGates(badExam);
  console.assert(r5.gates[3].passed === false, 'FAIL: low threshold should fail exam gate');
  console.log('PASS: pass threshold below 0.7 fails examination policy gate');

  // Test 6: fallback bank with too few items fails
  const badFallback = { ...validPackage, fallback_bank: { version: '1.0', items: ['f1', 'f2'] } };
  const r6 = await runValidationGates(badFallback);
  console.assert(r6.gates[5].passed === false, 'FAIL: insufficient fallback items should fail');
  console.log('PASS: fallback bank with fewer than 5 items fails');

  console.log('\nAll gate tests passed ✅');
}

run().catch(e => { console.error(e); process.exit(1); });
