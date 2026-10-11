'use strict';

const { sha256 } = require('../../curriculum-engine/model');
const { validateFallbackBank } = require('../../curriculum-engine/fallback');

function validateScope(pkg, scope) {
  const allowed = new Set(['source', 'module', 'objective', 'delivery_item']);
  if (!scope || !allowed.has(scope.type) || typeof scope.id !== 'string' || !scope.id.trim()) return 'one exact source, module, objective, or delivery_item scope is required';
  const exists = scope.type === 'source' ? (pkg.sources || []).some((item) => (item.id || item.sourceId) === scope.id)
    : scope.type === 'module' ? (pkg.modules || []).some((item) => item.id === scope.id)
      : scope.type === 'objective' ? (pkg.objectives || []).some((item) => item.id === scope.id)
        : (pkg.modules || []).some((module) => module.deliveryItems?.some((item) => item.id === scope.id));
  return exists ? null : `${scope.type}:${scope.id} is not present in this package`;
}

function createRefreshCandidate(pkg, freshnessEvidence) {
  const candidate = structuredClone(pkg);
  const observed = freshnessEvidence.observedAt.replace(/[^0-9]/g, '').slice(0, 12) || 'refresh';
  const evidenceSuffix = sha256(freshnessEvidence).slice(0, 8);
  const version = `${pkg.manifest.version}-refresh.${observed}.${evidenceSuffix}`;
  const id = `${pkg.id}-refresh-${observed}-${evidenceSuffix}`;
  candidate.id = id;
  candidate.version = version;
  candidate.state = 'Candidate';
  candidate.manifest.packageId = id;
  candidate.manifest.version = version;
  candidate.manifest.state = 'Candidate';
  candidate.manifest.predecessor = { packageId: pkg.id, version: pkg.version || pkg.manifest.version };
  candidate.freshnessEvidence = freshnessEvidence;
  const source = candidate.sources.find((item) => (item.id || item.sourceId) === freshnessEvidence.sourceId);
  if (!source) throw new Error('candidate source missing');
  source.contentSha256 = freshnessEvidence.observedContentSha256;
  source.retrievedAt = freshnessEvidence.observedAt;
  source.snapshot = freshnessEvidence.snapshotReference;
  source.edition = freshnessEvidence.observedEdition || source.edition;
  source.version = version;
  for (const value of [...candidate.objectives, ...candidate.modules, candidate.curriculumTrack, candidate.examTemplate, candidate.rubric, candidate.fallbackBank])
    value.version = version;
  for (const item of candidate.fallbackBank.items) item.version = version;
  candidate.examTemplate.curriculumTrackVersion = version;
  const pin = (value) => ({ id: value.id, version: value.version, sha256: sha256(value) });
  candidate.manifest.sourcePins = candidate.sources.map(pin);
  candidate.manifest.objectivePins = candidate.objectives.map(pin);
  candidate.manifest.modulePins = candidate.modules.map(pin);
  candidate.manifest.curriculumTrackPin = pin(candidate.curriculumTrack);
  candidate.manifest.examTemplatePin = pin(candidate.examTemplate);
  candidate.manifest.rubricPin = pin(candidate.rubric);
  candidate.manifest.fallbackBankPin = pin(candidate.fallbackBank);
  delete candidate.digest;
  candidate.digest = sha256(candidate);
  return candidate;
}

function selectFallback(pkg, { validationEvidence, reason, quarantinedScopes = [] } = {}) {
  if (pkg?.state !== 'Active') return { error: 'fallback_requires_active_package' };
  if (!['standard_generation_unavailable', 'standard_grading_unavailable'].includes(reason)) return { error: 'fallback_selection_reason_required' };
  const validated = (validationEvidence || []).some((entry) => entry.event === 'validation_run' && entry.result?.passed === true &&
    entry.result.gates?.some((gate) => gate.name === 'fallback_readiness' && gate.passed === true));
  if (!validated) return { error: 'fallback_not_prevalidated' };
  const bank = pkg.fallbackBank || pkg.fallback_bank;
  const sources = pkg.sources || [];
  const objectives = pkg.objectives || [];
  const errors = validateFallbackBank(bank, { sourceIds: new Set(sources.map((item) => item.id || item.sourceId)),
    objectiveIds: new Set(objectives.map((item) => item.id || item.objectiveId)) });
  if (errors.length) return { error: 'fallback_not_selectable', details: errors };
  const pin = pkg.manifest?.fallbackBankPin;
  if (pin?.id !== bank.id || pin?.version !== bank.version || pin?.sha256 !== sha256(bank)) return { error: 'fallback_manifest_pin_mismatch' };
  const quarantined = (quarantinedScopes || []).filter((scope) => {
    if (scope.scopeType === 'objective') return bank.items.some((item) => item.objectiveIds.includes(scope.scopeId));
    if (scope.scopeType === 'source') return bank.items.some((item) => item.sourceLinks.some((link) => link.sourceId === scope.scopeId));
    if (scope.scopeType === 'module') {
      const module = (pkg.modules || []).find((candidate) => candidate.id === scope.scopeId);
      return module?.objectiveIds?.some((id) => bank.items.some((item) => item.objectiveIds.includes(id))) === true;
    }
    if (scope.scopeType === 'delivery_item') return bank.items.some((item) => item.id === scope.scopeId);
    return true;
  });
  if (quarantined.length) return { error: 'fallback_scope_quarantined' };
  return { bank };
}

module.exports = { validateScope, createRefreshCandidate, selectFallback };
