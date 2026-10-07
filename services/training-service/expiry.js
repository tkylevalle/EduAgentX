'use strict';

// Abandoned sessions. An open session with no event for the configured time
// is ended as blocked with reason session_timed_out: on its next request, or
// by the periodic sweep when the learner never returns. Each session is ended
// under the same per-learner lock as a learner request, so the sweep and a
// late request cannot both append a terminal event.

const { randomUUID } = require('node:crypto');
const telemetry = require('../../packages/telemetry');
const { decideTimeout, deriveSessionState } = require('./session');
const { decideAndAppend } = require('./store');

const SERVICE_NAME = 'training-service';
const ACTOR = 'training-service';
const DEFAULT_TIMEOUT_MINUTES = 24 * 60;
const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_BATCH = 100;
// Ten years; a larger value would overflow the Date range when the cutoff is computed.
const MAX_TIMEOUT_MINUTES = 10 * 365 * 24 * 60;

// TRAINING_SESSION_TIMEOUT_MINUTES: a whole number of minutes; 0 turns expiry off.
function sessionTimeoutFromEnv(env = process.env) {
  const raw = env.TRAINING_SESSION_TIMEOUT_MINUTES;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MINUTES * 60 * 1000;
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_TIMEOUT_MINUTES) {
    throw new Error(`TRAINING_SESSION_TIMEOUT_MINUTES must be a whole number of minutes from 0 to ${MAX_TIMEOUT_MINUTES}`);
  }
  return Number(raw) * 60 * 1000;
}

// The time before which a session's last event makes it idle, or null when expiry is off.
function idleCutoff(now, timeoutMs) {
  return timeoutMs > 0 ? new Date(new Date(now).getTime() - timeoutMs).toISOString() : null;
}

// Ends each idle open session once and returns the ids it ended. A session
// that fails is logged and skipped, so it cannot hold up the sessions behind it.
async function expireIdleSessions({ store, timeoutMs, now }) {
  const cutoff = idleCutoff(now, timeoutMs);
  if (!cutoff) return [];
  const ended = [];
  for (const { sessionId, agentLearnerKey } of await store.listIdleOpenSessions(cutoff, SWEEP_BATCH)) {
    const correlationId = randomUUID();
    try {
      if (await expireSession(store, { sessionId, agentLearnerKey, now, cutoff, correlationId })) ended.push(sessionId);
    } catch (error) {
      // The correlation id is the one the session_blocked event would have carried.
      telemetry.log(SERVICE_NAME, 'session_expiry_failed',
        { correlationId, operation: 'expire_idle_session', outcome: error.code || 'error' });
    }
  }
  return ended;
}

async function expireSession(store, { sessionId, agentLearnerKey, now, cutoff, correlationId }) {
  const decision = await decideAndAppend(store, agentLearnerKey, async (tx) => {
    const [session, events] = await Promise.all([tx.getSession(sessionId), tx.getEvents(sessionId)]);
    if (!session || !events.length) throw Object.assign(new Error('session_not_found'), { code: 'session_not_found' });
    const last = events.at(-1);
    // The block keeps the session's evidence mode, so the evidence stays one kind.
    return decideTimeout(deriveSessionState(events), {
      session, now, idleCutoff: cutoff, correlationId, actor: ACTOR,
      evidence: { mode: last.evidenceMode, environment: last.evidenceEnvironment },
    });
  });
  return decision.events.length > 0;
}

// Runs the sweep in the background. A failed sweep is logged and retried on
// the next tick; a tick is skipped while the previous one still runs.
function startExpirySweep({ store, timeoutMs, clock = () => new Date().toISOString(), intervalMs = SWEEP_INTERVAL_MS }) {
  if (!(timeoutMs > 0)) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireIdleSessions({ store, timeoutMs, now: clock() });
    } catch (error) {
      telemetry.log(SERVICE_NAME, 'session_expiry_failed', { operation: 'expire_idle_sessions', outcome: error.code || 'error' });
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { expireIdleSessions, idleCutoff, sessionTimeoutFromEnv, startExpirySweep };
