// Generate checkout-local credentials without printing them or replacing user values.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, generateKeyPairSync } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
let content = fs.readFileSync(fs.existsSync(target) ? target : path.join(root, '.env.example'), 'utf8');
for (const name of ['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'CURRICULUM_DB_PASSWORD', 'CURRICULUM_INTERNAL_KEY', 'TRAINING_DB_PASSWORD', 'TRAINING_INTERNAL_KEY', 'EXAMINATION_DB_PASSWORD', 'EXAMINATION_INTERNAL_KEY', 'CERTIFICATION_DB_PASSWORD', 'CERTIFICATION_INTERNAL_KEY', 'MARKETPLACE_DB_PASSWORD', 'MARKETPLACE_INTERNAL_KEY', 'SKILL_GAP_DB_PASSWORD', 'SKILL_GAP_INTERNAL_KEY', 'EXAMINATION_GRADING_KEY', 'GRADING_SERVICE_KEY', 'CREDENTIAL_INTERNAL_KEY', 'AGENT_CLIENT_SECRET', 'LIVE_AGENT_CLIENT_SECRET', 'SYNTHETIC_EXECUTOR_CLIENT_SECRET', 'ADMIN_CLIENT_SECRET', 'REVIEWER_1_CLIENT_SECRET', 'REVIEWER_2_CLIENT_SECRET', 'GRAFANA_ADMIN_PASSWORD']) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const existing = content.match(pattern);
  if (existing && existing[1].trim()) continue;
  const line = `${name}=${randomBytes(32).toString('hex')}`;
  content = existing ? content.replace(pattern, line) : content.trimEnd() + '\n' + line + '\n';
}
// Checkouts made before the separate test issuer keep their other values.
for (const [name, previous, current] of [
  ['CERTIFICATION_KEY_ID', 'https://eduagentx.example/issuers/eduagentx#dev-ed25519-1', 'https://eduagentx.example/issuers/eduagentx-test#test-ed25519-1'],
  ['CERTIFICATION_PRIVATE_KEY_PATH', '/app/keys/certification-ed25519-private.pem', '/app/keys/certification-test-ed25519-private.pem'],
  ['CERTIFICATION_ISSUER', 'https://eduagentx.example/issuers/eduagentx', 'https://eduagentx.example/issuers/eduagentx-test'],
]) content = content.replace(new RegExp(`^${name}=${escapeRegExp(previous)}$`, 'm'), `${name}=${current}`);
for (const [name, value, unset] of [
  ['SYNTHETIC_EXECUTOR_CLIENT_ID', 'synthetic-executor-dev', ''],
  ['EXECUTION_PRINCIPALS', `'[{"subject":"synthetic-executor-dev","evidenceMode":"synthetic","sources":["synthetic:competent:safe-escalation"]}]'`, '[]'],
]) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const existing = content.match(pattern);
  if (existing && existing[1].trim() && existing[1].trim() !== unset) continue;
  const line = `${name}=${value}`;
  content = existing ? content.replace(pattern, () => line) : content.trimEnd() + '\n' + line + '\n';
}
fs.writeFileSync(target, content, { mode: 0o600 });
const keys = path.join(root, 'keys');
fs.mkdirSync(keys, { recursive: true, mode: 0o700 });
const privatePath = path.join(keys, 'certification-ed25519-private.pem');
if (!fs.existsSync(privatePath)) {
  const pair = generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(keys, 'certification-ed25519-public.pem'),
    pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
}
const testPrivatePath = path.join(keys, 'certification-test-ed25519-private.pem');
if (!fs.existsSync(testPrivatePath)) {
  const pair = generateKeyPairSync('ed25519');
  fs.writeFileSync(testPrivatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(keys, 'certification-test-ed25519-public.pem'),
    pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
}
require('./generate-test-keys');
