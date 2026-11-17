// School shows the lifecycle as a story. Operator is the technical console.
// The hash names the mode, so a link or a reload keeps it.

import { HUB, isView, roomOf } from './school/campus.mjs';

const FIRST_PAGE = 'overview';
/** The room that shows what an Operator page shows. The overview is the whole campus. */
const PAGE_TO_ROOM = {
  overview: HUB, lab: 'gate', curriculum: 'classroom', credentials: 'hall', verify: 'hall', governance: 'library',
  labelling: 'staff', attention: 'staff', system: 'workshop', evidence: 'workshop', marketplace: 'careers',
};

/**
 * @param {string} hash window.location.hash
 * @param {string|null} [stored] the mode the visitor used last
 * @returns {{ mode: 'school'|'operator', part: string }} part: the room or the page
 */
export function parseHash(hash, stored = null) {
  const [head = '', second = ''] = hash.replace(/^#\/?/, '').split('/');
  if (!head) return { mode: stored === 'operator' ? 'operator' : 'school', part: '' };
  return head === 'school' ? { mode: 'school', part: second } : { mode: 'operator', part: head };
}

/**
 * Where the other mode opens. `last` is the previous switch: when the visitor
 * has not moved since, the switch returns to where they came from.
 * @param {{ mode: string, part: string }} route
 * @param {{ mode: string, here: string, there: string } | null} last
 * @returns {{ hash: string, last: { mode: string, here: string, there: string } }}
 */
export function switchMode(route, last) {
  const inSchool = route.mode === 'school';
  const view = isView(route.part) ? route.part : HUB;
  const from = inSchool ? view : route.part || FIRST_PAGE;
  const cameFromThere = last?.mode === route.mode && last.here === from;
  const mapped = inSchool ? roomOf(view)?.operator || FIRST_PAGE : PAGE_TO_ROOM[from] || HUB;
  const to = cameFromThere ? last.there : mapped;
  const mode = inSchool ? 'operator' : 'school';
  return { hash: inSchool ? `#/${to}` : `#/school/${to}`, last: { mode, here: to, there: from } };
}
