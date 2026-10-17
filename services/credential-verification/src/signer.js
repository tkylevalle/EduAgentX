'use strict';
/**
 * Ed25519 signing for W3C VC 2.0 compact JWS profile.
 * Private key material never logged, stored, or returned in responses.
 */
const crypto = require('node:crypto');

const ALLOWED_ALGORITHMS = new Set(['EdDSA']);
const PROJECT_TRUST_NOTICE = 'EduAgentX project-only credential — not valid outside this platform';

/**
 * Sign a credential payload as compact JWS (header.payload.signature)
 * @param {object} credential - W3C VC 2.0 credential object
 * @param {string} privateKeyPem - Ed25519 private key in PEM format
 * @param {string} keyId - Key identifier (DID fragment)
 * @returns {string} compact JWS
 */
function signCredential(credential, privateKeyPem, keyId) {
  if (!privateKeyPem) throw new Error('private key required for signing');
  if (!keyId) throw new Error('keyId required');

  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...credential, _notice: PROJECT_TRUST_NOTICE })).toString('base64url');
  const signingInput = `${header}.${payload}`;

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey).toString('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Verify a compact JWS credential
 * @param {string} jws - compact JWS string
 * @param {string} publicKeyPem - Ed25519 public key in PEM format
 * @returns {{ valid: boolean, header: object, credential: object }}
 */
function verifyJws(jws, publicKeyPem) {
  if (!jws || typeof jws !== 'string') throw new Error('jws must be a non-empty string');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('invalid JWS format — expected header.payload.signature');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

  if (!ALLOWED_ALGORITHMS.has(header.alg))
    throw new Error(`disallowed algorithm: ${header.alg} — only EdDSA permitted`);

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');
  const publicKey = crypto.createPublicKey(publicKeyPem);

  const valid = crypto.verify(null, Buffer.from(signingInput), publicKey, signature);
  const credential = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  return { valid, header, credential };
}

module.exports = { signCredential, verifyJws, ALLOWED_ALGORITHMS, PROJECT_TRUST_NOTICE };
