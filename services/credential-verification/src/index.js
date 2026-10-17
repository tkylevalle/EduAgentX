'use strict';
const express = require('express');
const fs = require('node:fs');
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'credential-verification' });
});

// POST /verify — verify a credential JWS
app.post('/verify', (req, res) => {
  const { jws, credentialId } = req.body || {};
  if (!jws) return res.status(400).json({ error: 'missing_jws' });

  const publicKey = getPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'no_public_key_configured' });

  // Register credential in status store if provided
  if (credentialId && !statusStore.getStatus(credentialId)) {
    statusStore.register(credentialId);
  }

  const report = verifyCredential(jws, publicKey, credentialId ? statusStore : null);
  const httpStatus = report.overall === 'VALID' ? 200 : report.overall === 'INDETERMINATE' ? 200 : 422;
  res.status(httpStatus).json(report);
});

// POST /status/suspend — reversible suspension
app.post('/status/suspend', (req, res) => {
  const { credentialId, reason } = req.body || {};
  if (!credentialId) return res.status(400).json({ error: 'missing_credentialId' });
  try {
    statusStore.suspend(credentialId, reason);
    res.json({ credentialId, status: 'suspended', history: statusStore.getHistory(credentialId) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// POST /status/reinstate — reverse suspension
app.post('/status/reinstate', (req, res) => {
  const { credentialId, reason } = req.body || {};
  if (!credentialId) return res.status(400).json({ error: 'missing_credentialId' });
  try {
    statusStore.reinstate(credentialId, reason);
    res.json({ credentialId, status: 'active', history: statusStore.getHistory(credentialId) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// POST /status/revoke — irreversible revocation
app.post('/status/revoke', (req, res) => {
  const { credentialId, reason } = req.body || {};
  if (!credentialId) return res.status(400).json({ error: 'missing_credentialId' });
  try {
    statusStore.revoke(credentialId, reason);
    res.json({ credentialId, status: 'revoked', history: statusStore.getHistory(credentialId) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// GET /status/:credentialId — get current status + history
app.get('/status/:credentialId', (req, res) => {
  const status = statusStore.getStatus(req.params.credentialId);
  if (status === null) return res.status(404).json({ error: 'not_found', status: 'INDETERMINATE_STATUS' });
  res.json({ credentialId: req.params.credentialId, status, history: statusStore.getHistory(req.params.credentialId) });
});

const PORT = process.env.PORT || 4030;
app.listen(PORT, () => console.log(`[credential-verification] listening on ${PORT}`));
module.exports = { app };
