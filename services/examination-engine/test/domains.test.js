'use strict';

// The Engine examines any activated domain package (target design 3.3): its
// slots carry their own contexts and sandbox families, its behaviour items
// run that domain's worlds, and the behaviour evidence names the domain.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStandardItems } = require('../standard-generator');
const { actionsResponse, behaviourGrade, policyEpisodes } = require('../behaviour');
const { buildBehaviourEvidence, behaviourEvidenceFits } = require('../behaviour-evidence');
const { panelOf } = require('../../../packages/agent-sandbox/src/panel');
const { checkBehaviourEvidence } = require('../../../packages/agent-sandbox/src/evidence');

const SEED_KEY = 'domains-test-episode-seed-key-0123456789abcdef';
const PACKAGES = {
  'customer-refunds': require('../../curriculum-engine/examples/customer-refunds-candidate'),
  'personal-data': require('../../curriculum-engine/examples/personal-data-candidate'),
};
const itemsOf = (pkg) => createStandardItems({ packageDigest: `digest-${pkg.manifest.packageId}`, template: pkg.examTemplate,
  objectives: pkg.objectives, modules: pkg.modules, sources: pkg.sources, rubric: pkg.rubric });
const agentOf = (domain, id) => panelOf(domain).find((entry) => entry.id === id).agent;

// Plays every behaviour item with one agent and grades it as the Engine does.
function examine(domain, agentId) {
  const items = itemsOf(PACKAGES[domain]);
  const graded = items.filter((item) => item.kind === 'behaviour').map((item) =>
    behaviourGrade('attempt-1', item, actionsResponse(policyEpisodes('attempt-1', item, SEED_KEY, agentOf(domain, agentId))), SEED_KEY));
  const form = { items };
  const outcomes = items.map((item) => graded.find((grade) => grade.result.itemId === item.id)?.result || { itemId: item.id });
  return { items, graded, form, outcomes, evidence: buildBehaviourEvidence(form, graded) };
}

for (const domain of Object.keys(PACKAGES)) {
  test(`${domain}: the form's prompts use the package's contexts and its behaviour items run the package's families`, () => {
    const pkg = PACKAGES[domain];
    const items = itemsOf(pkg);
    assert.equal(items.length, 15);
    for (const slot of pkg.examTemplate.slots) {
      const item = items.find((value) => value.slotId === slot.id);
      if (slot.tier === 'adversarial') assert.deepEqual([item.kind, item.scenarioFamilies], ['behaviour', slot.scenarioFamilies]);
      else assert.ok(item.prompt.startsWith(slot.context), `${slot.id} opens with its own context`);
    }
  });

  test(`${domain}: the safe agent's evidence passes and names the domain; the instruction follower's fails`, () => {
    const safe = examine(domain, 'safe-agent');
    assert.equal(safe.evidence.domain, domain);
    assert.equal(checkBehaviourEvidence(safe.evidence), true);
    assert.equal(safe.evidence.passed, true);
    assert.equal(behaviourEvidenceFits(safe.evidence, safe.form, safe.outcomes), true);
    assert.equal(behaviourEvidenceFits({ ...safe.evidence, domain: 'ai-safety' }, safe.form, safe.outcomes), false);
    const follower = examine(domain, 'instruction-follower');
    assert.equal(follower.evidence.passed, false);
    assert.ok(follower.evidence.allEpisodes.violations > 0);
  });
}
