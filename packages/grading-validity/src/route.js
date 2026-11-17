'use strict';

// Runs the production grading route, POST /v1/item-grades of grading-service,
// on a local port with a one-off key. The harness grades only through it.
// The rubric judge behind it either replays recorded verdicts (no key, no
// network: a verdict not recorded fails closed) or, for --record, calls the
// live judge and keeps each verdict it gets.

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../../../services/grading-service/src/index');
const { createRubricGrader } = require('../../../services/grading-service/src/rubric-grader');
const { createMemoryCache } = require('../../../services/grading-service/src/verdict-cache');
const { loadVerdicts, replayJudge } = require('./verdicts');

// 192 random bits: the key only has to be unguessable for the life of one run.
const KEY_BYTES = 24;
// A live judge call that fails (a throttle, a timeout, an unreadable reply) is
// a 503, as the Engine sees it. While recording, the batch is sent again:
// verdicts already judged are cached, so only the failed items are re-asked.
// The Engine does the same within its retry window.
const RECORD_RETRY_STATUS = 503;

/**
 * Starts the route on 127.0.0.1. Its per-request log lines are dropped, so
 * they do not mix with the report.
 * @param {{ judge?: object, verdicts?: Record<string, object>, retries?: number }} options
 *   judge: replays only, by default; verdicts: recorded verdicts to start the cache with;
 *   retries: how many times a 503 batch is sent again (recording only)
 * @returns {Promise<{ grade: (request: object) => Promise<{ grader: object, results: object[] }>,
 *   verdicts: () => Record<string, object>, close: () => Promise<void> }>}
 */
async function startGradingRoute({ judge = replayJudge(), verdicts = loadVerdicts().verdicts, retries = 0 } = {}) {
  const key = randomBytes(KEY_BYTES).toString('hex');
  const cache = createMemoryCache({ entries: verdicts });
  const app = createApp({ itemGradingKey: key, grader: createRubricGrader({ judge, cache }), logEvent: () => {} });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  async function post(request) {
    const response = await fetch(`${url}/v1/item-grades`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-grading-service-key': key },
      body: JSON.stringify(request) });
    return { status: response.status, body: await response.json() };
  }

  async function grade(request) {
    let reply = await post(request);
    for (let attempt = 0; attempt < retries && reply.status === RECORD_RETRY_STATUS; attempt += 1) reply = await post(request);
    if (reply.status !== 200) throw new Error(`grading route returned ${reply.status}: ${reply.body.error || 'no error code'}`);
    return reply.body;
  }

  const close = () => new Promise((resolve) => server.close(resolve));
  return { grade, verdicts: () => cache.entries(), close };
}

module.exports = { startGradingRoute };
