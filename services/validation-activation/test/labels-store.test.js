'use strict';
// The grader-label store: one immutable label per person per response, in
// memory for tests and local runs, in Postgres otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLabelStore } = require('../src/labels-store');

const label = (overrides = {}) => ({ datasetVersion: 'test-1', responseId: 'x1:sample', labeller: 'fake-labeller-a',
  acceptable: true, score: 70, safetyViolation: false, labelledAt: '2026-11-17T10:00:00.000Z', ...overrides });

test('a memory store keeps one label per person per response, whatever the case of the name', async () => {
  const store = createLabelStore();
  assert.equal(await store.add(label()), true);
  assert.equal(await store.add(label({ score: 10 })), false);
  assert.equal(await store.add(label({ labeller: 'FAKE-LABELLER-A', acceptable: false })), false);
  assert.equal(await store.add(label({ labeller: 'fake-labeller-b' })), true);
  const labels = await store.all('test-1');
  assert.deepEqual(labels.map((value) => [value.labeller, value.score]), [['fake-labeller-a', 70], ['fake-labeller-b', 70]]);
});

test('a memory store hands out copies, so a caller cannot change a stored label', async () => {
  const store = createLabelStore();
  await store.add(label());
  (await store.all('test-1'))[0].score = 0;
  assert.equal((await store.all('test-1'))[0].score, 70);
});

test('labels are kept per dataset version, and a person sees only the responses they labelled', async () => {
  const store = createLabelStore();
  await store.add(label());
  await store.add(label({ responseId: 'x2:sample' }));
  await store.add(label({ labeller: 'fake-labeller-b', responseId: 'x3:sample' }));
  await store.add(label({ datasetVersion: 'test-2', responseId: 'x9:sample' }));
  assert.deepEqual([...await store.labelledBy('test-1', 'Fake-Labeller-A')].sort(), ['x1:sample', 'x2:sample']);
  assert.deepEqual([...await store.labelledBy('test-2', 'fake-labeller-a')], ['x9:sample']);
  assert.deepEqual((await store.all('test-2')).map((value) => value.responseId), ['x9:sample']);
});

// A pool stand-in that records each query and answers the insert and reads.
function fakePool({ insertRows = 1, rows = [] } = {}) {
  const queries = [];
  return { queries, async query(text, values) {
    queries.push({ text, values });
    if (/^\s*INSERT/i.test(text)) return { rowCount: insertRows, rows: [] };
    if (/^\s*SELECT/i.test(text)) return { rowCount: rows.length, rows };
    return { rowCount: 0, rows: [] };
  } };
}

test('a Postgres store applies its schema once, then inserts with parameters and no update path', async () => {
  const pool = fakePool();
  const store = createLabelStore({ pool });
  assert.equal(await store.add(label({ labeller: "fake-o'labeller" })), true);
  await store.add(label({ responseId: 'x2:sample' }));
  const schema = pool.queries.filter((query) => /CREATE TABLE/i.test(query.text));
  assert.equal(schema.length, 1, 'the schema is applied once per store');
  const inserts = pool.queries.filter((query) => /^\s*INSERT/i.test(query.text));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].text, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(inserts[0].text, /fake-o'labeller/, 'values travel as parameters');
  assert.deepEqual(inserts[0].values, ['test-1', 'x1:sample', "fake-o'labeller", true, 70, false, '2026-11-17T10:00:00.000Z']);
  assert.equal(pool.queries.some((query) => /\bUPDATE\b|\bDELETE\b/i.test(query.text) && !/BEFORE UPDATE OR DELETE/i.test(query.text)), false);
});

test('a Postgres store reports a conflicting second label as not recorded', async () => {
  const store = createLabelStore({ pool: fakePool({ insertRows: 0 }) });
  assert.equal(await store.add(label()), false);
});

test('a Postgres store returns labels in the export shape with ISO dates', async () => {
  const rows = [{ responseId: 'x1:sample', labeller: 'fake-labeller-a', acceptable: true, score: 70, safetyViolation: false,
    labelledAt: new Date('2026-11-17T10:00:00Z') }];
  const store = createLabelStore({ pool: fakePool({ rows }) });
  assert.deepEqual(await store.all('test-1'), [{ ...rows[0], labelledAt: '2026-11-17T10:00:00.000Z' }]);
});

test('a schema that fails to apply is retried on the next call, not cached', async () => {
  let failures = 1;
  const pool = fakePool();
  const query = pool.query;
  pool.query = async (text, values) => {
    if (/CREATE TABLE/i.test(text) && failures-- > 0) throw new Error('database starting');
    return query(text, values);
  };
  const store = createLabelStore({ pool });
  await assert.rejects(store.add(label()), /database starting/);
  assert.equal(await store.add(label()), true);
});

test('the schema makes labels immutable and allows one label per person per response', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'grader-labels.sql'), 'utf8');
  assert.match(sql, /BEFORE UPDATE OR DELETE ON curriculum_engine\.grader_labels/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS \w+ ON curriculum_engine\.grader_labels \(dataset_version, response_id, lower\(labeller\)\)/);
  assert.match(sql, /score smallint NOT NULL CHECK \(score BETWEEN 0 AND 100\)/);
});
