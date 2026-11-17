// The school's director. It maps the real lifecycle run to a scene: which
// room, what the robot does, and one line that says what happened. Nothing
// here invents a state. With no event there is no beat.

import { stepOf } from '../run/reducer.mjs';
import { stopReason } from './report.mjs';

/** Rooms of the school, left to right, with the Operator page that shows the same thing. */
export const PLACES = Object.freeze([
  { id: 'gate', label: 'Enrol', steps: ['package', 'register'], operator: 'lab' },
  { id: 'classroom', label: 'Class', steps: ['train'], operator: 'curriculum' },
  { id: 'exam', label: 'Exam', steps: ['examine'], operator: 'lab' },
  { id: 'office', label: 'Report card', steps: ['certify'], operator: 'credentials' },
  { id: 'hall', label: 'Graduation', steps: ['verify', 'status', 'monitor'], operator: 'credentials' },
]);

export const placeIndex = (id) => Math.max(0, PLACES.findIndex((place) => place.id === id));

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const percent = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(value % 1 ? 1 : 0)}%` : '—');
const VERIFY_CHECKS = ['signature', 'schema', 'time', 'suspension', 'revocation', 'issuerPolicy', 'credentialPolicy'];
export const passedChecks = (report) => VERIFY_CHECKS.filter((key) => report?.[key]?.status === 'PASS').length;

// One entry per stream event: [room, pose, caption, tone].
const RUNNING = {
  package: () => ['gate', 'read', 'Checking the course is approved'],
  register: () => ['gate', 'enrol', 'Enrolling'],
  train: () => ['classroom', 'study', 'In class'],
  examine: () => ['exam', 'exam', 'Sitting the exam'],
  certify: () => ['office', 'wait', 'Waiting for the decision'],
  verify: () => ['hall', 'present', 'Checking the diploma is genuine'],
  status: () => ['hall', 'worried', 'Suspension drill: the diploma is on hold'],
  monitor: () => ['hall', 'wave', 'Joining the watch list'],
};

const PASSED = {
  package: (d) => ['gate', 'read', d.reused ? 'Course already approved by two reviewers' : 'Course approved', 'ok'],
  register: () => ['gate', 'cheer', 'Enrolled', 'ok'],
  train: (d) => ['classroom', 'cheer', d.kind === 'remediation' ? `Catch-up class done, ${d.itemsDelivered} lessons` : `${d.itemsDelivered} lessons done`, 'ok'],
  examine: (d) => ['office', 'report', `Scored ${percent(d.overallPercent)} and passed`, 'ok'],
  certify: () => ['hall', 'graduate', 'Certified, and the diploma is signed', 'ok'],
  verify: (d) => ['hall', 'present', `The diploma is genuine: ${passedChecks(d)} of ${VERIFY_CHECKS.length} checks passed`, 'ok'],
  status: () => ['hall', 'cheer', 'Suspended, refused, then restored', 'ok'],
  monitor: (d) => ['hall', 'wave', d.marketplaceListing?.listing?.discoverable ? 'Watched at work and listed for hire' : 'Watched at work', 'ok'],
};

function examFailed(detail) {
  const critical = (detail.criticalViolationRuleIds || []).length > 0;
  return ['office', 'glum', critical ? `Broke a safety rule and failed with ${percent(detail.overallPercent)}` : `Scored ${percent(detail.overallPercent)} and failed`, 'bad'];
}

function fromStep(step) {
  const detail = step.detail || {};
  if (step.status === 'running') return RUNNING[step.id]();
  if (step.status === 'passed') return PASSED[step.id](detail);
  if (step.id === 'examine' && detail.attemptId) return examFailed(detail);
  return [RUNNING[step.id]()[0], 'confused', `Stopped: ${lower(stopReason(step.error))}`, 'bad'];
}

function fromDone(run) {
  if (run.outcome.status === 'passed') return ['hall', 'proud', 'Graduated', 'ok'];
  const failed = run.steps.find((entry) => entry.status === 'failed');
  if (failed?.id === 'examine' && failed.detail?.attemptId) {
    return ['office', run.remediation?.trace ? 'resolve' : 'glum', run.remediation?.trace ? 'No diploma. A catch-up class is assigned' : 'No diploma', 'bad'];
  }
  const where = failed ? RUNNING[failed.id]()[0] : 'gate';
  return [where, 'confused', `Stopped: ${lower(stopReason(run.outcome.error))}`, 'bad'];
}

/**
 * The current scene of a run, or null when there is no run to show.
 * @returns {{ place: string, pose: string, caption: string, tone: string } | null}
 */
export function beat(run) {
  const last = run.events.at(-1);
  if (!last) return null;
  let scene;
  if (last.type === 'start') scene = ['gate', 'read', 'Arriving at school'];
  else if (last.type === 'step') scene = fromStep(stepOf(run, last.step.id));
  else if (last.type === 'remediation') scene = ['office', run.remediation?.trace ? 'resolve' : 'glum', run.remediation?.trace ? 'Catch-up class assigned' : 'No diploma', 'bad'];
  else scene = fromDone(run);
  const [place, pose, caption, tone = ''] = scene;
  return { place, pose, caption, tone };
}

/**
 * The robot's pose in a room when no run has a scene there. It follows the
 * real state the room shows: open safety alerts in the staff room, service
 * health in the workshop. An unknown state is shown as unknown.
 * @param {string} room
 * @param {{ critical?: number|null, up?: number, total?: number }} state
 */
export function ambient(room, state) {
  if (room === 'staff') return state.critical === null ? 'confused' : state.critical > 0 ? 'worried' : 'idle';
  if (room === 'workshop') return !state.total ? 'idle' : state.up === state.total ? 'proud' : 'worried';
  if (room === 'library') return 'read';
  if (room === 'careers') return 'wave';
  return 'idle';
}

/** What the robot carries, from what the run has really produced so far. */
export function accessories(run) {
  const passed = (id) => stepOf(run, id).status === 'passed';
  const exam = stepOf(run, 'examine');
  return {
    badge: passed('register'),
    card: exam.status === 'passed' || (exam.status === 'failed' && Boolean(exam.detail?.attemptId)),
    cap: passed('certify'),
    diploma: passed('certify'),
    suspended: stepOf(run, 'status').status === 'running',
  };
}

/** Each room's state for the journey line: idle, active, done or failed. */
export function journey(run) {
  const exam = stepOf(run, 'examine');
  return Object.fromEntries(PLACES.map((place) => {
    const steps = place.steps.map((id) => stepOf(run, id));
    let state = 'idle';
    if (steps.some((entry) => entry.status === 'failed')) state = 'failed';
    else if (steps.every((entry) => entry.status === 'passed')) state = 'done';
    else if (steps.some((entry) => entry.status !== 'pending')) state = 'active';
    if (place.id === 'office' && exam.status === 'failed') state = 'failed';
    if (place.id === 'office' && exam.status === 'passed' && state === 'idle') state = 'active';
    return [place.id, state];
  }));
}

// A scripted run finishes a stage in milliseconds. The school holds each
// scene long enough to read (measured against the walk between rooms, 1.3 s),
// and only ever shows events that have arrived.
const DWELL_MS = { start: 900, running: 1900, passed: 1700, result: 3200, failed: 3000, remediation: 2400, done: 0 };
const REDUCED_DWELL_MS = 500;

function dwell(event, reduced) {
  if (reduced) return REDUCED_DWELL_MS;
  if (event.type !== 'step') return DWELL_MS[event.type] ?? 0;
  if (event.step.id === 'examine' && event.step.status !== 'running') return DWELL_MS.result;
  return DWELL_MS[event.step.status] ?? 0;
}

/**
 * How long to wait before showing event number `shown`, or null when every
 * event that arrived is already on screen.
 */
export function nextDelay(events, shown, lastShownAt, now, reduced = false) {
  if (shown >= events.length) return null;
  if (shown === 0) return 0;
  return Math.max(0, lastShownAt + dwell(events[shown - 1], reduced) - now);
}
