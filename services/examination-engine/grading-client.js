'use strict';

// The client for grading-service's POST /v1/item-grades. It returns
// { ok: true, body } for a 200 reply and { ok: false, status } for a refusal,
// which the runner treats as unusable grading. A connection failure, timeout
// or 5xx is a DependencyError, which the runner retries within its window.

const { DependencyError } = require('./sources');

const SOURCE = 'grading-service';
const TIMEOUT_MS = 10000;

function createGradeItems({ url = process.env.GRADING_SERVICE_URL, key = process.env.GRADING_SERVICE_KEY,
  timeoutMs = TIMEOUT_MS } = {}) {
  if (!url || !key) return null;
  return async function gradeItems({ rubric, items, correlationId }) {
    let response;
    try {
      response = await fetch(`${url}/v1/item-grades`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-grading-service-key': key, 'x-correlation-id': correlationId || '' },
        body: JSON.stringify({ rubric, items }) });
    } catch { throw new DependencyError(SOURCE); }
    if (response.status >= 500) throw new DependencyError(SOURCE, 502);
    if (!response.ok) return { ok: false, status: response.status };
    try { return { ok: true, body: await response.json() }; }
    catch { return { ok: false, status: response.status }; }
  };
}

module.exports = { createGradeItems };
