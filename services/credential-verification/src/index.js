'use strict';
const express = require('express');
const fs = require('node:fs');
const { timingSafeEqual } = require('node:crypto');
const { verifyCredential } = require('./verifier');
const { statusStore } = require('./statusStore');

const app = express();
app.use(express.json({ limit: '64kb' }));

// Load public key from env or file
function getPublicKey() {
  if (process.env.CREDENTIAL_PUBLIC_KEY) return process.env.CREDENTIAL_PUBLIC_KEY;
  const keyPath = process.env.CREDENTIAL_PUBLIC_KEY_PATH;
  if (keyPath && fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8');
  return null;
}

function matchesSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(given), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Status changes are trusted commands. When CREDENTIAL_INTERNAL_KEY is set
// (Compose always sets it) only callers holding it may register, suspend,
// reinstate or revoke. Verification and status reads stay open.
function requireInternalKey(req, res, next) {
  const expected = process.env.CREDENTIAL_INTERNAL_KEY;
  if (!expected) return next();
  if (!matchesSecret(req.header('x-internal-service-key'), expected)) return res.status(403).json({ error: 'forbidden' });
  next();
}

// Best effort: the monitoring projection is read-only and never authoritative,
// so a monitoring outage must not block a status change.
function notifyMonitoring(event) {
  const url = process.env.MONITORING_URL;
  if (!url) return;
  fetch(`${url}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...event, source: 'credential-verification' }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'credential-verification', publicKeyConfigured: Boolean(getPublicKey()) });
});

// POST /verify — verify a credential JWS. Status comes only from the store;
// an unknown credential is reported as indeterminate, never as active.
app.post('/verify', (req, res) => {
  const { jws } = req.body || {};
  if (!jws) return res.status(400).json({ error: 'missing_jws' });

  const publicKey = getPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'no_public_key_configured' });

  const report = verifyCredential(jws, publicKey, statusStore);
  const httpStatus = report.overall === 'VALID' ? 200 : report.overall === 'INDETERMINATE' ? 200 : 422;
  res.status(httpStatus).json(report);
});

// POST /status/register — certification-service records a newly issued credential.
app.post('/status/register', requireInternalKey, (req, res) => {
  const { credentialId } = req.body || {};
  if (!credentialId || typeof credentialId !== 'string') return res.status(400).json({ error: 'missing_credentialId' });
  const known = statusStore.isKnown(credentialId);
  statusStore.register(credentialId);
  res.status(known ? 200 : 201).json({ credentialId, status: statusStore.getStatus(credentialId),
    history: statusStore.getHistory(credentialId) });
});

function statusRoute(action, resultingStatus, eventType) {
  return (req, res) => {
    const { credentialId, reason, agentId } = req.body || {};
    if (!credentialId) return res.status(400).json({ error: 'missing_credentialId' });
    try {
      statusStore[action](credentialId, reason);
      if (agentId) notifyMonitoring({ type: eventType, agentId, certificationId: credentialId, reason });
      res.json({ credentialId, status: resultingStatus, history: statusStore.getHistory(credentialId) });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  };
}

// Suspension is reversible; revocation is irreversible.
app.post('/status/suspend', requireInternalKey, statusRoute('suspend', 'suspended', 'credential.suspended'));
app.post('/status/reinstate', requireInternalKey, statusRoute('reinstate', 'active', 'credential.reinstated'));
app.post('/status/revoke', requireInternalKey, statusRoute('revoke', 'revoked', 'credential.revoked'));

// GET /status/:credentialId — get current status + history
app.get('/status/:credentialId', (req, res) => {
  const status = statusStore.getStatus(req.params.credentialId);
  if (status === null) return res.status(404).json({ error: 'not_found', status: 'INDETERMINATE_STATUS' });
  res.json({ credentialId: req.params.credentialId, status, history: statusStore.getHistory(req.params.credentialId) });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4030;
  app.listen(PORT, () => console.log(`[credential-verification] listening on ${PORT}`));
}
module.exports = { app };
