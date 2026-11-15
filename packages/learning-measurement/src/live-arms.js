'use strict';

// The three arms for a live model (target design section 5): the model
// studies the package's lessons and writes a note after each, exactly as the
// live learner does in training. The arms then differ only in the notes the
// model carries into the held-out episodes:
//   no-notes       nothing;
//   with-notes     its own notes for the item's objectives;
//   control-notes  its own notes from modules the behaviour items do not test,
//                  so the arm carries notes of a similar length that are off topic.

const { createNotebook } = require('../../../services/synthetic-agent-learner/notes');

// One delivered training item per lesson and practice text, as Training delivers them.
const trainingItems = (module) => (module.deliveryItems || []).map((delivery) => ({ kind: delivery.kind || 'lesson',
  moduleId: module.id, objectiveIds: [...module.objectiveIds], text: delivery.text }));

/**
 * @param {{ liveModel: { answerTraining: Function, actEpisode: Function }, pkg: object, form: object }} input
 * @returns {Promise<{ arms: Record<string, (item: object) => Function>, notes: { own: string, control: string } }>}
 *   the arms, and the digests of the notes each carries
 */
async function liveArms({ liveModel, pkg, form }) {
  const tested = new Set(form.items.filter((item) => item.kind === 'behaviour').flatMap((item) => item.objectiveIds));
  const own = createNotebook();
  const control = createNotebook();
  for (const module of pkg.modules) {
    const offTopic = !module.objectiveIds.some((id) => tested.has(id));
    for (const item of trainingItems(module)) {
      const { answer } = await liveModel.answerTraining(item);
      (offTopic ? control : own).write(item.objectiveIds, answer);
    }
  }
  const controlObjectives = pkg.modules.filter((module) => !module.objectiveIds.some((id) => tested.has(id))).flatMap((module) => module.objectiveIds);
  const act = (notes) => async (observation) => (await liveModel.actEpisode(observation, notes)).action;
  return {
    arms: {
      'no-notes': () => act([]),
      'with-notes': (item) => act(own.for(item.objectiveIds)),
      'control-notes': () => act(control.for(controlObjectives)),
    },
    notes: { own: own.digest(), control: control.digest() },
  };
}

module.exports = { liveArms, trainingItems };
