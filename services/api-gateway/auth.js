// auth.js - real authN/authZ for the API Gateway (Sprint 1, work package
// "API Gateway, authentication, and contracts").
//
// Design follows the submitted Software Design Document (SEC-01): every
// request must carry a valid JWT, signed RS256, carrying a role claim of
// "agent" or "admin". Admin-only endpoints must reject agent tokens.
// The gateway validates the token's signature against a public key and
// rejects anything absent, malformed, or expired with 401.
//
// This is intentionally a minimal client-credentials-style token issuer,
// not a full OAuth2 server - Sprint 1 only needs one Synthetic Agent
// Learner and one admin identity to prove the contract works end to end.
// Real per-agent identity issuance belongs to Agent Registry (#4) once
// registration exists; this just proves the gateway enforces the contract.

const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_ISSUER = process.env.JWT_ISSUER || 'eduagentx-api-gateway';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'eduagentx-platform';
const ACCESS_TOKEN_TTL_SECONDS = parseInt(process.env.JWT_ACCESS_TOKEN_TTL_SECONDS || '900', 10);

const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH;
const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH;

function readKeyOrThrow(path, label) {
  if (!path) {
    throw new Error(`${label} path not configured (check JWT_*_KEY_PATH env vars)`);
  }
  if (!fs.existsSync(path)) {
    throw new Error(
      `${label} not found at ${path}. Run ./scripts/generate-dev-keys.sh (or 'make up', which does this for you).`
    );
  }
  return fs.readFileSync(path, 'utf8');
}

// keys are loaded lazily (not at module load) so the process can still
// boot and serve /health with a clear error even if keys are missing,
// instead of crashing the whole container on startup.
let cachedPrivateKey = null;
let cachedPublicKey = null;

function privateKey() {
  if (!cachedPrivateKey) cachedPrivateKey = readKeyOrThrow(PRIVATE_KEY_PATH, 'JWT private key');
  return cachedPrivateKey;
}

function publicKey() {
  if (!cachedPublicKey) cachedPublicKey = readKeyOrThrow(PUBLIC_KEY_PATH, 'JWT public key');
  return cachedPublicKey;
}

// registered Sprint 1 client credentials - pre-shared, local/test only.
// Real client provisioning is out of scope for the Sprint 1 skeleton.
function knownClients() {
  return [
    {
      clientId: process.env.AGENT_CLIENT_ID || '',
      clientSecret: process.env.AGENT_CLIENT_SECRET || '',
      role: 'agent',
    },
    {
      clientId: process.env.ADMIN_CLIENT_ID || '',
      clientSecret: process.env.ADMIN_CLIENT_SECRET || '',
      role: 'admin',
    },
  ].filter((c) => c.clientId && c.clientSecret);
}

// constant-time secret comparison so mismatched-length/incorrect secrets
// can't be distinguished by timing.
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // still run a comparison of equal-length buffers to avoid a fast
    // early-exit that leaks length information via timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function findClient(clientId, clientSecret) {
  return knownClients().find(
    (c) => c.clientId === clientId && secretsMatch(c.clientSecret, clientSecret)
  );
}

// POST /v1/auth/tokens handler - exchanges pre-shared client credentials
// for a short-lived RS256 JWT carrying a role claim.
function issueToken(req, res) {
  const { clientId, clientSecret } = req.body || {};

  if (!clientId || !clientSecret || typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'clientId and clientSecret are required',
      correlationId: req.correlationId,
    });
  }

  const client = findClient(clientId, clientSecret);
  if (!client) {
    return res.status(401).json({
      error: 'invalid_client',
      message: 'unknown client or incorrect secret',
      correlationId: req.correlationId,
    });
  }

  let signed;
  try {
    signed = jwt.sign(
      { role: client.role },
      privateKey(),
      {
        algorithm: 'RS256',
        subject: client.clientId,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }
    );
  } catch (err) {
    console.error('[api-gateway] token signing failed', err);
    return res.status(500).json({
      error: 'token_issuance_failed',
      correlationId: req.correlationId,
    });
  }

  res.status(200).json({
    accessToken: signed,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    role: client.role,
    correlationId: req.correlationId,
  });
}

// Express middleware factory: requireRole('agent'), requireRole('admin'),
// or requireRole('agent', 'admin') for endpoints either role may call.
function requireRole(...allowedRoles) {
  return function requireRoleMiddleware(req, res, next) {
    const header = req.header('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'missing or malformed Authorization header',
        correlationId: req.correlationId,
      });
    }

    let payload;
    try {
      payload = jwt.verify(match[1], publicKey(), {
        algorithms: ['RS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch (err) {
      const code = err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
      return res.status(401).json({
        error: code,
        message: err.message,
        correlationId: req.correlationId,
      });
    }

    if (!allowedRoles.includes(payload.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `role '${payload.role}' is not permitted for this endpoint`,
        correlationId: req.correlationId,
      });
    }

    req.auth = { subject: payload.sub, role: payload.role };
    next();
  };
}

module.exports = { issueToken, requireRole };