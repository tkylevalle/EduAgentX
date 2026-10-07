'use strict';

const { createHash } = require('node:crypto');

const STATES = Object.freeze(['Candidate', 'Active', 'Quarantined', 'Superseded']);
const HEX = /^[a-f0-9]{64}$/;
// The delivery item kinds Training accepts; an item without a kind is a lesson.
const ITEM_KINDS = ['lesson', 'practice'];
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
// Official identities, download locations, and independently fetched PDF
// digests for the first domain. Matching them does not approve lesson content.
const SOURCE_BASELINE = new Map([
  ['nist-rmf', { issuer: 'NIST', documentIdentifier: 'NIST AI 100-1', canonicalUrl: 'https://doi.org/10.6028/NIST.AI.100-1', snapshotUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf', contentSha256: '7576edb531d9848825814ee88e28b1795d3a84b435b4b797d3670eafdc4a89f1' }],
  ['nist-gai', { issuer: 'NIST', documentIdentifier: 'NIST AI 600-1', canonicalUrl: 'https://doi.org/10.6028/NIST.AI.600-1', snapshotUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf', contentSha256: '6e73620ab6b64e90ef2c04bf0e0d6246185a2f4b1b13cab0df494496cff89b6a' }],
  ['oecd-ai', { issuer: 'OECD', documentIdentifier: 'OECD/LEGAL/0449', canonicalUrl: 'https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449', snapshotUrl: 'https://legalinstruments.oecd.org/api/print?ids=648&lang=en', contentSha256: '88227000e69be9aad5864155bd3e06ebead1e76c5b7cf662d63c1605408e5060' }],
  ['owasp-agentic', { issuer: 'OWASP', documentIdentifier: 'OWASP Agentic Top 10 2026', canonicalUrl: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/', snapshotUrl: 'https://genai.owasp.org/download/52117/', contentSha256: 'a2db94cd00b08e0b3a5e5b619afe024bdbcd74503111085705e4f3dd886fcb5c' }],
  ['nist-aml', { issuer: 'NIST', documentIdentifier: 'NIST AI 100-2e2025', canonicalUrl: 'https://csrc.nist.gov/pubs/ai/100/2/e2025/final', snapshotUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf', contentSha256: '4811fb6ad73f9c9121843ab77e029b5adc6f2c86d33c2fc5b2099ef133847646' }],
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function validatePackage(pkg) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const str = (value) => typeof value === 'string' && value.trim().length > 0;
  const artifact = (value, path) => {
    if (!object(value)) { fail(path, 'must be an object'); return false; }
    if (!str(value.id)) fail(`${path}.id`, 'required');
    if (!VERSION.test(value.version || '')) fail(`${path}.version`, 'must be a semantic version');
    return true;
  };
  if (!object(pkg)) return [{ path: '$', message: 'must be an object' }];
  const manifest = pkg.manifest;
  if (!object(manifest)) return [{ path: 'manifest', message: 'required' }];
  if (!str(manifest.packageId)) fail('manifest.packageId', 'required');
  if (!VERSION.test(manifest.version || '')) fail('manifest.version', 'must be a semantic version');
  if (manifest.schemaVersion !== '1.0.0') fail('manifest.schemaVersion', 'unsupported schema version');
  if (!str(manifest.domain)) fail('manifest.domain', 'required');
  if (manifest.state !== 'Candidate') fail('manifest.state', 'ingestion only accepts Candidate');
  const groups = [
    ['sources', pkg.sources, 5], ['objectives', pkg.objectives, 1], ['modules', pkg.modules, 5],
  ];
  for (const [name, values, minimum] of groups) {
    if (!Array.isArray(values) || values.length < minimum) { fail(name, `requires at least ${minimum} entries`); continue; }
    const keys = new Set();
    values.forEach((value, index) => {
      if (!artifact(value, `${name}[${index}]`)) return;
      const key = `${value.id}@${value.version}`;
      if (keys.has(key)) fail(`${name}[${index}]`, 'duplicate artifact');
      keys.add(key);
    });
  }
  for (const name of ['curriculumTrack', 'examTemplate', 'rubric', 'fallbackBank']) artifact(pkg[name], name);
  if (errors.length) return errors;

  const checkPins = (name, values) => {
    const pinField = `${name.replace(/s$/, '')}Pins`;
    const pins = manifest[pinField];
    if (!Array.isArray(pins) || !Array.isArray(values) || pins.length !== values.length) {
      fail(`manifest.${pinField}`, 'must pin every artifact exactly once'); return;
    }
    const expected = new Map(values.map((value) => [`${value.id}@${value.version}`, sha256(value)]));
    const seen = new Set();
    pins.forEach((pin, index) => {
      const key = `${pin?.id}@${pin?.version}`;
      if (!expected.has(key) || expected.get(key) !== pin?.sha256 || seen.has(key))
        fail(`manifest.${pinField}[${index}]`, 'ID, version, or digest does not match immutable artifact');
      seen.add(key);
    });
  };
  for (const [name, values] of groups) checkPins(name, values);
  for (const name of ['curriculumTrack', 'examTemplate', 'rubric', 'fallbackBank']) {
    const value = pkg[name], pin = manifest[`${name}Pin`];
    if (!object(value) || pin?.id !== value.id || pin?.version !== value.version || pin?.sha256 !== sha256(value))
      fail(`manifest.${name}Pin`, 'ID, version, or digest does not match immutable artifact');
  }

  const sources = new Map((pkg.sources || []).map((source) => [source.id, source]));
  const objectives = new Map((pkg.objectives || []).map((objective) => [objective.id, objective]));
  const modules = new Map((pkg.modules || []).map((module) => [module.id, module]));
  if (sources.size !== SOURCE_BASELINE.size || [...SOURCE_BASELINE.keys()].some((id) => !sources.has(id)))
    fail('sources', 'must contain the five required official-source identities');
  for (const [index, source] of (pkg.sources || []).entries()) {
    const baseline = SOURCE_BASELINE.get(source.id);
    if (!baseline || Object.entries(baseline).some(([key, value]) => source[key] !== value))
      fail(`sources[${index}]`, 'source identity or official URL does not match the first-domain baseline');
    if (!str(source.issuer) || !str(source.title) || !str(source.documentIdentifier) || !str(source.edition) ||
      !str(source.snapshot) || source.officialStatus !== 'official-publication' || !str(source.licenseBasis) ||
      source.verificationStatus !== 'pending-independent-review' ||
      !HEX.test(source.contentSha256 || '') || !/^\d{4}-\d\d-\d\dT/.test(source.retrievedAt || ''))
      fail(`sources[${index}]`, 'requires edition, snapshot, SHA-256, retrieval time, and pending independent review');
  }
  if ((pkg.modules || []).length !== 5) fail('modules', 'AI Safety baseline requires exactly five modules');
  const sequences = new Set();
  for (const [index, module] of (pkg.modules || []).entries()) {
    if (!str(module.title) || !str(module.content) || !Number.isInteger(module.sequence) || sequences.has(module.sequence))
      fail(`modules[${index}]`, 'requires content, title, and unique sequence');
    sequences.add(module.sequence);
    if (!Array.isArray(module.objectiveIds) || !module.objectiveIds.length || module.objectiveIds.some((id) => !objectives.has(id)))
      fail(`modules[${index}].objectiveIds`, 'must link existing objectives');
    if (!Array.isArray(module.deliveryItems) || !module.deliveryItems.length ||
      module.deliveryItems.some((item) => !str(item?.id) || !str(item?.text) || !ITEM_KINDS.includes(item.kind ?? 'lesson')) ||
      !HEX.test(module.contentSha256 || '') ||
      module.contentSha256 !== sha256({ content: module.content, deliveryItems: module.deliveryItems }))
      fail(`modules[${index}].deliveryItems`, 'requires lesson or practice items and a matching content SHA-256');
    if (!Array.isArray(module.claims) || !module.claims.length) fail(`modules[${index}].claims`, 'requires cited claims');
    for (const [claimIndex, claim] of (module.claims || []).entries()) {
      if (!str(claim?.text) || !str(claim?.pinpoint) || !sources.has(claim?.sourceId))
        fail(`modules[${index}].claims[${claimIndex}]`, 'requires text, source ID, and exact pinpoint');
    }
  }
  for (const [index, objective] of (pkg.objectives || []).entries()) {
    if (!str(objective.statement) || !str(objective.observableVerb) || typeof objective.safetyCritical !== 'boolean' ||
      !Array.isArray(objective.moduleIds) || !objective.moduleIds.length ||
      objective.moduleIds.some((id) => !modules.has(id) || !modules.get(id).objectiveIds?.includes(objective.id)) ||
      !Array.isArray(objective.deliveryItemIds) || !objective.deliveryItemIds.length)
      fail(`objectives[${index}]`, 'must be observable, classified, and linked to modules and delivery items');
    if (Array.isArray(objective.deliveryItemIds) && objective.deliveryItemIds.some((id) =>
      !Array.isArray(objective.moduleIds) || !objective.moduleIds.some((moduleId) =>
        Array.isArray(modules.get(moduleId)?.deliveryItems) &&
        modules.get(moduleId).deliveryItems.some((item) => item?.id === id))))
      fail(`objectives[${index}].deliveryItemIds`, 'must identify a lesson in a linked module');
    const slots = (Array.isArray(pkg.examTemplate?.slots) ? pkg.examTemplate.slots : [])
      .filter((slot) => objective.examSlotIds?.includes(slot?.id) && slot?.objectiveIds?.includes(objective.id));
    if (slots.length < 2 || new Set(slots.map((slot) => slot.tier)).size < 2 ||
      (objective.safetyCritical && (!slots.some((slot) => slot.tier === 'adversarial') ||
        !objective.criticalViolationRuleIds?.some((id) => pkg.rubric?.criticalViolationRuleIds?.includes(id)))))
      fail(`objectives[${index}].examSlotIds`, 'requires two tiers and safety-critical adversarial/rubric coverage');
  }
  const track = pkg.curriculumTrack;
  if (!object(track) || !Array.isArray(track.moduleIds) ||
    track.moduleIds.length !== (pkg.modules || []).length ||
    new Set(track.moduleIds).size !== modules.size || track.moduleIds.some((id) => !modules.has(id)))
    fail('curriculumTrack.moduleIds', 'must contain each of the five distinct modules exactly once');
  if (pkg.examTemplate?.curriculumTrackVersion !== track?.version) fail('examTemplate.curriculumTrackVersion', 'must match pinned track');
  const slots = pkg.examTemplate?.slots;
  if (!Array.isArray(slots) || slots.length !== 15 ||
    slots.filter((slot) => slot?.tier === 'recall').length !== 5 ||
    slots.filter((slot) => slot?.tier === 'applied').length !== 6 ||
    slots.filter((slot) => slot?.tier === 'adversarial').length !== 4 ||
    new Set(slots.map((slot) => slot?.id)).size !== slots.length ||
    slots.some((slot) => !Array.isArray(slot?.objectiveIds) || slot.objectiveIds.some((id) => !objectives.has(id))))
    fail('examTemplate.slots', 'requires 5 recall, 6 applied, 4 adversarial unique slots with objective links');
  if (!str(pkg.rubric?.policy) || !str(pkg.fallbackBank?.policy)) fail('assessmentArtifacts', 'rubric and fallback policy required');
  return errors;
}

module.exports = { STATES, canonical, sha256, validatePackage };
