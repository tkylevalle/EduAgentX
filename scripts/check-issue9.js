'use strict';

// Live, non-destructive Candidate contract check against the local Compose stack.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sample = require('../services/curriculum-engine/examples/ai-safety-candidate');
const { sha256 } = require('../services/curriculum-engine/model');
const { Pool } = require('../services/curriculum-engine/node_modules/pg');

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = `http://127.0.0.1:${env.GATEWAY_PORT || 8080}`;
async function request(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
  return { status: response.status, body: await response.json() };
}
async function token(role) {
  const prefix = role === 'admin' ? 'ADMIN' : 'AGENT';
  const result = await request('/v1/auth/tokens', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: env[`${prefix}_CLIENT_ID`], clientSecret: env[`${prefix}_CLIENT_SECRET`] }),
  });
  assert.equal(result.status, 200);
  return result.body.accessToken;
}
async function main() {
  const admin = await token('admin'), agent = await token('agent');
  const url = `/v1/admin/packages/${sample.manifest.packageId}/${sample.manifest.version}`;
  const options = (jwt, body) => ({
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await request(url)).status, 401, 'anonymous cannot inspect Candidate');
  assert.equal((await request(url, { headers: { authorization: `Bearer ${agent}` } })).status, 403, 'agent cannot inspect Candidate');
  assert.equal((await request('/v1/admin/packages', options(agent, sample))).status, 403, 'agent cannot ingest Candidate');
  const first = await request('/v1/admin/packages', options(admin, sample));
  assert.ok([200, 201].includes(first.status), JSON.stringify(first.body));
  assert.equal(first.body.state, 'Candidate');
  const replay = await request('/v1/admin/packages', options(admin, sample));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay, true);
  const changed = structuredClone(sample);
  changed.modules[0].content += ' Changed draft text.';
  changed.modules[0].contentSha256 = sha256({
    content: changed.modules[0].content, deliveryItems: changed.modules[0].deliveryItems,
  });
  changed.manifest.modulePins[0].sha256 = sha256(changed.modules[0]);
  assert.equal((await request('/v1/admin/packages', options(admin, changed))).status, 409,
    'same ID/version cannot be replaced');
  const read = await request(url, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(read.status, 200);
  assert.equal(read.body.state, 'Candidate');
  assert.equal(read.body.digest, sha256(sample));
  const events = await request(`${url}/events`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.events.map((event) => event.state), ['Candidate']);
  const pool = new Pool({ connectionString: `postgres://curriculum_owner:${env.CURRICULUM_DB_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT || 5432}/${env.POSTGRES_DB}` });
  try {
    await assert.rejects(
      pool.query('UPDATE curriculum_engine.packages SET domain=domain WHERE package_id=$1 AND version=$2',
        [sample.manifest.packageId, sample.manifest.version]),
      (error) => error.code === 'P0001', 'stored package must be immutable'
    );
    await assert.rejects(
      pool.query('DELETE FROM curriculum_engine.package_lifecycle_events WHERE package_id=$1 AND version=$2',
        [sample.manifest.packageId, sample.manifest.version]),
      (error) => error.code === 'P0001', 'lifecycle evidence must be append-only'
    );
    await assert.rejects(
      pool.query('SELECT * FROM agent_registry.agent_learners LIMIT 1'),
      (error) => error.code === '42501', 'curriculum role cannot read Registry data'
    );
  } finally { await pool.end(); }
  process.stdout.write('Issue #9 live check passed: authorization, Candidate storage/read, replay, immutable version and events, separate database role.\n');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
