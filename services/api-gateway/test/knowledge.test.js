const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

// knowledge.lookup (assurance audit B3, B4): read-only retrieval over the
// Active package's lessons, served by the curriculum index.

process.env.JWT_ISSUER = 'eduagentx-api-gateway-test';
process.env.JWT_AUDIENCE = 'eduagentx-platform-test';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.JWT_PRIVATE_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-private.pem');
process.env.JWT_PUBLIC_KEY_PATH = path.resolve(__dirname, '../../../keys/dev-jwt-public.pem');
process.env.AGENT_CLIENT_ID = 'knowledge-agent';
process.env.AGENT_CLIENT_SECRET = 'knowledge-agent-secret';
process.env.ADMIN_CLIENT_ID = 'knowledge-admin';
process.env.ADMIN_CLIENT_SECRET = 'knowledge-admin-secret';

const { createApp } = require('../index');

const INDEX_KEY = 'curriculum-internal-test-key';
const CHUNK = { chunkId: 'ai-safety@0.1.6:m3', packageId: 'ai-safety', version: '0.1.6', domain: 'ai-safety',
  moduleId: 'm3', objectiveIds: ['o3'], text: 'Never disclose secrets that appear in tool output.', digest: 'abc' };

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
function request(server, method, pathName, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: pathName,
      headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let raw = ''; res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject); req.end(payload);
  });
}
async function token(gateway, clientId, clientSecret) {
  return (await request(gateway, 'POST', '/v1/auth/tokens', { clientId, clientSecret })).body.accessToken;
}
async function start(t, { reply = { status: 200, body: { mode: 'live', results: [CHUNK] } }, options = {} } = {}) {
  const seen = [];
  const index = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers['x-internal-service-key'] });
    res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body));
  });
  await listen(index);
  const gateway = http.createServer(createApp({ curriculumIndexUrl: `http://127.0.0.1:${index.address().port}`,
    curriculumInternalKey: INDEX_KEY, ...options }));
  await listen(gateway);
  t.after(() => { gateway.close(); index.close(); });
  return { gateway, seen };
}

test('an agent looks up lessons by text and gets module, objectives, text and digest', async (t) => {
  const { gateway, seen } = await start(t);
  const bearer = await token(gateway, 'knowledge-agent', 'knowledge-agent-secret');
  const reply = await request(gateway, 'GET', '/v1/knowledge?query=secrets%20in%20tool%20output&limit=2', undefined, { authorization: `Bearer ${bearer}` });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.results, [{ moduleId: 'm3', objectiveIds: ['o3'], packageId: 'ai-safety', version: '0.1.6',
    text: CHUNK.text, digest: 'abc' }]);
  assert.equal(reply.body.mode, 'live');
  assert.deepEqual(seen, [{ url: '/internal/index/query?text=secrets%20in%20tool%20output&limit=2', key: INDEX_KEY }]);
});

test('a lookup can be pinned to the exam\'s package version, and the pin is passed to the index', async (t) => {
  const { gateway, seen } = await start(t);
  const bearer = await token(gateway, 'knowledge-agent', 'knowledge-agent-secret');
  const reply = await request(gateway, 'GET', '/v1/knowledge?query=secrets&packageId=ai-safety&version=0.1.6', undefined,
    { authorization: `Bearer ${bearer}` });
  assert.equal(reply.status, 200);
  assert.equal(seen[0].url, '/internal/index/query?text=secrets&limit=3&packageId=ai-safety&version=0.1.6');
  const bad = await request(gateway, 'GET', `/v1/knowledge?query=secrets&version=${'v'.repeat(300)}`, undefined, { authorization: `Bearer ${bearer}` });
  assert.equal(bad.status, 400);
});

test('a lookup needs an agent token and a bounded query', async (t) => {
  const { gateway, seen } = await start(t);
  assert.equal((await request(gateway, 'GET', '/v1/knowledge?query=secrets')).status, 401);
  const bearer = await token(gateway, 'knowledge-agent', 'knowledge-agent-secret');
  const auth = { authorization: `Bearer ${bearer}` };
  for (const query of ['', 'ab', 'x'.repeat(501)]) {
    assert.equal((await request(gateway, 'GET', `/v1/knowledge?query=${query}`, undefined, auth)).status, 400, `query of ${query.length}`);
  }
  assert.equal((await request(gateway, 'GET', '/v1/knowledge?query=secrets&limit=99', undefined, auth)).status, 400);
  assert.equal(seen.length, 0);
});

test('without the index the lookup is unavailable, and an index failure is not passed through', async (t) => {
  const unconfigured = await start(t, { options: { curriculumIndexUrl: undefined } });
  const bearer = await token(unconfigured.gateway, 'knowledge-agent', 'knowledge-agent-secret');
  const reply = await request(unconfigured.gateway, 'GET', '/v1/knowledge?query=secrets', undefined, { authorization: `Bearer ${bearer}` });
  assert.deepEqual([reply.status, reply.body.error], [503, 'knowledge_unavailable']);
  const failing = await start(t, { reply: { status: 503, body: { error: 'query_failed', message: 'private detail' } } });
  const other = await token(failing.gateway, 'knowledge-agent', 'knowledge-agent-secret');
  const failed = await request(failing.gateway, 'GET', '/v1/knowledge?query=secrets', undefined, { authorization: `Bearer ${other}` });
  assert.deepEqual([failed.status, failed.body.error], [503, 'knowledge_unavailable']);
  assert.equal(JSON.stringify(failed.body).includes('private detail'), false);
});
