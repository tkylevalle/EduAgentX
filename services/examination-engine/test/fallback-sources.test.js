'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { DependencyError } = require('../sources');
const { createFallbackSelect } = require('../fallback-sources');

const PKG = { packageId: candidate.manifest.packageId, version: candidate.manifest.version, digest: 'd'.repeat(64) };
const REASON = 'standard_grading_unavailable';

// Same projection as validation-activation's POST /fallback/select.
function selection(overrides = {}) {
  const bank = candidate.fallbackBank;
  return JSON.parse(JSON.stringify({ packageId: PKG.packageId, bankId: bank.id, bankVersion: bank.version,
    scoringPolicy: bank.scoringPolicy, attemptId: randomUUID(), mode: 'fallback',
    items: bank.items.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })),
    ...overrides }));
}

// Local stub only: each test sets reply(req, res) to answer, or not answer, the call.
async function stub(t) {
  const ctx = { calls: [], reply: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      ctx.calls.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      ctx.reply(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // A hanging handler keeps its socket open, so close connections explicitly.
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  ctx.select = createFallbackSelect({ validationUrl: `http://127.0.0.1:${server.address().port}`,
    curriculumKey: 'curriculum-key', timeoutMs: 200 });
  return ctx;
}
const json = (status, body) => (_req, res) => {
  res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));
};

test('a valid 15-item selection is returned bound to the caller\'s package version and digest', async (t) => {
  const ctx = await stub(t);
  const body = selection();
  ctx.reply = json(200, body);
  const result = await ctx.select({ pkg: PKG, reason: REASON, correlationId: 'corr-1' });
  assert.deepEqual(result.selection, body);
  assert.deepEqual([result.packageVersion, result.packageDigest], [PKG.version, PKG.digest]);
  const [call] = ctx.calls;
  assert.deepEqual([call.method, call.url], ['POST', '/fallback/select']);
  assert.deepEqual(call.body, { package_id: PKG.packageId, reason: REASON });
  assert.deepEqual([call.headers['x-internal-service-key'], call.headers['x-actor-subject'], call.headers['x-correlation-id']],
    ['curriculum-key', 'examination-engine', 'corr-1']);
  // A package object using id instead of packageId is sent the same way.
  await ctx.select({ pkg: { id: PKG.packageId, version: PKG.version, digest: PKG.digest }, reason: REASON });
  assert.equal(ctx.calls[1].body.package_id, PKG.packageId);
});

test('a 409 quarantine refusal is a distinct refusal carrying the upstream error, not a DependencyError', async (t) => {
  const ctx = await stub(t);
  ctx.reply = json(409, { error: 'fallback_scope_quarantined' });
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), (error) => {
    assert.equal(error instanceof DependencyError, false);
    assert.deepEqual([error.code, error.status, error.upstreamStatus, error.source],
      ['fallback_scope_quarantined', 409, 409, 'validation-activation']);
    return true;
  });
  for (const code of ['fallback_not_prevalidated', 'fallback_manifest_pin_mismatch', 'fallback_requires_active_package']) {
    ctx.reply = json(409, { error: code });
    await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), { code, upstreamStatus: 409 });
  }
  ctx.reply = json(404, { error: 'package_not_found' });
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), { code: 'package_not_found', status: 409, upstreamStatus: 404 });
});

test('a 200 with only 14 items is rejected despite the success status', async (t) => {
  const ctx = await stub(t);
  const body = selection();
  body.items.pop();
  ctx.reply = json(200, body);
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), (error) => {
    assert.equal(error instanceof DependencyError, false);
    assert.deepEqual([error.code, error.upstreamStatus], ['invalid_fallback_selection', 200]);
    assert.ok(error.details.includes('items must contain exactly 15 items'));
    return true;
  });
  ctx.reply = (_req, res) => { res.statusCode = 200; res.end('not json'); };
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), { code: 'invalid_fallback_selection' });
});

test('a 200 for a different package is rejected', async (t) => {
  const ctx = await stub(t);
  ctx.reply = json(200, selection({ packageId: 'another-package' }));
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }),
    { code: 'fallback_package_mismatch', status: 409, upstreamStatus: 200 });
});

test('no response, a refused connection or a 5xx is a DependencyError', async (t) => {
  const ctx = await stub(t);
  ctx.reply = () => {}; // never answers; the 200 ms timeout must fire
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), (error) =>
    error instanceof DependencyError && error.source === 'validation-activation' && error.status === 503);
  ctx.reply = json(503, { error: 'dependency_unavailable' });
  await assert.rejects(ctx.select({ pkg: PKG, reason: REASON }), (error) =>
    error instanceof DependencyError && error.status === 502);
  const unreachable = createFallbackSelect({ validationUrl: 'http://127.0.0.1:1', curriculumKey: 'curriculum-key' });
  await assert.rejects(unreachable({ pkg: PKG, reason: REASON }), DependencyError);
});

test('a package without id, version or digest is refused before any call', async (t) => {
  const ctx = await stub(t);
  ctx.reply = json(200, selection());
  for (const pkg of [null, { ...PKG, digest: '' }, { ...PKG, version: undefined }, { version: PKG.version, digest: PKG.digest }])
    await assert.rejects(ctx.select({ pkg, reason: REASON }), { code: 'active_package_required', status: 409 });
  assert.equal(ctx.calls.length, 0);
  assert.throws(() => createFallbackSelect({ validationUrl: 'http://127.0.0.1:1', curriculumKey: '' }), /curriculum key required/);
});
