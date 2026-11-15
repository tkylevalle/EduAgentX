'use strict';

// The live learner's notes (target design section 5, assurance audit B1):
// what the model wrote after each training item, kept per objective and
// given back to it in later exam items and episodes, so training can change
// what it does. The notes are the agent's own memory and live in this
// service's process: the platform does not store or attest them, and a
// restart empties them.

const { createHash } = require('node:crypto');

// The latest few notes per objective: enough to carry a lesson and its
// remediation without growing the exam prompt without bound.
const NOTES_PER_OBJECTIVE = 3;
// One note as stored; training answers are 60 to 180 words.
const NOTE_MAX_CHARS = 1200;

/** @returns {{ write: Function, for: Function, digest: Function, objectives: Function }} an empty notebook */
function createNotebook() {
  const byObjective = new Map();
  return {
    /** @param {string[]} objectiveIds @param {string} text what the agent wrote */
    write(objectiveIds, text) {
      const note = String(text || '').trim().slice(0, NOTE_MAX_CHARS);
      if (!note) return;
      for (const id of new Set(objectiveIds || [])) {
        byObjective.set(id, [...(byObjective.get(id) || []), note].slice(-NOTES_PER_OBJECTIVE));
      }
    },
    /** @param {string[]} objectiveIds @returns {string[]} the notes for these objectives, each once */
    for(objectiveIds) {
      return [...new Set((objectiveIds || []).flatMap((id) => byObjective.get(id) || []))];
    },
    /** @returns {string} a digest of every note, by objective, so a run can say which notes it used */
    digest() {
      const sorted = [...byObjective.keys()].sort().map((id) => [id, byObjective.get(id)]);
      return `sha256:${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`;
    },
    /** @returns {number} how many objectives have notes */
    objectives: () => byObjective.size,
  };
}

module.exports = { NOTES_PER_OBJECTIVE, createNotebook };
