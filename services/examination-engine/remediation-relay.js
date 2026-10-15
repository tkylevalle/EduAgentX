'use strict';

// Issue #21: delivers committed remediation events to Training's structured
// remediation route. The event id is Training's request id, so a redelivery
// after a lost reply replays the same session. One final outcome is recorded
// per event: delivered (with the Training session id) or refused. Anything
// that may succeed later stays pending and is sent again on the next sweep.

const telemetry = require('../../packages/telemetry');
const { trainingRequestFor } = require('./remediation');

const SERVICE = 'examination-engine';
const BATCH_SIZE = 20;
const DEFAULT_TIMEOUT_MS = 5000;
// Training reasons that cannot change for this event (training-service
// session.js decideRemediation and remediation-request.js). A refusal is final
// and keeps the learner gated, so every other reply, including a temporarily
// inactive package, a busy learner, a proxy 404 or an unknown reason, is retried.
const PERMANENT_REFUSALS = ['invalid_request', 'not_registered', 'unknown_objectives', 'no_targeted_content',
  'remediation_request_conflict', 'package_mismatch', 'package_not_pinnable', 'package_not_deliverable',
  'insufficient_practice'];

function classify(status, body) {
  if (status === 200 || status === 201)
    return typeof body?.sessionId === 'string' && body.sessionId ? 'delivered' : 'retry';
  return status >= 400 && status < 500 && PERMANENT_REFUSALS.includes(body?.error) ? 'refused' : 'retry';
}

function createRemediationRelay({ store, url = process.env.TRAINING_SERVICE_URL, key = process.env.TRAINING_INTERNAL_KEY,
  clock = () => new Date().toISOString(), fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url || !key) return null;

  async function post(event) {
    const response = await fetchImpl(`${url}/internal/remediations`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-key': key, 'x-actor-subject': SERVICE,
        'x-correlation-id': event.correlationId },
      body: JSON.stringify(trainingRequestFor(event)), signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await response.json(); }
    catch { body = null; }
    return { status: response.status, body };
  }

  async function deliver(event) {
    const fields = { correlationId: event.correlationId, operation: 'remediation_delivery' };
    let reply;
    try { reply = await post(event); }
    catch {
      telemetry.log(SERVICE, 'remediation_delivery_retry', { ...fields, outcome: 'unreachable' });
      return 'retry';
    }
    const outcome = classify(reply.status, reply.body);
    if (outcome === 'retry') {
      telemetry.log(SERVICE, 'remediation_delivery_retry', { ...fields, outcome: String(reply.status) });
      return outcome;
    }
    const delivered = outcome === 'delivered';
    await store.recordRemediationDelivery({ eventId: event.eventId, outcome,
      trainingSessionId: delivered ? reply.body.sessionId : null,
      detail: delivered ? { status: reply.status, outcome: reply.body.outcome } : { status: reply.status, error: reply.body?.error ?? null },
      recordedAt: clock() });
    telemetry.log(SERVICE, `remediation_${outcome}`, { ...fields, outcome: String(reply.status) });
    return outcome;
  }

  async function sweep() {
    const counts = { delivered: 0, refused: 0, retrying: 0 };
    for (const event of await store.listPendingRemediations(BATCH_SIZE)) {
      const outcome = await deliver(event);
      counts[outcome === 'retry' ? 'retrying' : outcome]++;
    }
    return counts;
  }

  return { deliver, sweep };
}

module.exports = { createRemediationRelay };
