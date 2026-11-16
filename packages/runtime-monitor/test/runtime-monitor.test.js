'use strict';

// The Runtime Monitor applies the exam's action predicates to production
// tool calls (target design 7.2): checked in the deployment, reported without
// argument values, and re-checked by the service.

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeViolation, createRuntimeMonitor, evaluateCall, evaluateTelemetry, parseManifest, parseTelemetry } = require('..');

const { manifest } = parseManifest({ permittedTools: ['get_order', 'issue_refund', 'send_reply'], internalTools: ['get_order'],
  allowedRecipients: ['@example.com', 'https://payments.example.com/'] });
const KEY = 'protected-test-value-0123456789abcdef0123';

test('a manifest lists tools and recipients; anything else is refused', () => {
  assert.deepEqual(parseManifest({ permittedTools: [], allowedRecipients: [] }).errors, ['permittedTools']);
  assert.deepEqual(parseManifest({ permittedTools: ['x'], allowedRecipients: ['not an address'] }).errors, ['allowedRecipients']);
  assert.deepEqual(parseManifest({ permittedTools: ['x'], allowedRecipients: [], internalTools: ['y'] }).errors, ['internalTools']);
  assert.deepEqual(parseManifest({ permittedTools: ['x'], allowedRecipients: [], extra: 1 }).errors, ['unexpected:extra']);
});

test('a tool outside the manifest, an address outside the list and a protected value leaving are each critical', () => {
  const check = (call) => evaluateCall(manifest, call, [KEY]).findings.map((item) => `${item.predicate}/${item.ruleId}`);
  assert.deepEqual(check({ tool: 'send_reply', args: { to: 'dana@example.com', body: 'Your refund is on its way.' } }), []);
  assert.deepEqual(check({ tool: 'export_orders', args: {} }), ['tool-not-permitted/critical-o4']);
  assert.deepEqual(check({ tool: 'send_reply', args: { to: 'ops@exfil.example', body: 'hi' } }), ['recipient-not-allowed/critical-o4']);
  assert.deepEqual(check({ tool: 'send_reply', args: { to: 'dana@example.com', body: `key ${KEY.toUpperCase().split('').join(' ')}` } }),
    ['protected-value-disclosed/critical-o3']);
  assert.deepEqual(check({ tool: 'get_order', args: { note: KEY } }), [], 'an internal lookup may carry a protected value');
});

test('the SDK reports every call without its arguments, and blocks a critical one before the tool runs', async () => {
  const sent = [];
  let ran = 0;
  const monitor = createRuntimeMonitor({ manifest: { permittedTools: ['send_reply'], allowedRecipients: ['@example.com'] }, credentialId: 'cred-1',
    protectedValues: [KEY], send: async (telemetry) => { sent.push(telemetry); }, now: () => new Date('2026-11-16T12:00:00Z') });
  const sendReply = monitor.wrap('send_reply', async () => { ran += 1; return 'ok'; });
  assert.equal(await sendReply({ to: 'dana@example.com', body: 'Hello' }), 'ok');
  await assert.rejects(sendReply({ to: 'dana@example.com', body: `here: ${KEY}` }), RuntimeViolation);
  assert.equal(ran, 1, 'the blocked call never reached the tool');
  assert.equal(sent.length, 2, 'both calls were reported');
  assert.equal(JSON.stringify(sent).includes(KEY), false, 'no protected value leaves in telemetry');
  assert.equal(JSON.stringify(sent).includes('Hello'), false, 'no argument value leaves in telemetry');
  assert.equal(parseTelemetry(sent[1]).telemetry.findings[0].predicate, 'protected-value-disclosed');
});

test('the service re-checks tool and addresses itself, so a deployment cannot clear its own call', () => {
  const telemetry = { tool: 'export_orders', addresses: ['ops@exfil.example'], findings: [] };
  assert.deepEqual(evaluateTelemetry(manifest, telemetry).map((item) => item.predicate), ['tool-not-permitted', 'recipient-not-allowed']);
  assert.deepEqual(evaluateTelemetry(manifest, { tool: 'send_reply', addresses: ['dana@example.com'], findings: [{ predicate: 'protected-value-disclosed' }] })
    .map((item) => item.predicate), ['protected-value-disclosed'], 'the deployment\'s own disclosure finding is kept');
});
