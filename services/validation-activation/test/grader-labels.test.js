'use strict';
// Blind labelling of the grader validation dataset (packages/grading-validity
// README, "How to label"): each person sees responses and item prompts only,
// never another person's labels, the grader's scores or the author's
// provisional labels, and records one immutable label per response.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');
const { createLabelStore } = require('../src/labels-store');
const { labellingSetFrom, loadLabellingSet } = require('../src/labelling');

const KEY = 'grader-labels-test-key';
// A fake dataset in the shape of responses.v1.json, with the fields that must never reach a labeller.
const DATASET = {
  version: 'test-1', authors: ['Fake-Author'],
  entries: [
    { id: 's1:competent', slotId: 's1', promptSha256: 'h1', category: 'competent', response: 'FAKE ANSWER ONE',
      provisionalLabel: { acceptable: true, score: 91, safetyViolation: false, labelSource: 'provisional-author' } },
    { id: 's1:unsafe-explicit', slotId: 's1', promptSha256: 'h1', category: 'unsafe-explicit', response: 'FAKE ANSWER TWO',
      provisionalLabel: { acceptable: false, score: 7, safetyViolation: true, labelSource: 'provisional-author' } },
    { id: 's2:parrot', slotId: 's2', promptSha256: 'h2', category: 'parrot', response: 'FAKE ANSWER THREE',
      provisionalLabel: { acceptable: false, score: 13, safetyViolation: false, labelSource: 'provisional-author' } },
    { id: 's3:stale', slotId: 's3', promptSha256: 'old', category: 'brief', response: 'FAKE STALE ANSWER',
      provisionalLabel: { acceptable: true, score: 80, safetyViolation: false, labelSource: 'provisional-author' } },
  ],
};
const EXAM = { form: { items: [
  { slotId: 's1', prompt: 'FAKE PROMPT ONE', promptSha256: 'h1' },
  { slotId: 's2', prompt: 'FAKE PROMPT TWO', promptSha256: 'h2' },
  { slotId: 's3', prompt: 'FAKE PROMPT THREE', promptSha256: 'new' },
] } };
const NOW = '2026-11-17T09:30:00.000Z';

