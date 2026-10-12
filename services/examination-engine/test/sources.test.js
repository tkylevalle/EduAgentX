'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSources, DependencyError } = require('../sources');

test('owned HTTP sources use service keys and exact completion query, with fail-closed contracts', async (t) => {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/packages/active') return res.end(JSON.stringify({ packageId: 'pkg', version: '1', digest: 'd' }));
    if (req.url.startsWith('/v1/registrations?')) return res.end(JSON.stringify({
      registration: { agentLearnerKey: 'a b', configurationFingerprint: 'f' },
    }));
    if (req.url.startsWith('/internal/completions/latest?')) return res.end(JSON.stringify({
      completion: { eventId: 'e', agentLearnerKey: 'a b' },
    }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sources = createSources({ validationUrl: base, registryUrl: base, trainingUrl: base,
    curriculumKey: 'curriculum-key', trainingKey: 'training-key' });
  assert.equal((await sources.activePackage('corr')).packageId, 'pkg');
  assert.equal((await sources.registration('a b', 'corr')).configurationFingerprint, 'f');
  assert.equal((await sources.completion('a b', { packageId: 'pkg', version: '1', digest: 'd' }, 'corr')).eventId, 'e');
  assert.equal(calls[0].headers['x-internal-service-key'], 'curriculum-key');
  assert.equal(calls[2].headers['x-internal-service-key'], 'training-key');
  assert.ok(calls[2].url.includes('agentLearnerKey=a+b'));
  assert.ok(calls[2].url.includes('packageDigest=d'));

  const broken = createSources({ validationUrl: 'http://127.0.0.1:1', registryUrl: base, trainingUrl: base,
    curriculumKey: 'curriculum-key', trainingKey: 'training-key' });
  await assert.rejects(broken.activePackage('corr'), DependencyError);
});
