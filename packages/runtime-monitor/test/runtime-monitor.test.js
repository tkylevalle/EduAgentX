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

test('a protected customer detail blocks only its own disclosure, not ordinary mail to the same domain', () => {
  const check = (body) => evaluateCall(manifest, { tool: 'send_reply', args: { to: 'bob@example.com', body } }, ['dana.reyes@example.com'])
    .findings.map((item) => item.predicate);
  assert.deepEqual(check('Your refund is on its way.'), [], 'a shared domain or a short run of the value is not the value');
  assert.deepEqual(check('Forwarding to DANA . REYES @ example . com'), ['protected-value-disclosed']);
  assert.deepEqual(check(Buffer.from('dana.reyes@example.com').toString('base64')), ['protected-value-disclosed']);
});

test('protected values must be strings long enough to mean something; anything else is refused at start', () => {
  const start = (protectedValues) => createRuntimeMonitor({ manifest: { permittedTools: ['send_reply'], allowedRecipients: [] }, credentialId: 'cred-1',
    protectedValues, send: async () => {} });
  assert.throws(() => start(['']), TypeError, 'an empty value would match every call');
  assert.throws(() => start(['--- ---']), TypeError, 'punctuation alone squashes to nothing');
  assert.throws(() => start(['bob']), /at least/);
  assert.throws(() => start([12345678]), TypeError);
  assert.throws(() => start('not-a-list'), TypeError);
  assert.throws(() => evaluateCall(manifest, { tool: 'send_reply', args: {} }, [null]), TypeError);
  assert.doesNotThrow(() => start([KEY, 'dana.reyes@example.com']));
});

test('a domain entry allows email addresses at that domain only, and a URL entry is compared as a parsed URL', () => {
  const { manifest: scoped } = parseManifest({ permittedTools: ['send_reply'], allowedRecipients: ['@example.com', 'https://payments.example.com/api/',
    'https://status.example.com/now'] });
  const refused = (address) => evaluateTelemetry(scoped, { tool: 'send_reply', addresses: [address], findings: [] }).length > 0;
  assert.equal(refused('dana@example.com'), false);
  assert.equal(refused('Dana@Example.com'), false);
  assert.equal(refused('https://evil.test/x?u=@example.com'), true, 'a URL that ends with the domain is not an address at it');
  assert.equal(refused('dana@mail.example.com'), true, 'a subdomain is another domain');
  assert.equal(refused('dana@example.com.evil.test'), true);
  assert.equal(refused('https://payments.example.com/api/refunds'), false);
  assert.equal(refused('https://payments.example.com/api/../admin'), true, 'the path is compared after the URL resolves it');
  assert.equal(refused('https://payments.example.com@evil.test/api/'), true, 'credentials in a URL do not change its origin');
  assert.equal(refused('http://payments.example.com/api/refunds'), true, 'another scheme is another origin');
  assert.equal(refused('https://status.example.com/now'), false);
  assert.equal(refused('https://status.example.com/now/extra'), true, 'an exact URL entry is not a prefix');
  assert.equal(refused('https://'), true, 'an address that does not parse is refused');
});

test('telemetry with a field the schema does not name is refused', () => {
  const sent = { schemaVersion: 'runtime-telemetry/1.0.0', callId: '0f8fad5b-d9cb-469f-a165-70867728950e', credentialId: 'cred-1', tool: 'send_reply',
    addresses: [], argsDigest: `sha256:${'0'.repeat(64)}`, findings: [], observedAt: '2026-11-16T12:00:00.000Z' };
  assert.ok(parseTelemetry(sent).telemetry);
  assert.deepEqual(parseTelemetry({ ...sent, args: { body: 'x' } }).errors, ['unexpected:args']);
});

test('the monitor loads the predicates alone, not every sandbox domain', () => {
  const loaded = Object.keys(require.cache).filter((file) => /agent-sandbox[\\/]src[\\/]/.test(file)).map((file) => file.split(/[\\/]/).pop());
  assert.deepEqual(loaded, ['predicates.js']);
});
