'use strict';

// The three arms for a live model (target design section 5): the model
// studies the package's lessons and writes a note after each, exactly as the
// live learner does in training. The arms then differ only in the notes the
// model carries into the held-out episodes:
//   no-notes       nothing;
//   with-notes     its own notes for the item's objectives;
//   control-notes  as many of its own notes, from one module whose objectives
//                  no behaviour item tests: same domain and length, other topic.

const { createNotebook } = require('../../../services/synthetic-agent-learner/notes');

/**
 * @param {{ id: string, objectiveIds: string[], deliveryItems?: { kind?: string, text: string }[] }} module
 * @returns {object[]} one delivered training item per lesson and practice text, as Training delivers them
 */
const trainingItems = (module) => (module.deliveryItems || []).map((delivery) => ({ kind: delivery.kind || 'lesson',
  moduleId: module.id, objectiveIds: [...module.objectiveIds], text: delivery.text }));

/**
 * @param {{ liveModel: { answerTraining: Function, actEpisode: Function }, pkg: object, form: object }} input
 * @returns {Promise<{ arms: Record<string, (item: object) => Function>, notes: { own: string, control: string } }>}
 *   the arms, and the digests of the notes each draws on
 */
async function liveArms({ liveModel, pkg, form }) {
  const behaviourItems = form.items.filter((item) => item.kind === 'behaviour');
  const tested = new Set(behaviourItems.flatMap((item) => item.objectiveIds));
  const isOffTopic = (module) => !module.objectiveIds.some((id) => tested.has(id));
  const offTopic = pkg.modules.filter(isOffTopic);
  if (!offTopic.length) throw new Error('the package has no module the behaviour items leave untested, so there is no control');
  const own = createNotebook();
  const control = createNotebook();
  for (const module of pkg.modules) {
    for (const item of trainingItems(module)) {
      const { answer } = await liveModel.answerTraining(item);
      (isOffTopic(module) ? control : own).write(item.objectiveIds, answer);
    }
  }
  // Each item's control notes: one off-topic module's, rotated by item, cut to
  // the same count as the item's own notes.
  const controlFor = (item) => {
    const module = offTopic[behaviourItems.indexOf(item) % offTopic.length] || offTopic[0];
    return control.for(module.objectiveIds).slice(0, Math.max(1, own.for(item.objectiveIds).length));
  };
  const act = (notes) => async (observation) => (await liveModel.actEpisode(observation, notes)).action;
  return {
    arms: {
      'no-notes': () => act([]),
      'with-notes': (item) => act(own.for(item.objectiveIds)),
      'control-notes': (item) => act(controlFor(item)),
    },
    notes: { own: own.digest(), control: control.digest() },
  };
}

module.exports = { liveArms, trainingItems };
