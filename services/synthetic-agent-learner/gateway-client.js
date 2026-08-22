const fetch = require('node-fetch');

class GatewayProtocolError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'GatewayProtocolError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class GatewayProtocolClient {
  constructor({
    gatewayUrl,
    clientId,
    clientSecret,
    fetchImpl = fetch,
    requestTimeoutMs = 60_000,
  } = {}) {
    if (!gatewayUrl) throw new TypeError('gatewayUrl is required');
    if (!clientId || !clientSecret) throw new TypeError('clientId and clientSecret are required');
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.accessToken = null;
  }

  async register(message) {
    return this.send('/v1/agent-learner/registrations', message);
  }

  async interact(message) {
    return this.send('/v1/agent-learner/interactions', message);
  }

  async send(path, message) {
    const accessToken = await this.getAccessToken(message.correlationId);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(message.timeoutMs, this.requestTimeoutMs)
    );

    try {
      const response = await this.fetch(`${this.gatewayUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-agent-protocol-version': message.protocolVersion,
          'x-correlation-id': message.correlationId,
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      return await parseResponse(response);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new GatewayProtocolError('gateway_timeout', 'Gateway request timed out', 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAccessToken(correlationId) {
    if (this.accessToken) return this.accessToken;
    const response = await this.fetch(`${this.gatewayUrl}/v1/auth/tokens`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
    });
    const parsed = await parseResponse(response);
    if (parsed.status < 200 || parsed.status >= 300 || !parsed.body.accessToken) {
      throw new GatewayProtocolError(
        parsed.body.error || 'gateway_authentication_failed',
        'Gateway authentication failed',
        parsed.status
      );
    }
    this.accessToken = parsed.body.accessToken;
    return this.accessToken;
  }
}

async function parseResponse(response) {
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new GatewayProtocolError('invalid_gateway_response', 'Gateway returned invalid JSON', response.status);
  }
  return { status: response.status, headers: response.headers, body };
}

module.exports = { GatewayProtocolClient, GatewayProtocolError, parseResponse };
