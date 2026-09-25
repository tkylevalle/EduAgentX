const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'health-agent';
process.env.AGENT_CLIENT_SECRET = 'local-test';
process.env.ADMIN_CLIENT_ID = 'health-admin';
process.env.ADMIN_CLIENT_SECRET = 'local-test';
const { createApp } = require('../index');
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); }
test('gateway health follows live registry state and auth readiness without exposing errors', async t => {
  let healthy = true;
  const registry = http.createServer((req, res) => {
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthy ? { dependencies: { postgres: 'ok', redis: 'ok' } } : { error: 'PRIVATE_DEPENDENCY_ERROR' }));
  });
  await listen(registry);
  t.after(() => { registry.closeAllConnections(); registry.close(); });
  const gateway = http.createServer(createApp({ agentRegistryUrl: `http://127.0.0.1:${registry.address().port}` }));
  await listen(gateway);
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  const url = `http://127.0.0.1:${gateway.address().port}/health`;
  let response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dependencies.redis, 'ok');
  healthy = false;
  response = await fetch(url);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('PRIVATE_DEPENDENCY_ERROR'));
  healthy = true;
  process.env.ADMIN_CLIENT_SECRET = '';
  response = await fetch(url);
  assert.equal(response.status, 503);
});
