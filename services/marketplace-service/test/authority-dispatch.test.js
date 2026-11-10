'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthorityDispatch, concurrency, DEFAULT_CONCURRENCY } = require('../authority-dispatch');
const { askSource, SourceError } = require('../clients');
const turn = () => new Promise(resolve => setImmediate(resolve));

test('bounded dispatch shares capacity across requests, evaluates every candidate and retains input order', async () => {
  const dispatch = createAuthorityDispatch(2), started = [], releases = new Map();
  let active = 0, peak = 0;
  const work = async id => {
    started.push(id); peak = Math.max(peak, ++active);
    await new Promise(resolve => releases.set(id, resolve)); active--; return id;
  };
  const first = dispatch([0, 1, 2], work), second = dispatch([3, 4], work);
  await turn(); assert.deepEqual(started, [0, 1]);
  releases.get(1)(); await turn(); assert.deepEqual(started, [0, 1, 2]);
  releases.get(2)(); await turn(); releases.get(3)(); await turn();
  releases.get(4)(); releases.get(0)();
  assert.deepEqual(await first, [0, 1, 2]); assert.deepEqual(await second, [3, 4]);
  assert.equal(peak, 2); assert.equal(active, 0);
});

test('waiting candidates do not start source timers; one timed-out source does not expire queued jobs', async () => {
  const dispatch = createAuthorityDispatch(1);
  const results = await dispatch([0, 1, 2], id => askSource('registry', () => id === 0
    ? new Promise(() => {}) : `fingerprint-${id}`, { timeoutMs: 30 }));
  assert.equal(results[0].outcome, 'timeout'); assert.equal(results[0].value, null);
  assert.deepEqual(results.slice(1).map(r => r.value), ['fingerprint-1', 'fingerprint-2']);
  assert.ok(results.slice(1).every(r => r.outcome === 'answered'));
});

test('rejected work releases capacity and rejected/aborted sources remain uncheckable', async () => {
  const dispatch = createAuthorityDispatch(1);
  await assert.rejects(dispatch([1], () => { throw Error('unexpected work error'); }));
  const answers = await dispatch([1, 2], id => askSource('registry', () => {
    if (id === 1) throw new SourceError('registry', 'timeout');
    throw new DOMException('aborted', 'AbortError');
  }));
  assert.deepEqual(answers.map(a => a.value), [null, null]);
  assert.deepEqual(answers.map(a => a.outcome), ['timeout', 'source_unavailable']);
});

test('concurrency accepts only finite positive bounded integers and defaults to 16', () => {
  assert.equal(concurrency(), 16); assert.equal(DEFAULT_CONCURRENCY, 16);
  assert.equal(concurrency('32'), 32);
  for (const value of [0, -1, 1.5, 33, NaN, Infinity, null, '', '16.0', '1e1', ' 16', 'any', true])
    assert.throws(() => createAuthorityDispatch(value), /invalid MARKETPLACE_AUTHORITY_CONCURRENCY/);
});
