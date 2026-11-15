'use strict';

// Runs the production grading route, POST /v1/item-grades of grading-service,
// on a local port with a one-off key. The harness grades only through it.

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../../../services/grading-service/src/index');

// 192 random bits: the key only has to be unguessable for the life of one run.
const KEY_BYTES = 24;

/**
 * Starts the route on 127.0.0.1. Its per-request log lines are dropped, so
 * they do not mix with the report.
 * @returns {Promise<{ grade: (request: object) => Promise<{ grader: object, results: object[] }>, close: () => Promise<void> }>}
 */
async function startGradingRoute() {
  const key = randomBytes(KEY_BYTES).toString('hex');
  const server = http.createServer(createApp({ itemGradingKey: key, logEvent: () => {} }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  async function grade(request) {
    const response = await fetch(`${url}/v1/item-grades`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-grading-service-key': key },
      body: JSON.stringify(request) });
    const body = await response.json();
    if (response.status !== 200) throw new Error(`grading route returned ${response.status}: ${body.error || 'no error code'}`);
    return body;
  }

  const close = () => new Promise((resolve) => server.close(resolve));
  return { grade, close };
}

module.exports = { startGradingRoute };
