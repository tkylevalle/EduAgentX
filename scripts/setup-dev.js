// Generate checkout-local credentials without printing them or replacing user values.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, generateKeyPairSync } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
let content = fs.readFileSync(fs.existsSync(target) ? target : path.join(root, '.env.example'), 'utf8');
for (const name of ['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'CURRICULUM_DB_PASSWORD', 'CURRICULUM_INTERNAL_KEY', 'TRAINING_DB_PASSWORD', 'TRAINING_INTERNAL_KEY', 'EXAMINATION_DB_PASSWORD', 'EXAMINATION_INTERNAL_KEY', 'CERTIFICATION_DB_PASSWORD', 'CERTIFICATION_INTERNAL_KEY', 'EXAMINATION_GRADING_KEY', 'GRADING_SERVICE_KEY', 'AGENT_CLIENT_SECRET', 'ADMIN_CLIENT_SECRET', 'GRAFANA_ADMIN_PASSWORD']) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const existing = content.match(pattern);
  if (existing && existing[1].trim()) continue;
  const line = `${name}=${randomBytes(32).toString('hex')}`;
  content = existing ? content.replace(pattern, line) : content.trimEnd() + '\n' + line + '\n';
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
require('./generate-test-keys');
