const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const trace = {
  outcome: 'configuration_changed',
  registration: {
    agentLearnerId: '00000000-0000-4000-8000-000000000001',
    agentLearnerKey: 'console-test-agent',
    configurationVersion: 2,
    configurationFingerprint: 'sha256:configured-fingerprint',
  },
  assurance: {
    eventId: '00000000-0000-4000-8000-000000000002',
    eventType: 'agent_learner.configuration_changed',
    correlationId: 'registration-correlation',
  },
};

test('console renders authoritative trace evidence and exposes no mutation route', async (t) => {
  const gatewayRequests = [];
  const gateway = http.createServer((req, res) => {
    gatewayRequests.push({ method: req.method, path: req.url });
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && req.url === '/v1/auth/tokens') {
      return json(res, 200, { accessToken: 'console-admin-token' });
    }
    if (req.method === 'GET' && req.url === '/v1/admin/registration-traces/latest') {
      if (req.headers.authorization !== 'Bearer console-admin-token') return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { apiVersion: 'v1', trace });
    }
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => gateway.close());

  const previousGatewayUrl = process.env.API_GATEWAY_URL;
  const previousAdminId = process.env.ADMIN_CLIENT_ID;
  const previousAdminSecret = process.env.ADMIN_CLIENT_SECRET;
  process.env.API_GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  process.env.ADMIN_CLIENT_ID = 'console-admin';
  process.env.ADMIN_CLIENT_SECRET = 'console-secret';
  t.after(() => {
    if (previousGatewayUrl === undefined) delete process.env.API_GATEWAY_URL;
    else process.env.API_GATEWAY_URL = previousGatewayUrl;
    if (previousAdminId === undefined) delete process.env.ADMIN_CLIENT_ID;
    else process.env.ADMIN_CLIENT_ID = previousAdminId;
    if (previousAdminSecret === undefined) delete process.env.ADMIN_CLIENT_SECRET;
    else process.env.ADMIN_CLIENT_SECRET = previousAdminSecret;
  });

  const { app } = require('../index');
  const consoleServer = http.createServer(app);
  await new Promise((resolve) => consoleServer.listen(0, '127.0.0.1', resolve));
  t.after(() => consoleServer.close());

  const page = await request(consoleServer, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /configuration_changed/);
  assert.match(page.body, /sha256:configured-fingerprint/);
  assert.match(page.body, /registration-correlation/);

  const traceResponse = await request(consoleServer, 'GET', '/api/registration-trace');
  assert.equal(traceResponse.status, 200);
  assert.equal(traceResponse.body.status, 'available');
  assert.equal(traceResponse.body.trace.assurance.correlationId, 'registration-correlation');

  const mutation = await request(consoleServer, 'POST', '/api/registration-trace');
  assert.equal(mutation.status, 404);
  assert.equal(gatewayRequests.some((item) => item.path.startsWith('/v1/registrations')), false);
});

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function request(server, method, path) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          let body = raw;
          try { body = JSON.parse(raw); } catch {}
          resolve({ status: response.statusCode, body });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}
