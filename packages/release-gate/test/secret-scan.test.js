'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanTrackedFiles } = require('../src/secret-scan');

const file = (path, text = '') => ({ path, text });
const rules = (findings) => findings.map((finding) => `${finding.path}:${finding.rule}`);

test('a clean tree has no findings', () => {
  assert.deepEqual(scanTrackedFiles([file('README.md', 'Run node scripts/setup-dev.js')]), []);
});

test('committed environment files and key files are refused by path', () => {
  const findings = scanTrackedFiles([
    file('.env'), file('services/x/.env.local'), file('.env.example'),
    file('keys/dev-jwt-private.pem'), file('certs/signing.key'), file('docs/keys.md'),
  ]);
  assert.deepEqual(rules(findings), [
    '.env:environment-file', 'services/x/.env.local:environment-file',
    'keys/dev-jwt-private.pem:key-file', 'certs/signing.key:key-file',
  ]);
});

test('private key blocks, tokens and provider keys are refused by content', () => {
  const header = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const jwt = ['eyJhbGciOiJFZERTQSJ9', 'eyJzdWIiOiJhZ2VudC0xIn0', 'c2lnbmF0dXJlLXNpZ25hdHVyZS0xMjM0'].join('.');
  const findings = scanTrackedFiles([
    file('a.js', `const k = \`${header}\`;`),
    file('b.json', `{"jws":"${jwt}"}`),
    file('c.md', `key: ${'sk-'}${'a'.repeat(24)}`),
  ]);
  assert.deepEqual(rules(findings), ['a.js:private-key-block', 'b.json:signed-token', 'c.md:provider-api-key']);
  assert.equal(findings[1].line, 1);
});

test('findings never repeat the secret value', () => {
  const value = `${'ghp_'}${'b'.repeat(36)}`;
  const [finding] = scanTrackedFiles([file('notes.md', `token ${value}`)]);
  assert.equal(JSON.stringify(finding).includes(value), false);
});

test('example environment secrets must be empty or marked example-only', () => {
  const findings = scanTrackedFiles([file('.env.example', [
    'POSTGRES_PASSWORD=example-only-postgres-0123',
    'OPENCODE_API_KEY=',
    'ADMIN_CLIENT_SECRET=hunter2-reused-demo',
    'CERTIFICATION_KEY_ID=https://eduagentx.example/issuers/test#k1',
    'JWT_PRIVATE_KEY_PATH=/app/keys/dev-jwt-private.pem',
    'JWT_ACCESS_TOKEN_TTL_SECONDS=900',
    "GRAFANA_ADMIN_PASSWORD='quoted-real-value'",
  ].join('\n'))]);
  assert.deepEqual(findings.map((finding) => [finding.line, finding.rule]), [
    [3, 'non-placeholder-secret'], [7, 'non-placeholder-secret'],
  ]);
});

test('compose files may only reference secrets through variables', () => {
  const findings = scanTrackedFiles([file('docker-compose.yml', [
    '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
    '      ADMIN_CLIENT_SECRET: ${ADMIN_CLIENT_SECRET:?Run setup}',
    '      CREDENTIAL_PUBLIC_KEY_PATH: /keys/public.pem',
    '      GRADING_SERVICE_KEY: literal-shared-value',
  ].join('\n'))]);
  assert.deepEqual(findings.map((finding) => [finding.line, finding.rule]), [[4, 'non-placeholder-secret']]);
});
