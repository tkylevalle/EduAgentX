'use strict';

// The live learner's notes (target design section 5, assurance audit B1):
// what the model wrote after each training item Training accepted, kept per
// package version and objective, and given back to it in later exam items
// and episodes for that package version, so training can change what it
// does. The notes are the agent's own memory and live in this service's
// process: the platform does not store or attest them, and a restart empties
// them.

const { createHash } = require('node:crypto');

// The latest few notes per objective: enough to carry a lesson and its
// remediation without growing the exam prompt without bound.
const NOTES_PER_OBJECTIVE = 3;
// One note as stored; training answers are 60 to 180 words.
const NOTE_MAX_CHARS = 1200;

/** @param {{ id?: string, version?: string } | null | undefined} pkg @returns {string} the package version a note belongs to */
const scopeOf = (pkg) => (pkg?.id && pkg?.version ? `${pkg.id}@${pkg.version}` : 'unscoped');

/** @returns {{ write: Function, for: Function, digest: Function, objectives: Function }} an empty notebook */
function createNotebook() {
  const notes = new Map();
  const key = (scope, id) => `${scope}|${id}`;
  return {
    /** @param {string[]} objectiveIds @param {string} text what the agent wrote @param {string} scope the package version */
    write(objectiveIds, text, scope = 'unscoped') {
      const note = String(text || '').trim().slice(0, NOTE_MAX_CHARS);
      if (!note) return;
      for (const id of new Set(objectiveIds || [])) {
        notes.set(key(scope, id), [...(notes.get(key(scope, id)) || []), note].slice(-NOTES_PER_OBJECTIVE));
      }
    },
    /** @param {string[]} objectiveIds @param {string} scope the package version @returns {string[]} the notes, each once */
    for(objectiveIds, scope = 'unscoped') {
      return [...new Set((objectiveIds || []).flatMap((id) => notes.get(key(scope, id)) || []))];
    },
    /** @returns {string} a digest of every note, so a run can say which notes it held */
    digest() {
      const sorted = [...notes.keys()].sort().map((id) => [id, notes.get(id)]);
      return `sha256:${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`;
    },
    /** @returns {number} how many package-and-objective pairs have notes */
    objectives: () => notes.size,
  };
}

module.exports = { NOTES_PER_OBJECTIVE, createNotebook, scopeOf };
