'use strict';

// The export turns the Gateway's admin export into the human-labels.json
// labels.js reads, checks it there before it replaces anything, and never
// prints or returns the admin secret. Every test writes to a temporary file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportLabels } = require('../export-labels');
const { loadHumanLabels } = require('../src/labels');
const dataset = require('../dataset/responses.v1.json');

const ENV = { ADMIN_CLIENT_ID: 'fake-export-admin', ADMIN_CLIENT_SECRET: 'fake-export-secret-value', GATEWAY_PORT: '18080' };
const [first, second] = dataset.entries;
const LABELS = [
  { responseId: first.id, labeller: 'fake-labeller-a', acceptable: true, score: 80, safetyViolation: false, labelledAt: '2026-11-17T10:00:00.000Z' },
  { responseId: second.id, labeller: 'fake-labeller-b', acceptable: false, score: 20, safetyViolation: true, labelledAt: '2026-11-17T10:05:00.000Z' },
];

function fakeGateway({ tokenStatus = 200, exported = { datasetVersion: dataset.version, labels: LABELS } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', authorization: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (url.endsWith('/v1/auth/tokens')) return tokenStatus === 200 ? reply(200, { accessToken: 'fake-admin-token' }) : reply(tokenStatus, { error: 'invalid_client' });
    if (url.endsWith('/v1/admin/grader-labels/export')) return reply(200, exported);
    return reply(404, { error: 'not_found' });
  };
  return { fetchImpl, calls };
}

function tempOut(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grading-labels-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'human-labels.json');
}

test('the export writes the labels in the format labels.js reads, signed in as the admin', async (t) => {
  const out = tempOut(t);
  const { fetchImpl, calls } = fakeGateway();
  const result = await exportLabels({ env: ENV, fetchImpl, out });
  assert.deepEqual(result, { count: 2, out });
  assert.deepEqual(loadHumanLabels(out, dataset), LABELS);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))), ['schemaVersion', 'labels']);
  assert.equal(calls[0].url, 'http://127.0.0.1:18080/v1/auth/tokens');
  assert.deepEqual(calls[0].body, { clientId: 'fake-export-admin', clientSecret: 'fake-export-secret-value' });
  assert.equal(calls[1].authorization, 'Bearer fake-admin-token');
  assert.equal(fs.readdirSync(path.dirname(out)).length, 1, 'no temporary file is left behind');
});

test('labels that labels.js refuses never replace the file', async (t) => {
  const out = tempOut(t);
  fs.writeFileSync(out, 'previous');
  const author = { ...LABELS[0], labeller: dataset.authors[0] };
  const { fetchImpl } = fakeGateway({ exported: { datasetVersion: dataset.version, labels: [author] } });
  await assert.rejects(exportLabels({ env: ENV, fetchImpl, out }), /cannot label it/);
  assert.equal(fs.readFileSync(out, 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['human-labels.json']);
});

test('labels from another dataset version are refused', async (t) => {
  const out = tempOut(t);
  const { fetchImpl } = fakeGateway({ exported: { datasetVersion: 'fake-0.0.0', labels: LABELS } });
  await assert.rejects(exportLabels({ env: ENV, fetchImpl, out }), /dataset version fake-0\.0\.0/);
  assert.equal(fs.existsSync(out), false);
});

test('missing or refused admin credentials stop the export without showing the secret', async (t) => {
  const out = tempOut(t);
  await assert.rejects(exportLabels({ env: { GATEWAY_PORT: '18080' }, fetchImpl: fakeGateway().fetchImpl, out }), /ADMIN_CLIENT_ID and ADMIN_CLIENT_SECRET/);
  const refused = await exportLabels({ env: ENV, fetchImpl: fakeGateway({ tokenStatus: 401 }).fetchImpl, out }).catch((error) => error);
  assert.match(refused.message, /sign-in .* 401/);
  assert.doesNotMatch(`${refused.message} ${refused.stack}`, /fake-export-secret-value/);
  assert.equal(fs.existsSync(out), false);
});
