// Generate checkout-local credentials without printing them or replacing user values.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
let content = fs.readFileSync(fs.existsSync(target) ? target : path.join(root, '.env.example'), 'utf8');
for (const name of ['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'CURRICULUM_DB_PASSWORD', 'CURRICULUM_INTERNAL_KEY', 'TRAINING_DB_PASSWORD', 'TRAINING_INTERNAL_KEY', 'AGENT_CLIENT_SECRET', 'ADMIN_CLIENT_SECRET', 'GRAFANA_ADMIN_PASSWORD']) {
  const pattern = new RegExp(`^${name}=(.*)$`, 'm');
  const existing = content.match(pattern);
  if (existing && existing[1].trim()) continue;
  const line = `${name}=${randomBytes(32).toString('hex')}`;
  content = existing ? content.replace(pattern, line) : content.trimEnd() + '\n' + line + '\n';
}
fs.writeFileSync(target, content, { mode: 0o600 });
require('./generate-test-keys');
