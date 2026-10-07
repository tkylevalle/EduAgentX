'use strict';

// Training monitoring signals, derived only from stored session events, so
// every count can be traced back to the sessions that produced it.
//   started     a session_started event exists
//   completed   a session_completed event exists
//   remediated  a remediation session was assigned
//   resumed     at least one session_resumed event exists
//   aborted     a session_blocked event exists (Training stopped it safely)
//   open        started, not completed and not blocked
//   assigned    remediation assigned but not started by the learner yet
// completionRate = completed / started, or null when nothing has started.

const { deriveSessionState } = require('./session');

const COUNTERS = Object.freeze(['started', 'completed', 'remediated', 'resumed', 'aborted', 'open', 'assigned']);
// Session ids listed per counter; the count itself always covers every session.
const MAX_TRACE_IDS = 200;

function summariseTraining(rows) {
  const counts = Object.fromEntries(COUNTERS.map((name) => [name, 0]));
  const trace = Object.fromEntries(COUNTERS.map((name) => [name, []]));
  const byKind = {};
  const abortReasons = {};
  for (const { session, events } of rows) {
    const types = new Set(events.map((event) => event.eventType));
    const state = deriveSessionState(events.map((event, index) => ({ seq: index + 1, ...event })));
    const kind = session.kind || 'standard';
    const flags = {
      started: types.has('session_started'),
      completed: types.has('session_completed'),
      remediated: kind === 'remediation' && types.has('remediation_assigned'),
      resumed: types.has('session_resumed'),
      aborted: types.has('session_blocked'),
      open: state.status === 'open',
      assigned: state.status === 'assigned',
    };
    byKind[kind] ||= { sessions: 0, started: 0, completed: 0 };
    byKind[kind].sessions += 1;
    if (flags.started) byKind[kind].started += 1;
    if (flags.completed) byKind[kind].completed += 1;
    for (const name of COUNTERS) {
      if (!flags[name]) continue;
      counts[name] += 1;
      if (trace[name].length < MAX_TRACE_IDS) trace[name].push(session.sessionId);
    }
    if (flags.aborted) abortReasons[state.blockReason] = (abortReasons[state.blockReason] || 0) + 1;
  }
  return {
    sessions: rows.length,
    counts,
    completionRate: rate(counts.completed, counts.started),
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, value]) =>
      [kind, { ...value, completionRate: rate(value.completed, value.started) }])),
    abortReasons,
    trace,
    traceLimit: MAX_TRACE_IDS,
  };
}

const rate = (part, whole) => (whole ? Math.round((part / whole) * 10000) / 10000 : null);

module.exports = { COUNTERS, summariseTraining };
