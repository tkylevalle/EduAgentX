'use strict';

// Assurance audit F6: in batch mode, authority reads made together share one
// request per source instead of one per candidate, with the same answers.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { askSource, createLifecycleSource, createPackageSource, createVerificationSource } = require('../clients');

async function stub(t, handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, body });
      const [status, answer] = handler(req, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { seen, url: `http://127.0.0.1:${server.address().port}` };
}

const pass = { status: 'PASS', reason: null };
const report = { signature: pass, schema: pass, issuerPolicy: pass, credentialPolicy: pass, overall: 'VALID', reasonCodes: [] };
const candidates = Array.from({ length: 16 }, (_, index) => ({ credentialId: `cred-${index}`, compactJws: `h.p${index}.s` }));

test('sixteen candidates checked together cost one verify request and one status request', async (t) => {
  const upstream = await stub(t, (req, body) => (req.url === '/verify/batch'
    ? [200, { results: body.jws.map(() => ({ httpStatus: 200, report })) }]
    : [200, { statuses: body.credentialIds.map((credentialId, index) => ({ credentialId, status: index === 3 ? 'suspended' : 'active' })) }]));
  const source = createVerificationSource({ baseUrl: upstream.url, timeoutMs: 1000, batch: true });
  const answers = await Promise.all(candidates.map((candidate) => source.verify(candidate)));
  assert.deepEqual(upstream.seen.map((call) => call.url).sort(), ['/status/batch', '/verify/batch']);
  assert.deepEqual(answers[0], { signature: 'valid', schema: 'valid', status: 'active' });
  assert.equal(answers[3].status, 'suspended');
  assert.equal(upstream.seen.find((call) => call.url === '/verify/batch').body.jws.length, 16);
});

test('a failed batch makes every candidate in it uncheckable, never valid', async (t) => {
  const upstream = await stub(t, () => [500, {}]);
  const source = createVerificationSource({ baseUrl: upstream.url, timeoutMs: 1000, batch: true });
  const answers = await Promise.all(candidates.slice(0, 3).map((candidate) => askSource('verification', () => source.verify(candidate))));
  assert.deepEqual(answers.map((answer) => answer.value), [null, null, null]);
});

test('origins are read in one batch and a missing origin is false, as with the single read', async (t) => {
  const upstream = await stub(t, (req, body) => [200, { apiVersion: 'v1', origins: body.credentialIds.map((credentialId) => ({ credentialId, origin: null })) }]);
  const source = createLifecycleSource({ baseUrl: upstream.url, internalKey: 'k', timeoutMs: 1000, batch: true });
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const answers = await Promise.all(ids.map((credentialId) => source.isLifecycleOrigin({ credentialId, compactJws: 'h.p.s' })));
  assert.deepEqual(answers, [false, false]);
  assert.deepEqual(upstream.seen.map((call) => [call.method, call.url]), [['POST', '/internal/credential-origins/batch']]);
});

test('candidates that share a package version share its read', async (t) => {
  const upstream = await stub(t, () => [404, {}]);
  const source = createPackageSource({ baseUrl: upstream.url, internalKey: 'k', timeoutMs: 1000, batch: true });
  await Promise.all([source.getPackage('pkg', '1.0.0'), source.getPackage('pkg', '1.0.0'), source.getPackage('pkg', '2.0.0')]);
  assert.equal(upstream.seen.length, 2);
});
