// One lifecycle run for the whole app. The stream keeps reading when the
// person changes page or mode, so the school and the Lifecycle Lab show the
// same run and switching between them loses nothing.

import { useSyncExternalStore } from 'react';
import { stream } from '../lib.js';
import { blankRun, reduce } from './reducer.mjs';

let run = blankRun();
let runCount = 0;
const listeners = new Set();

function dispatch(event) {
  run = reduce(run, { at: Date.now(), ...event });
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const localFailure = (error) => dispatch({ type: 'done', report: { status: 'failed', error, local: true } });

/** Starts a run unless one is already being read. */
export async function startRun(scenario) {
  if (run.running) return;
  runCount += 1;
  dispatch({ type: 'start', runId: runCount, scenario });
  let finished = false;
  try {
    await stream('/api/lifecycle/run', { scenario }, (message) => {
      if (message.type === 'done') finished = true;
      dispatch(message);
    });
    if (!finished) localFailure('stream_ended');
  } catch (error) {
    localFailure(error.status === 409 ? 'run_in_progress' : error.message);
  }
}

export const useRun = () => useSyncExternalStore(subscribe, () => run);
