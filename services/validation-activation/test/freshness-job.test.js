'use strict';

// The scheduled source check (assurance audit C5): the service fetches each
// pinned source itself, and a change it detects is recorded for a person to
// classify. These tests use a fake fetch; a live run is the job itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { observeSource, pageText, runFreshnessJob } = require('../src/freshness-job');
const { createApp } = require('../src');

const refunds = structuredClone(require('../../curriculum-engine/examples/customer-refunds-candidate'));
const crd = refunds.sources.find((source) => source.id === 'crd-2011-83');
const crdSections = refunds.sourceSections.filter((section) => section.sourceId === 'crd-2011-83');
const pdfSource = { id: 'doc', snapshotKind: 'pdf', snapshotUrl: 'https://publisher.example/doc.pdf',
  contentSha256: createHash('sha256').update('pinned bytes').digest('hex') };

// A fetch that serves the given body per URL, as HTML pages wrap their text in markup.
const fakeFetch = (bodies) => async (url) => {
  if (!Object.hasOwn(bodies, url)) return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
  const bytes = Buffer.from(bodies[url]);
  return { ok: true, status: 200, headers: new Map([['content-length', String(bytes.length)]]), arrayBuffer: async () => bytes };
};
const asPage = (text) => `<html><body><div class="LegP1"><p>${text.replace(/’/g, '&#8217;').replace(/‘/g, '&#x2018;')}</p></div><script>var x = 1;</script></body></html>`;
const pagesWith = (sections) => Object.fromEntries(crdSections.map((section) => [section.url, asPage(sections.includes(section.id) ? section.text : 'Article repealed.')]));

test('page text drops markup and scripts and decodes entities, so a stored section matches its live page', () => {
  assert.equal(pageText('<p>a&amp;b</p><script>evil()</script><span>&#8216;x&#x2019;&nbsp;y</span>'), 'a&b ‘x’ y');
});

test('a PDF is unchanged only while its bytes still match the pinned SHA-256', async () => {
  assert.equal((await observeSource(pdfSource, [], fakeFetch({ [pdfSource.snapshotUrl]: 'pinned bytes' }))).status, 'unchanged');
  const changed = await observeSource(pdfSource, [], fakeFetch({ [pdfSource.snapshotUrl]: 'corrected edition' }));
  assert.deepEqual([changed.status, changed.contentSha256 === pdfSource.contentSha256], ['changed', false]);
});

test('a legislation source is unchanged while every stored section is still on its page, and names the ones that are not', async () => {
  assert.equal((await observeSource(crd, crdSections, fakeFetch(pagesWith(['crd-art9-1', 'crd-art13-1'])))).status, 'unchanged');
  const changed = await observeSource(crd, crdSections, fakeFetch(pagesWith(['crd-art9-1'])));
  assert.deepEqual([changed.status, changed.missingSectionIds], ['changed', ['crd-art13-1']]);
});

async function withApp(bodies, fn) {
  const pkg = { ...refunds, id: 'customer-refunds', version: refunds.manifest.version, state: 'Active', digest: 'f'.repeat(64) };
  const checks = [];
  const evidence = [];
  const packageDb = {
    getActivePackages: async () => [structuredClone(pkg)],
    getPackage: async (id) => (id === pkg.id ? structuredClone(pkg) : null),
    getFreshnessChecks: async () => structuredClone(checks),
    appendFreshnessCheck: async (id, version, record) => { checks.push(structuredClone(record)); },
    appendEvidence: async (id, entry) => { evidence.push({ id, ...structuredClone(entry) }); },
    appendScopeEvent: async () => { throw new Error('the job never quarantines'); },
    seedPackage: async () => { throw new Error('the job never creates a candidate'); },
  };
  const app = createApp({ packageDb, internalKey: 'k', now: () => new Date('2026-11-16T12:00:00Z'), fetchImpl: fakeFetch(bodies) });
  await fn({ app, checks, evidence });
}

test('the job records unchanged sources, records a change as Watch for a person, and skips what it cannot fetch', async () => {
  const bodies = { ...pagesWith(['crd-art9-1']), ...Object.fromEntries(refunds.sourceSections.filter((s) => s.sourceId === 'gdpr').map((s) => [s.url, asPage(s.text)])) };
  await withApp(bodies, async ({ app, checks }) => {
    const report = await app.locals.runFreshness();
    assert.deepEqual(report.map((line) => [line.sourceId, line.result, line.classification]),
      [['crd-2011-83', 'changed', 'Watch'], ['gdpr', 'unchanged', 'No Change'], ['refund-policy-sample', 'not_fetchable', undefined]]);
    assert.equal(checks.length, 2);
    assert.match(checks[0].evidence.summary, /sections not found: crd-art13-1/);
    assert.equal(checks[0].actor, 'freshness-job');
    // Checked today, so the fetched sources are not due on the next run; the embedded policy never is checked.
    assert.deepEqual((await app.locals.runFreshness()).map((line) => line.result), ['not_due', 'not_due', 'not_fetchable']);
  });
});

test('an unreachable source records nothing and is retried on the next run', async () => {
  await withApp({}, async ({ app, checks }) => {
    const report = await app.locals.runFreshness();
    assert.deepEqual(report.filter((line) => line.result === 'unreachable').map((line) => line.sourceId), ['crd-2011-83', 'gdpr']);
    assert.equal(checks.length, 0);
  });
});

test('only an admin may trigger a run through the route', async () => {
  await withApp({}, async ({ app }) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const post = (role) => fetch(`http://127.0.0.1:${server.address().port}/freshness/run`, { method: 'POST',
        headers: { 'x-internal-service-key': 'k', 'x-actor-subject': 'someone', 'x-actor-role': role } });
      assert.equal((await post('reviewer')).status, 403);
      const ran = await post('admin');
      assert.equal(ran.status, 200);
      assert.ok(Array.isArray((await ran.json()).sources));
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
