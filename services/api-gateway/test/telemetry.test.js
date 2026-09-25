const test = require('node:test');
const assert = require('node:assert/strict');
const { log } = require('../telemetry');
test('gateway log allowlist never serializes credentials or raw errors', () => {
  const previous = console.log;
  let output;
  console.log = text => { output = text; };
  try {
    log('api-gateway', 'upstream_failed', { correlationId: 'test-1', error: Error('SECRET'), body: 'SECRET', authorization: 'SECRET' });
    assert.ok(!output.includes('SECRET'));
    assert.equal(JSON.parse(output).correlationId, 'test-1');
  } finally { console.log = previous; }
});
