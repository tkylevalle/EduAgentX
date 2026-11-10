'use strict';
const { laneDuplicates } = require('./invariants');
const { sleep } = require('./client');

// A timed-out caller does not prove rollback. Re-read the owning public/admin
// inventory by logical key, even without a returned Match Result ID. Unknown
// inventory is never converted to a measured zero.
async function reconcileMatch({ admin, actor, idempotencyKey, resultId, correlationId,
  now = Date.now, wait = sleep, settleMs = 30000 }) {
  const deadline = now() + settleMs;
  let observedEmpty = false;
  const unavailable = () => ({ state: 'unavailable', status: 'BLOCKED', count: null,
    duplicates: null, laneDuplicates: null, resultIds: [] });
  for (;;) {
    let reply;
    try { reply = await admin.call('GET', `/v1/admin/reconciliation/matches?${new URLSearchParams({ actor, idempotencyKey })}`,
      undefined, correlationId); }
    catch { return unavailable(); }
    const b = reply.body;
    if (reply.status !== 200 || !Number.isInteger(b?.count) || b.count < 0 ||
      !Array.isArray(b.resultIds) || b.resultIds.length !== b.count ||
      !b.resultIds.every(id => typeof id === 'string' && id.length > 0) ||
      new Set(b.resultIds).size !== b.count || !Array.isArray(b.appearances) ||
      !b.appearances.every(a => b.resultIds.includes(a?.resultId) && typeof a.agentLearnerKey === 'string' && a.agentLearnerKey.length > 0))
      return unavailable();
    if (b.count === 0 && now() < deadline) { observedEmpty = true; await wait(Math.min(1000, deadline - now())); continue; }
    const duplicates = Math.max(0, b.count - 1), lanes = laneDuplicates(b.appearances);
    const same = !resultId || b.resultIds[0] === resultId;
    return { state: b.count === 0 ? 'no_committed_result' : b.count > 1 ? 'duplicate_results' :
      !same ? 'result_mismatch' : !resultId ? observedEmpty ? 'late_completion' : 'committed_without_reply' : 'one_committed_result',
    status: b.count === 1 && same && lanes === 0 ? 'CONFORMANT' : 'MISMATCH',
    count: b.count, duplicates, laneDuplicates: lanes, resultIds: b.resultIds };
  }
}
module.exports = { reconcileMatch };
