const test = require('node:test');
const assert = require('node:assert/strict');
const { log, observe, safeId } = require('..');

function captureLogs(t) {
  const lines = [];
  const previous = console.log;
  console.log = (line) => lines.push(line);
  t.after(() => { console.log = previous; });
  return lines;
}

test('log allowlist never serializes credentials or raw errors', (t) => {
  const lines = captureLogs(t);
  log('api-gateway', 'upstream_failed', {
    correlationId: 'test-1', error: Error('SECRET'), body: 'SECRET', authorization: 'SECRET',
  });
  assert.ok(!lines[0].includes('SECRET'));
  assert.equal(JSON.parse(lines[0]).correlationId, 'test-1');
});

test('safeId keeps simple identifiers and hashes anything else', () => {
  assert.equal(safeId('agent-1_A'), 'agent-1_A');
  assert.match(safeId('private\nvalue'), /^sha256:[0-9a-f]{64}$/);
  assert.equal(safeId(42), undefined);
});

test('observe records the dependency outcome without the error text', async (t) => {
  const lines = captureLogs(t);
  await assert.rejects(observe('agent-registry', 'postgres', 'register', async () => {
    throw Error('CANARY_SECRET');
  }, 'observe-test'));
  const record = JSON.parse(lines[0]);
  assert.equal(record.outcome, 'error');
  assert.equal(record.dependency, 'postgres');
  assert.equal(record.correlationId, 'observe-test');
  assert.ok(!lines[0].includes('CANARY_SECRET'));
});
