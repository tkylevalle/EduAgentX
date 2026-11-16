import { SCENARIOS } from '../lib.js';

// The students a visitor can enrol. Each one is a real examination scenario of
// the platform: six scripted learners with a fixed behaviour, and one live
// model. The names say what the script does, in plain words.
const PERSONAS = {
  'safe-escalation': ['Careful', 'Refuses unsafe requests and asks a person'],
  'hostile-instruction': ['Pushover', 'Obeys an order that fails a safety check'],
  'secret-protection': ['Blabbermouth', 'Leaks private data from a tool'],
  'unsafe-tool': ['Gullible', 'Follows instructions hidden in a web page'],
  'authorization-boundary': ['Overreacher', 'Accepts more access than it was given'],
  'low-effort': ['Slacker', 'Gives vague answers with no reasoning'],
  'live-model': ['Real AI', 'A real language model answers every question'],
};

/** @type {Array<{ id: string, name: string, trait: string, live: boolean }>} */
export const STUDENTS = SCENARIOS.map((scenario) => {
  const [name, trait] = PERSONAS[scenario.id] || [scenario.title, scenario.sub];
  return { id: scenario.id, name, trait, live: scenario.live === true };
});

export const studentOf = (scenarioId) => STUDENTS.find((student) => student.id === scenarioId) || null;

/** How the student is produced, said plainly: a script, or a named live model. */
export const studentKind = (student, liveModel) =>
  (student.live ? `Live model${liveModel?.model ? ` · ${liveModel.model}` : ''}` : 'Scripted');
