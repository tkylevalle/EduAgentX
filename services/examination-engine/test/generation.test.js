'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { generateStandardForm, publicForm, validateGeneratedForm } = require('../generation');

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId;
  pkg.state = 'Active';
  pkg.digest = sha256(pkg);
  pkg.quarantinedScopes = [];
  pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: 'agent-1', configurationFingerprint: `sha256:${'a'.repeat(64)}` };
  const completion = {
    eventId: 'training.session.completed:s-1', eventType: 'training.session.completed', sessionId: 's-1',
    agentLearnerKey: registration.agentLearnerKey,
    configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version || pkg.manifest.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 },
  };
  pkg.version = pkg.manifest.version;
  const items = pkg.examTemplate.slots.map((slot) => {
    const objective = pkg.objectives.find((value) => value.id === slot.objectiveIds[0]);
    const module = pkg.modules.find((value) => value.id === objective.moduleIds[0]);
    const claim = module.claims[0];
    const source = pkg.sources.find((value) => value.id === claim.sourceId);
    const prompt = `Technical replay prompt for ${slot.id}: ${objective.statement}`;
    return {
      id: `generated-${slot.id}`, slotId: slot.id, tier: slot.tier, prompt,
      promptSha256: sha256(prompt), templateId: pkg.examTemplate.id,
      templateVersion: pkg.examTemplate.version,
      generationPolicySha256: sha256(pkg.examTemplate.generationPolicy),
      objectiveIds: [...slot.objectiveIds],
      sourceLinks: [{ sourceId: source.id, sourceVersion: source.version,
        sourceDigest: source.contentSha256, pinpoint: claim.pinpoint }],
      criticalSafety: objective.safetyCritical,
      criticalViolationRuleIds: [...objective.criticalViolationRuleIds],
      rubricCriterionIds: pkg.rubric.criteria.map((criterion) => criterion.id),
    };
  });
  return { pkg, registration, completion, items };
}

test('valid replay form preserves all 15 slots, policy weights, pins and safe public projection', async () => {
  const input = fixture();
  const form = await generateStandardForm({ ...input, generateItems: async () => input.items });
  assert.deepEqual(form.itemCounts, { recall: 5, applied: 6, adversarial: 4 });
  assert.deepEqual(form.tierWeights, { recall: 20, applied: 40, adversarial: 40 });
  assert.equal(form.items.length, 15);
  assert.equal(form.package.digest, input.pkg.digest);
  assert.equal(form.training.eventId, input.completion.eventId);
  assert.equal(Object.isFrozen(form.items[0].sourceLinks[0]), true);
  input.items[0].prompt = 'changed after validation';
  assert.notEqual(form.items[0].prompt, input.items[0].prompt);
  const publicView = publicForm(form);
  assert.equal(publicView.items.length, 15);
  assert.equal(publicView.training, undefined);
  assert.equal(publicView.subject, undefined);
  assert.equal(publicView.items[0].rubricCriterionIds, undefined);
});

test('unavailable generator, non-Active or quarantined package, and mismatched completion fail closed', async () => {
  const input = fixture();
  await assert.rejects(generateStandardForm(input), { code: 'generator_unavailable' });
  await assert.rejects(generateStandardForm({ ...input, generateItems: async () => { throw new Error('raw secret'); } }),
    { code: 'generator_unavailable' });
  input.pkg.state = 'Candidate';
  assert.throws(() => validateGeneratedForm(input), { code: 'active_package_required' });
  input.pkg.state = 'Active'; input.pkg.quarantinedScopes = [{ scope: 'm1' }];
  assert.throws(() => validateGeneratedForm(input), { code: 'active_package_required' });
  input.pkg.quarantinedScopes = [];
  input.completion.configurationFingerprint = 'changed';
  assert.throws(() => validateGeneratedForm(input), { code: 'matching_training_completion_required' });
});

test('invalid count, duplicate slot, policy weakening, missing source and safety coverage are rejected', () => {
  const input = fixture();
  input.items.pop();
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_generated_form' });
  input.items = fixture().items;
  input.items[1].slotId = input.items[0].slotId;
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_generated_item' });
  input.items = fixture().items;
  input.items[0].tier = 'adversarial';
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_generated_item' });
  input.items = fixture().items;
  input.items[0].sourceLinks[0].pinpoint = 'invented';
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_item_source_or_safety_link' });
  input.items = fixture().items;
  input.items.find((item) => item.slotId === 'v1').criticalSafety = false;
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_item_coverage' });
  input.items = fixture().items;
  input.items[0].expectedAnswer = 'restricted';
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_generated_item' });
});

test('template and objective coverage cannot be weakened', () => {
  const input = fixture();
  input.pkg.examTemplate.tierWeights.applied = 30;
  assert.throws(() => validateGeneratedForm(input), { code: 'invalid_locked_template' });
  input.pkg.examTemplate.tierWeights.applied = 40;
  input.pkg.examTemplate.slots.find((slot) => slot.id === 'r1').objectiveIds = ['o2'];
  const changed = input.items.find((item) => item.slotId === 'r1');
  changed.objectiveIds = ['o2'];
  const source = input.pkg.sources.find((value) => value.id === 'nist-rmf');
  changed.sourceLinks = [{ sourceId: source.id, sourceVersion: source.version,
    sourceDigest: source.contentSha256, pinpoint: input.pkg.modules[1].claims[0].pinpoint }];
  assert.throws(() => validateGeneratedForm(input), { code: 'insufficient_objective_coverage' });
});
