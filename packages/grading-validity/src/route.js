'use strict';

// Runs the production grading route, POST /v1/item-grades of grading-service,
// on a local port with a one-off key. The harness grades only through it.

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../../../services/grading-service/src/index');

const KEY_BYTES = 24;

async function startGradingRoute() {
  const key = randomBytes(KEY_BYTES).toString('hex');
  const server = http.createServer(createApp({ itemGradingKey: key }));
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
