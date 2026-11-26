'use strict';

// The scheduled source check (assurance audit C5): the service fetches each
// pinned source itself, and a change it detects is recorded for a person to
// classify. These tests use a fake fetch; a live run is the job itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { MAX_SOURCE_BYTES, observeSource, pageText, runFreshnessJob } = require('../src/freshness-job');
const { createApp } = require('../src');

const refunds = structuredClone(require('../../curriculum-engine/examples/customer-refunds-candidate'));
const crd = refunds.sources.find((source) => source.id === 'crd-2011-83');
const crdSections = refunds.sourceSections.filter((section) => section.sourceId === 'crd-2011-83');
const pdfSource = { id: 'doc', snapshotKind: 'pdf', snapshotUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/doc.pdf',
  contentSha256: createHash('sha256').update('pinned bytes').digest('hex') };

// A fetch that serves the given body per URL, as HTML pages wrap their text in
// markup. A body given as { redirect } answers with a redirect to that address.
const fakeFetch = (bodies, requested = []) => async (url) => {
  requested.push(url);
  if (!Object.hasOwn(bodies, url)) return new Response(null, { status: 404 });
  if (bodies[url]?.redirect) return new Response(null, { status: 302, headers: { location: bodies[url].redirect } });
  return new Response(Buffer.from(bodies[url]), { status: 200 });
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

test('a source on a host that publishes no pinned source is never fetched', async () => {
  const requested = [];
  const elsewhere = { ...pdfSource, snapshotUrl: 'https://publisher.example/doc.pdf' };
  await assert.rejects(observeSource(elsewhere, [], fakeFetch({ [elsewhere.snapshotUrl]: 'pinned bytes' }, requested)), /source_host_not_allowed/);
  const internal = { ...pdfSource, snapshotUrl: 'http://169.254.169.254/latest/meta-data' };
  await assert.rejects(observeSource(internal, [], fakeFetch({}, requested)), /source_host_not_allowed/);
  assert.deepEqual(requested, []);
});

test('a redirect is followed only to another allowed host, so an allowed host cannot send the job inward', async () => {
  const moved = 'https://nvlpubs.nist.gov/nistpubs/ai/moved.pdf';
  const followed = await observeSource(pdfSource, [], fakeFetch({ [pdfSource.snapshotUrl]: { redirect: moved }, [moved]: 'pinned bytes' }));
  assert.equal(followed.status, 'unchanged');
  const requested = [];
  await assert.rejects(observeSource(pdfSource, [], fakeFetch({ [pdfSource.snapshotUrl]: { redirect: 'http://127.0.0.1:5432/' } }, requested)),
    /source_host_not_allowed/);
  assert.deepEqual(requested, [pdfSource.snapshotUrl]);
});

test('a body larger than the limit stops being read once it passes the limit', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let pulled = 0;
  // An endless body that does not declare its length.
  const endless = () => new Response(new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(chunk); } }), { status: 200 });
  await assert.rejects(observeSource(pdfSource, [], async () => endless()), /source_too_large/);
  assert.ok(pulled <= MAX_SOURCE_BYTES / chunk.length + 2, `read ${pulled} chunks`);
});

test('a check the store refuses is reported as record_failed with its error, not as a result', async () => {
  const pkg = { id: 'p', version: '1.0.0', sources: [pdfSource], sourceSections: [] };
  const report = await runFreshnessJob({
    packageDb: { getActivePackages: async () => [pkg], getFreshnessChecks: async () => [] },
    record: async () => ({ status: 422, body: { error: 'invalid_source_evidence' } }),
    fetchImpl: fakeFetch({ [pdfSource.snapshotUrl]: 'pinned bytes' }),
  });
  assert.deepEqual(report, [{ packageId: 'p', version: '1.0.0', sourceId: 'doc', result: 'record_failed', status: 422, error: 'invalid_source_evidence' }]);
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

test('a run asked for while one is in flight joins it instead of checking every source twice', async () => {
  let runs = 0;
  const packageDb = { getActivePackages: async () => { runs += 1; return []; } };
  const app = createApp({ packageDb, internalKey: 'k', fetchImpl: fakeFetch({}) });
  const [first, second] = [app.locals.runFreshness(), app.locals.runFreshness()];
  assert.equal(first, second);
  await first;
  assert.equal(runs, 1);
  await app.locals.runFreshness();
  assert.equal(runs, 2, 'a finished run does not block the next one');
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
