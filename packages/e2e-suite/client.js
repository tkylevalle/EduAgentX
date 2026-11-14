'use strict';
const { createRegistrationMessage, createLifecycleMessage } = require('../external-agent-protocol');
const { command } = require('./identity');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Shared by every identity, including the authentication calls made by the
// existing GatewayProtocolClient. One source IP stays below 600/minute.
function createPacer({ intervalMs = 150, burstSize = 1, now = Date.now, wait = sleep } = {}) {
  if (!Number.isInteger(burstSize) || burstSize < 1 || burstSize > 8 || !Number.isFinite(intervalMs) || intervalMs < 150)
    throw new Error('bounded_request_budget_required');
  let tail = Promise.resolve(), next = 0, used = 0;
  return async function pace() {
    const turn = tail.then(async () => {
      await wait(Math.max(0, next - now()));
      if (++used === burstSize) { next = now() + intervalMs * burstSize; used = 0; }
    });
    tail = turn.catch(() => {});
    await turn;
  };
}
class PublicClient {
  constructor({ gatewayUrl, clientId, clientSecret, pace = async () => {}, fetchImpl = fetch,
    onLatency = () => {}, now = Date.now, wait = sleep }) {
    const { GatewayProtocolClient } = require('../../services/synthetic-agent-learner/gateway-client');
    this.onLatency = onLatency; this.now = now; this.wait = wait;
    this.marketAttemptCounts = new Map();
    this.client = new GatewayProtocolClient({ gatewayUrl, clientId, clientSecret,
      fetchImpl: async (...args) => { await pace(); return fetchImpl(...args); } });
  }
  async call(method, route, body, correlationId, { attempts = 3 } = {}) {
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !route.startsWith('/v1/')) throw new Error('invalid public operation');
    const commandAttempts = [];
    const marketplaceCommand = method === 'POST' && /^\/v1\/marketplace\/capability-requests\/[^/?]+\/(matches|eligibility-checks)$/.test(route);
    for (let n = 0; n < attempts; n++) {
      const start = this.now();
      let r, transportError;
      try { r = await this.client.request(method, route, { body, correlationId,
        // Only full-inventory Marketplace evaluations exceed the generic 10s
        // client budget. Observe the Gateway's finite 30s response/abort plus
        // a small transport margin; the report still evaluates 30s/10s SLOs.
        timeoutMs: marketplaceCommand ? 35000 : 10000 }); }
      catch (error) {
        transportError = error?.code === 'gateway_timeout' || ['AbortError', 'TimeoutError'].includes(error?.name)
          ? 'transport_timeout' : 'transport_unavailable';
        r = { status: 0, body: { error: transportError } };
      }
      const attemptKey = `${route}\0${body?.idempotencyKey}`;
      if (marketplaceCommand) this.marketAttemptCounts.set(attemptKey, (this.marketAttemptCounts.get(attemptKey) || 0) + 1);
      if (marketplaceCommand) commandAttempts.push({
        capabilityRequestId: route.split('/')[4], idempotencyKey: body?.idempotencyKey,
        correlationId, attempt: this.marketAttemptCounts.get(attemptKey), httpStatus: r.status || null,
        durationMs: Math.max(0, this.now() - start),
        error: transportError || (['upstream_timeout','upstream_unavailable'].includes(r.body?.error) ? r.body.error :
          r.status >= 500 ? 'http_5xx' : r.status === 429 ? 'rate_limited' : r.status >= 400 ? 'http_4xx' : null),
        resultId: r.body?.matchResult?.resultId || null,
      });
      this.onLatency({ method, route: route.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id'),
        status: r.status, durationMs: Math.max(0, this.now() - start) });
      if ((r.status !== 0 && r.status !== 429 && r.status < 500) || n === attempts - 1)
        return marketplaceCommand ? { ...r, commandAttempts } : r;
      const retryAfter = Number(r.headers?.get?.('retry-after'));
      await this.wait(r.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60000) : [250, 500][n]);
    }
  }
  async register(scenario, payload, operation = 'register') {
    const c = command(scenario.id, operation);
    const body = createRegistrationMessage({ messageId: c.commandId, correlationId: c.correlationId,
      idempotencyKey: c.idempotencyKey, timeoutMs: 10000, evidence: { mode: 'synthetic' }, payload });
    return this.call('POST', '/v1/agent-learner/registrations', body, c.correlationId);
  }
  async interact(scenario, operation, interactionType, data = {}) {
    const c = command(scenario.id, operation);
    const body = createLifecycleMessage({ messageId: c.commandId, correlationId: c.correlationId,
      idempotencyKey: c.idempotencyKey, timeoutMs: 10000, evidence: { mode: 'synthetic' },
      payload: { interactionType, data: { agentLearnerKey: scenario.learnerId, response: 'bounded deterministic practice', ...data } } });
    return this.call('POST', '/v1/agent-learner/interactions', body, c.correlationId);
  }
}
// No fixed 60-second assumption: the server's deadline governs incomplete
// attempts; fully collected answers get the current 15-minute retry window.
function terminalBound(attempt, lastAcceptedAt, { gradingWindowMs = 900000, marginMs = 45000 } = {}) {
  const base = attempt.responseCollectionComplete ? lastAcceptedAt + gradingWindowMs : Date.parse(attempt.deadlineAt);
  if (!Number.isFinite(base)) throw new Error('invalid_authoritative_deadline');
  return base + marginMs;
}
async function poll(read, done, { deadline, now = Date.now, wait = sleep, intervals = [1000, 2000, 5000] } = {}) {
  let n = 0;
  while (now() <= deadline) {
    const result = await read();
    if (done(result)) return result;
    const delay = Math.min(intervals[Math.min(n++, intervals.length - 1)], deadline - now());
    if (delay <= 0) break;
    await wait(delay);
  }
  return null;
}
module.exports = { PublicClient, createPacer, terminalBound, poll, sleep };
