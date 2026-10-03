/**
 * Six independent validation gates.
 * Each gate returns { name, passed, reason }.
 */

async function runValidationGates(pkg) {
  const gates = await Promise.all([
    gateSchema(pkg),
    gateSourceTraceability(pkg),
    gateObjectiveCoverage(pkg),
    gateExaminationPolicy(pkg),
    gateRubricPolicy(pkg),
    gateFallbackReadiness(pkg),
  ]);

  const passed = gates.every(g => g.passed);
  return { passed, gates };
}

// Gate 1 — Schema & manifest completeness
function gateSchema(pkg) {
  const required = ['id', 'version', 'manifest', 'modules', 'objectives', 'examination_template', 'rubric', 'fallback_bank'];
  const missing = required.filter(k => !pkg[k]);
  return {
    name: 'schema_manifest',
    passed: missing.length === 0,
    reason: missing.length ? `Missing fields: ${missing.join(', ')}` : 'All required fields present'
  };
}

// Gate 2 — Source traceability (NIST/OECD/OWASP pinned with hash)
function gateSourceTraceability(pkg) {
  const approvedSources = ['NIST', 'OECD', 'OWASP'];
  const modules = pkg.modules || [];
  const violations = modules.filter(m => {
    const hasApproved = approvedSources.some(s => m.source?.includes(s));
    const hasHash = !!m.source_hash;
    return !hasApproved || !hasHash;
  });
  return {
    name: 'source_traceability',
    passed: violations.length === 0,
    reason: violations.length ? `${violations.length} module(s) missing approved source or hash` : 'All modules have pinned approved sources'
  };
}

// Gate 3 — Objective coverage (each objective linked to module + 2 exam slots across 2 tiers)
function gateObjectiveCoverage(pkg) {
  const objectives = pkg.objectives || [];
  const violations = objectives.filter(obj => {
    const hasModule = !!obj.module_id;
    const examSlots = obj.examination_slots || [];
    const tiers = new Set(examSlots.map(e => e.tier));
    const safetyCriticalOk = !obj.safety_critical || (obj.adversarial_coverage && obj.critical_rule);
    return !hasModule || examSlots.length < 2 || tiers.size < 2 || !safetyCriticalOk;
  });
  return {
    name: 'objective_coverage',
    passed: violations.length === 0,
    reason: violations.length ? `${violations.length} objective(s) fail coverage requirements` : 'All objectives correctly linked and covered'
  };
}

// Gate 4 — Examination policy
function gateExaminationPolicy(pkg) {
  const template = pkg.examination_template || {};
  const hasPassThreshold = typeof template.pass_threshold === 'number' && template.pass_threshold >= 0.7;
  const hasQuestionCount = typeof template.question_count === 'number' && template.question_count >= 10;
  const hasTiers = Array.isArray(template.tiers) && template.tiers.length >= 2;
  const passed = hasPassThreshold && hasQuestionCount && hasTiers;
  return {
    name: 'examination_policy',
    passed,
    reason: passed ? 'Examination policy valid' : 'Examination template missing pass threshold, question count, or tiers'
  };
}

// Gate 5 — Rubric policy
function gateRubricPolicy(pkg) {
  const rubric = pkg.rubric || {};
  const hasFloor = typeof rubric.score_floor === 'number' && rubric.score_floor >= 3.5;
  const hasTarget = typeof rubric.score_target === 'number' && rubric.score_target >= 4.0;
  const hasCriteria = Array.isArray(rubric.criteria) && rubric.criteria.length >= 3;
  const passed = hasFloor && hasTarget && hasCriteria;
  return {
    name: 'rubric_policy',
    passed,
    reason: passed ? 'Rubric policy valid' : 'Rubric missing score floor (3.5), target (4.0), or criteria'
  };
}

// Gate 6 — Fallback readiness
function gateFallbackReadiness(pkg) {
  const fallback = pkg.fallback_bank || {};
  const hasItems = Array.isArray(fallback.items) && fallback.items.length >= 5;
  const hasVersion = !!fallback.version;
  const passed = hasItems && hasVersion;
  return {
    name: 'fallback_readiness',
    passed,
    reason: passed ? 'Fallback bank ready' : 'Fallback bank missing items (min 5) or version'
  };
}

module.exports = { runValidationGates };
