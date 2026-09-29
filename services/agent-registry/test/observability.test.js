const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDependencies, bounded } = require('../dependency-health');
const { log, safeId } = require('../telemetry');
test('health probes both live dependencies and rejects disconnected Redis', async () => {
  let pings = 0;
  const pg = { health: async () => {} };
  const redis = { isReady: true, ping: async () => { pings++; return 'PONG'; } };
  assert.deepEqual(await checkDependencies(pg, redis), { postgres: 'ok', redis: 'ok' });
  assert.equal(pings, 1);
  redis.isReady = false;
  await assert.rejects(checkDependencies(pg, redis));
  redis.isReady = true;
  await assert.rejects(checkDependencies({ health: async () => { throw Error('private'); } }, redis));
});
test('dependency timeout is bounded', async () => {
  await assert.rejects(bounded(() => new Promise(() => {}), 10), /timeout/);
});
test('telemetry allowlist excludes raw error bodies and credentials', () => {
  const previous = console.log;
  let output;
  console.log = text => { output = text; };
  try {
    log('agent-registry', 'request_failed', { correlationId: 'test-1', error: Error('SECRET'), body: 'SECRET', authorization: 'SECRET' });
    assert.ok(!output.includes('SECRET'));
    assert.equal(JSON.parse(output).correlationId, 'test-1');
    assert.ok(safeId('private\nvalue').startsWith('sha256:'));
  } finally { console.log = previous; }
});

test('HTTP health and dependency errors retain correlation without serializing private errors', async t => {
  const http = require('node:http');
  const { createApp } = require('../app');
  const lines = [];
  const previous = console.log;
  console.log = line => lines.push(line);
  t.after(() => { console.log = previous; });
  const fail = async () => { throw Error('CANARY_DEPENDENCY_SECRET'); };
  const server = http.createServer(createApp({ service: { health: fail, register: fail } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(base + '/health', { headers: { 'x-correlation-id': 'dependency-health-test' } });
  assert.equal(health.status, 503);
  const response = await fetch(base + '/v1/registrations?secret=CANARY_QUERY', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-correlation-id': 'dependency-error-test' },
    body: '{"privatePrompt":"CANARY_BODY"}',
  });
  assert.equal(response.status, 500);
  assert.ok(!lines.join('\n').includes('CANARY_'));
  const records = lines.map(line => JSON.parse(line));
  assert.ok(records.some(r => r.correlationId === 'dependency-error-test' && r.statusCode === 500));
});
