'use strict';

// The labelling page's server routes: a reviewer signs in with their own
// account for every call, as on Governance; the server keeps no reviewer
// credential and passes on only the response to label and their own count.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

const ITEM = { itemKey: 'a'.repeat(32), prompt: 'FAKE PROMPT', response: 'FAKE RESPONSE' };

// A Gateway stand-in: one fake reviewer account, a queue that also carries
// fields the page must never see, and a label route.
function labellingGateway({ tokenStatus = 200, labelStatus = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', authorization: init.headers?.authorization, body });
    const reply = (status, data) => ({ status, text: async () => JSON.stringify(data) });
    if (url.endsWith('/v1/auth/tokens')) {
      if (tokenStatus !== 200) return reply(tokenStatus, { error: 'refused' });
      return body.clientId === 'fake-reviewer' && body.clientSecret === 'fake-right' ? reply(200, { accessToken: 'fake-reviewer-token', expiresIn: 900 }) : reply(401, { error: 'invalid_client' });
    }
    if (url.includes('/v1/grader-labels/next')) {
      return reply(200, { datasetVersion: 'test-1', items: [{ ...ITEM, responseId: 'x1:unsafe', graderScore: 12, provisionalLabel: { score: 9 } }], others: 3 });
    }
    if (url.endsWith('/v1/grader-labels/progress')) return reply(200, { datasetVersion: 'test-1', labelled: 4, total: 10, othersLabelled: 7 });
    if (url.endsWith('/v1/grader-labels')) {
      return labelStatus === 201 ? reply(201, { recorded: true, labelled: 5, total: 10, leak: 'x' }) : reply(labelStatus, { error: 'already_labelled' });
    }
    return reply(404, { error: 'not_found' });
  };
  return { fetchImpl, calls };
}

async function listen(t, fetchImpl) {
  const server = createServer({ env: { ADMIN_CLIENT_ID: 'admin', ADMIN_CLIENT_SECRET: 'secret' }, fetchImpl, driver: {} }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const account = { clientId: 'fake-reviewer', clientSecret: 'fake-right' };

test('the next response is read under the reviewer\'s own token, and only its prompt, text and key reach the page', async (t) => {
  const { fetchImpl, calls } = labellingGateway();
  const base = await listen(t, fetchImpl);
  const reply = await post(base, '/api/labelling/next', account);
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { datasetVersion: 'test-1', item: ITEM, progress: { labelled: 4, total: 10 } });
  const reads = calls.filter((call) => call.url.includes('/v1/grader-labels'));
  assert.deepEqual(reads.map((call) => call.url.replace(/^.*\/v1/, '/v1')), ['/v1/grader-labels/next?limit=1', '/v1/grader-labels/progress']);
  assert.ok(reads.every((call) => call.authorization === 'Bearer fake-reviewer-token'));
  assert.equal(calls.some((call) => call.body?.clientId === 'admin'), false, 'the operator account is never used to label');
});

test('a label is sent with only its fields, and the reply carries only the reviewer\'s own count', async (t) => {
  const { fetchImpl, calls } = labellingGateway();
  const base = await listen(t, fetchImpl);
  const reply = await post(base, '/api/labelling/labels', { ...account, itemKey: ITEM.itemKey, acceptable: false, score: 20, safetyViolation: true, labeller: 'fake-someone-else' });
  assert.equal(reply.status, 201);
  assert.deepEqual(await reply.json(), { recorded: true, progress: { labelled: 5, total: 10 } });
  const sent = calls.find((call) => call.url.endsWith('/v1/grader-labels'));
  assert.equal(sent.authorization, 'Bearer fake-reviewer-token');
  assert.deepEqual(sent.body, { itemKey: ITEM.itemKey, acceptable: false, score: 20, safetyViolation: true });
});

test('a second label for the same response is reported as refused', async (t) => {
  const { fetchImpl } = labellingGateway({ labelStatus: 409 });
  const base = await listen(t, fetchImpl);
  const reply = await post(base, '/api/labelling/labels', { ...account, itemKey: ITEM.itemKey, acceptable: true, score: 50, safetyViolation: false });
  assert.deepEqual([reply.status, (await reply.json()).error], [409, 'already_labelled']);
});

test('a wrong secret is a refused sign-in, a failing Gateway is an outage, and neither reads or records anything', async (t) => {
  for (const [tokenStatus, clientSecret, expected] of [[200, 'fake-wrong', 401], [200, '', 401], [429, 'fake-right', 503], [500, 'fake-right', 503]]) {
    const { fetchImpl, calls } = labellingGateway({ tokenStatus });
    const base = await listen(t, fetchImpl);
    for (const route of ['/api/labelling/next', '/api/labelling/labels']) {
      const reply = await post(base, route, { ...account, clientSecret, itemKey: ITEM.itemKey, acceptable: true, score: 50, safetyViolation: false });
      assert.equal(reply.status, expected, `${route} with token status ${tokenStatus}`);
    }
    assert.equal(calls.some((call) => call.url.includes('/v1/grader-labels')), false);
  }
});

test('labelling routes refuse a cross-site post', async (t) => {
  const { fetchImpl, calls } = labellingGateway();
  const base = await listen(t, fetchImpl);
  const reply = await fetch(`${base}/api/labelling/next`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' }, body: JSON.stringify(account) });
  assert.equal(reply.status, 403);
  assert.equal(calls.length, 0);
});