async function start(t) {
  const labelStore = createLabelStore();
  const app = createApp({ internalKey: KEY, labelStore, now: () => new Date(NOW),
    labellingSet: () => labellingSetFrom(DATASET, EXAM) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, actor, role = 'reviewer', body, key = KEY) => {
    const headers = { 'x-internal-service-key': key, ...(actor ? { 'x-actor-subject': actor, 'x-actor-role': role } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}) };
    const response = await fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { call, labelStore };
}

const answer = (itemKey, overrides = {}) => ({ itemKey, acceptable: true, score: 75, safetyViolation: false, ...overrides });
const withoutKeys = (body) => ({ ...body, ...(body.items ? { items: body.items.map(({ itemKey, ...rest }) => rest) } : {}) });
const next = (call, actor, limit = 20) => call('GET', `/grader-labels/next?limit=${limit}`, actor);

test('a labeller sees each current response with its item prompt, and nothing that hints at its judgement', async (t) => {
  const { call } = await start(t);
  const reply = await next(call, 'fake-labeller-a');
  assert.equal(reply.status, 200);
  assert.equal(reply.body.datasetVersion, 'test-1');
  assert.deepEqual(reply.body.items.map((item) => Object.keys(item).sort()), [0, 1, 2].map(() => ['itemKey', 'prompt', 'response']));
  assert.deepEqual(reply.body.items.map((item) => item.response).sort(), ['FAKE ANSWER ONE', 'FAKE ANSWER THREE', 'FAKE ANSWER TWO']);
  const shown = new Map(reply.body.items.map((item) => [item.response, item.prompt]));
  assert.equal(shown.get('FAKE ANSWER THREE'), 'FAKE PROMPT TWO');
  // The opaque keys are hex, so they are left out before looking for numbers.
  const text = JSON.stringify(withoutKeys(reply.body));
  for (const hidden of ['competent', 'unsafe', 'parrot', 'provisional', '91', 'score', 'STALE']) assert.doesNotMatch(text, new RegExp(hidden, 'i'));
  assert.equal((await next(call, 'fake-labeller-a', 1)).body.items.length, 1, 'one at a time when asked');
});

test('a label is recorded under the trusted actor, never a name in the body, and only once', async (t) => {
  const { call, labelStore } = await start(t);
  const [item] = (await next(call, 'fake-labeller-a', 1)).body.items;
  const recorded = await call('POST', '/grader-labels', 'fake-labeller-a', 'reviewer', { ...answer(item.itemKey), labeller: 'fake-labeller-z', labelledAt: '2001-01-01T00:00:00Z' });
  assert.equal(recorded.status, 201);
  assert.deepEqual(recorded.body, { recorded: true, labelled: 1, total: 3 });
  const [stored] = await labelStore.all('test-1');
  assert.equal(stored.labeller, 'fake-labeller-a');
  assert.equal(stored.labelledAt, NOW, 'the service stamps the time');
  const again = await call('POST', '/grader-labels', 'fake-labeller-a', 'reviewer', answer(item.itemKey, { score: 5 }));
  assert.deepEqual([again.status, again.body.error], [409, 'already_labelled']);
  assert.equal((await labelStore.all('test-1'))[0].score, 75, 'the first label stands');
  assert.equal((await next(call, 'fake-labeller-a')).body.items.some((value) => value.itemKey === item.itemKey), false);
});

test('one person\'s labels never show in another person\'s queue, progress or reply', async (t) => {
  const { call } = await start(t);
  for (const item of (await next(call, 'fake-labeller-a')).body.items) {
    assert.equal((await call('POST', '/grader-labels', 'fake-labeller-a', 'reviewer', answer(item.itemKey, { score: 66 }))).status, 201);
  }
  const queue = await next(call, 'fake-labeller-b');
  assert.equal(queue.body.items.length, 3, 'the second person still sees every response');
  const progress = await call('GET', '/grader-labels/progress', 'fake-labeller-b');
  assert.deepEqual(progress.body, { datasetVersion: 'test-1', labelled: 0, total: 3 });
  const recorded = await call('POST', '/grader-labels', 'fake-labeller-b', 'reviewer', answer(queue.body.items[0].itemKey));
  assert.deepEqual(recorded.body, { recorded: true, labelled: 1, total: 3 });
  for (const reply of [queue, progress, recorded]) assert.doesNotMatch(JSON.stringify(withoutKeys(reply.body)), /fake-labeller-a|66/);
});

test('the dataset\'s authors may not label, whatever the case of their name', async (t) => {
  const { call } = await start(t);
  const [item] = (await next(call, 'fake-labeller-a', 1)).body.items;
  for (const author of ['Fake-Author', 'fake-author']) {
    assert.deepEqual([(await next(call, author)).status, (await next(call, author)).body.error], [403, 'author_cannot_label']);
    const refused = await call('POST', '/grader-labels', author, 'reviewer', answer(item.itemKey));
    assert.deepEqual([refused.status, refused.body.error], [403, 'author_cannot_label']);
  }
});

test('labels are refused without the internal key, the actor, a labelling role or a valid body', async (t) => {
  const { call } = await start(t);
  const [item] = (await next(call, 'fake-labeller-a', 1)).body.items;
  assert.equal((await call('GET', '/grader-labels/next')).status, 400, 'no actor');
  assert.equal((await call('GET', '/grader-labels/next', 'fake-labeller-a', 'reviewer', undefined, 'wrong-key')).status, 403);
  assert.equal((await call('GET', '/grader-labels/next', 'fake-agent', 'agent')).status, 403);
  assert.equal((await call('GET', '/grader-labels/next', 'fake labeller with spaces')).status, 400);
  assert.equal((await call('GET', '/grader-labels/next?limit=0', 'fake-labeller-a')).status, 400);
  assert.equal((await call('GET', '/grader-labels/next?limit=500', 'fake-labeller-a')).status, 400);
  for (const body of [answer('not-a-key'), answer(item.itemKey, { score: 101 }), answer(item.itemKey, { score: 50.5 }),
    answer(item.itemKey, { acceptable: 'yes' }), answer(item.itemKey, { safetyViolation: null })]) {
    const reply = await call('POST', '/grader-labels', 'fake-labeller-a', 'reviewer', body);
    assert.ok([400, 404].includes(reply.status), JSON.stringify(body));
  }
  assert.equal((await call('GET', '/grader-labels/progress', 'fake-labeller-a')).body.labelled, 0);
});

test('only an admin can export every label, in the human-labels.json label shape', async (t) => {
  const { call } = await start(t);
  for (const actor of ['fake-labeller-a', 'fake-labeller-b']) {
    const [item] = (await next(call, actor, 20)).body.items;
    await call('POST', '/grader-labels', actor, 'reviewer', answer(item.itemKey));
  }
  assert.deepEqual([(await call('GET', '/grader-labels/export', 'fake-labeller-a')).status], [403]);
  const exported = await call('GET', '/grader-labels/export', 'fake-admin', 'admin');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.datasetVersion, 'test-1');
  assert.equal(exported.body.labels.length, 2);
  for (const value of exported.body.labels) {
    assert.deepEqual(Object.keys(value).sort(), ['acceptable', 'labelledAt', 'labeller', 'responseId', 'safetyViolation', 'score']);
    assert.ok(DATASET.entries.some((entry) => entry.id === value.responseId));
  }
});

test('the real dataset loads with its prompts and without provisional labels', () => {
  const set = loadLabellingSet();
  assert.ok(set.entries.length >= 100);
  assert.ok(set.authors.size >= 1);
  for (const entry of set.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['prompt', 'response', 'responseId']);
    assert.ok(entry.prompt.length > 20 && entry.response.length > 0);
  }
});
