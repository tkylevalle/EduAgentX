'use strict';
const express = require('express');
const fs = require('node:fs');
const { timingSafeEqual } = require('node:crypto');
const { verifyCredential, TEST_KEY_PREFIX, keyIdOf, trustedIssuers } = require('./verifier');
const { LIST_BITS, PURPOSES, statusListCredential } = require('./status-list');
const { statusStore, StatusTransitionError } = require('./statusStore');
const { createKeyring, issuerJwks } = require('./issuer-keys');

const app = express();
// One credential fits in 64 kB (a credential with behaviour evidence is about
// 34 kB). A verify batch carries many, so only that route takes a larger body;
// Marketplace splits its batches to stay under it (clients.js VERIFY_BATCH_BYTES).
const BODY_LIMIT = '64kb';
const VERIFY_BATCH_BODY_LIMIT = '2mb';
const smallJson = express.json({ limit: BODY_LIMIT });
const batchJson = express.json({ limit: VERIFY_BATCH_BODY_LIMIT });
app.use((req, res, next) => (req.path === '/verify/batch' ? batchJson : smallJson)(req, res, next));

// Load public key from env or file
function getPublicKey() {
  if (process.env.CREDENTIAL_PUBLIC_KEY) return process.env.CREDENTIAL_PUBLIC_KEY;
  const keyPath = process.env.CREDENTIAL_PUBLIC_KEY_PATH;
  if (keyPath && fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8');
  return null;
}

// The credential's validFrom, which decides whether a retired key may verify it.
function issuedAtOf(jws) {
  try { return String(JSON.parse(Buffer.from(String(jws).split('.')[1], 'base64url').toString()).validFrom || ''); }
  catch { return ''; } // A malformed payload fails the signature check that follows.
}

function getTestPublicKey() {
  const keyPath = process.env.CREDENTIAL_TEST_PUBLIC_KEY_PATH;
  return keyPath && fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
}

const logKeysUnavailable = (error) => console.error(`[credential-verification] issuer keys unavailable: ${error.message}`);

// The keys one request verifies with, resolved once: a verify batch checks up
// to 500 credentials against the same few keys. A broken key configuration is
// logged once for the request and every credential in it fails closed.
function requestKeys() {
  let keyring = null;
  try { keyring = createKeyring(process.env, logKeysUnavailable); } catch (error) { logKeysUnavailable(error); }
  const configured = new Map();
  const configuredKey = (test) => {
    if (!configured.has(test)) configured.set(test, test ? getTestPublicKey() : getPublicKey());
    return configured.get(test);
  };
  return { keyring, configuredKey };
}

// A credential's key ID selects its verification key: a published key with
// that id first (a retired one only for credentials issued before it was
// retired), else the configured key for its issuer, so a test-issuer
// credential can never verify with the other key, or the reverse.
function publicKeyFor(jws, { keyring, configuredKey }) {
  // A broken key configuration fails closed (the signature check fails); requestKeys logged it.
  if (!keyring) return null;
  let published = null;
  try {
    published = keyring.publicKeyForKid(keyIdOf(jws), issuedAtOf(jws));
  } catch {
    return null; // An unreadable key file: the keyring logged it on first use; fail closed.
  }
  if (published) return published;
  return configuredKey(keyIdOf(jws).startsWith(TEST_KEY_PREFIX));
}

function matchesSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(given), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Status changes are trusted commands: only callers holding
// CREDENTIAL_INTERNAL_KEY may register, suspend, reinstate or revoke, and
// without a configured key they are refused. Verification and reads stay open.
function requireInternalKey(req, res, next) {
  const expected = process.env.CREDENTIAL_INTERNAL_KEY;
  if (!expected) return res.status(503).json({ error: 'internal_key_not_configured' });
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

// Verifies one credential JWS: { status, body } as /verify answers it. Status
// comes only from the store; an unknown credential is indeterminate, never active.
// keys: from requestKeys(), shared by every credential of the request.
function verifyOne(jws, keys) {
  if (!jws || typeof jws !== 'string') return { status: 400, body: { error: 'missing_jws' } };
  // A credential signed with the status-list key is invalid, whatever it says.
  if (keys.keyring?.isStatusListKid(keyIdOf(jws))) return { status: 422, body: { signature: { status: 'FAIL', reason: 'key_not_for_credentials' },
    overall: 'INVALID', reasonCodes: ['KEY_PURPOSE_MISMATCH'] } };
  const publicKey = publicKeyFor(jws, keys);
  if (!publicKey) return { status: 503, body: { error: 'no_public_key_configured' } };
  const report = verifyCredential(jws, publicKey, statusStore);
  return { status: report.overall === 'VALID' || report.overall === 'INDETERMINATE' ? 200 : 422, body: report };
}

// POST /verify — verify a credential JWS.
app.post('/verify', (req, res) => {
  const { status, body } = verifyOne((req.body || {}).jws, requestKeys());
  res.status(status).json(body);
});

// Batch reads for Marketplace matching (assurance audit F6): one request for a
// whole candidate list instead of one per credential. Same answers as the
// single routes, in input order.
// The size every Marketplace batch read uses (marketplace-service clients.js MAX_BATCH).
const MAX_BATCH = 500;
// One compact JWS in a batch is held to the size the single /verify route takes.
const MAX_JWS_CHARS = 64 * 1024;
const batchOf = (value, maxChars = Infinity) => (Array.isArray(value) && value.length >= 1 && value.length <= MAX_BATCH &&
  value.every((item) => typeof item === 'string' && item && item.length <= maxChars) ? value : null);
app.post('/verify/batch', (req, res) => {
  const jwsList = batchOf((req.body || {}).jws, MAX_JWS_CHARS);
  if (!jwsList) return res.status(400).json({ error: 'invalid_batch', max: MAX_BATCH });
  const keys = requestKeys();
  res.json({ results: jwsList.map((jws) => { const { status, body } = verifyOne(jws, keys); return { httpStatus: status, report: body }; }) });
});
app.post('/status/batch', (req, res) => {
  const ids = batchOf((req.body || {}).credentialIds);
  if (!ids) return res.status(400).json({ error: 'invalid_batch', max: MAX_BATCH });
  res.json({ statuses: ids.map((credentialId) => ({ credentialId, status: statusStore.getStatus(credentialId) })) });
});

// POST /status/register — certification-service records a newly issued credential.
app.post('/status/register', requireInternalKey, (req, res) => {
  const { credentialId, statusListIndex = null } = req.body || {};
  if (!credentialId || typeof credentialId !== 'string') return res.status(400).json({ error: 'missing_credentialId' });
  if (statusListIndex !== null && (!Number.isSafeInteger(statusListIndex) || statusListIndex < 0 || statusListIndex >= LIST_BITS))
    return res.status(400).json({ error: 'invalid_statusListIndex' });
  const known = statusStore.isKnown(credentialId);
  try { statusStore.register(credentialId, statusListIndex); } catch (error) {
    if (error instanceof StatusTransitionError) return res.status(409).json({ error: 'status_list_index_conflict', message: error.message });
    return notPersisted(res, error);
  }
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
    } catch (error) {
      if (error instanceof StatusTransitionError) return res.status(409).json({ error: error.message });
      return notPersisted(res, error);
    }
  };
}

function notPersisted(res, error) {
  console.error(`[credential-verification] status change not persisted: ${error.message}`);
  return res.status(500).json({ error: 'status_not_persisted' });
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

// The signed status lists (assurance audit D2), open to anyone: a set bit is
// a revoked (or currently suspended) credential. Signed on each request with
// the status key, which the JWKS publishes.
const STATUS_STATE = Object.freeze({ revocation: 'revoked', suspension: 'suspended' });
app.get('/status-lists/:purpose', (req, res) => {
  const { purpose } = req.params;
  if (!PURPOSES.includes(purpose)) return res.status(404).json({ error: 'not_found' });
  const keyPath = process.env.STATUS_LIST_PRIVATE_KEY_PATH;
  const base = process.env.STATUS_LIST_BASE_URL;
  // The list's issuer must be the credentials' issuer, so it is configured, never guessed.
  const issuer = process.env.STATUS_LIST_ISSUER;
  if (!keyPath || !fs.existsSync(keyPath) || !process.env.STATUS_LIST_KEY_ID || !base || !issuer || !trustedIssuers().has(issuer))
    return res.status(503).json({ error: 'status_list_not_configured' });
  try {
    const signed = statusListCredential({ purpose, listUrl: `${base}/${purpose}`, issuer, indices: statusStore.indicesWith(STATUS_STATE[purpose]),
      validFrom: new Date().toISOString(), privateKeyPem: fs.readFileSync(keyPath, 'utf8'), keyId: process.env.STATUS_LIST_KEY_ID });
    res.set('cache-control', 'no-store').type('application/vc+jwt').send(signed.compactJws);
  } catch (error) {
    console.error(`[credential-verification] status list not signed: ${error.message}`);
    res.status(503).json({ error: 'status_list_unavailable' });
  }
});

// The issuer's public keys (assurance audit D3), open to anyone.
app.get('/.well-known/jwks.json', (_req, res) => {
  try {
    res.set('cache-control', 'public, max-age=300');
    res.json(issuerJwks());
  } catch (error) {
    console.error(`[credential-verification] issuer keys unavailable: ${error.message}`);
    res.status(503).json({ error: 'issuer_keys_unavailable' });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 4030;
  app.listen(PORT, () => console.log(`[credential-verification] listening on ${PORT}`));
}
module.exports = { app };
