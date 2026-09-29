const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayProtocolClient } = require('./gateway-client');

test('reuses valid tokens and refreshes near-expiry or expired tokens', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  let tokenRequests = 0;
  Date.now = () => now;

  try {
    const client = new GatewayProtocolClient({
      gatewayUrl: 'http://test.invalid',
      clientId: 'test-client',
      clientSecret: 'test-only',
      fetchImpl: async () => ({
        status: 200,
        headers: {},
        text: async () => JSON.stringify({
          accessToken: `test-token-${++tokenRequests}`,
          expiresIn: 900,
        }),
      }),
    });

    const first = await client.getAccessToken('refresh-test', 5000);
    assert.equal(tokenRequests, 1);

    now += 60_000;
    assert.equal(await client.getAccessToken('refresh-test', 5000), first);
    assert.equal(tokenRequests, 1, 'valid token should be reused');

    now += 810_000;
    const refreshed = await client.getAccessToken('refresh-test', 5000);
    assert.notEqual(refreshed, first);
    assert.equal(tokenRequests, 2, 'refresh before expiry');

    now += 901_000;
    assert.notEqual(
      await client.getAccessToken('refresh-test', 5000),
      refreshed
    );
    assert.equal(tokenRequests, 3, 'replace expired token');
  } finally {
    Date.now = originalNow;
  }
});
