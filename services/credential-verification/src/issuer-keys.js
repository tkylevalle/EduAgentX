'use strict';

// The issuer's public keys (assurance audit D3): the active production key,
// the test issuer's key and any retired keys, published as a JWKS so that a
// third party can check a credential's signature without asking this service.
// A retired key still verifies credentials it signed before its retirement
// time, and nothing after. Only public keys are read; a private key never
// reaches this service.

const fs = require('node:fs');
const { createPublicKey } = require('node:crypto');
const { SIMULATION_ISSUER } = require('../../../packages/execution-provenance');

const DEFAULT_KEY_ID = 'https://eduagentx.example/issuers/eduagentx#dev-ed25519-1';
const DEFAULT_TEST_KEY_ID = `${SIMULATION_ISSUER}#test-ed25519-1`;

/** @param {NodeJS.ProcessEnv} env @returns {{ kid: string, path: string, status: string, retiredAt?: string }[]} the configured keys */
function keySources(env = process.env) {
  let retired;
  try { retired = JSON.parse(env.CREDENTIAL_RETIRED_KEYS || '[]'); } catch {
    throw new Error('CREDENTIAL_RETIRED_KEYS is not valid JSON');
  }
  if (!Array.isArray(retired) || retired.some((key) => typeof key?.kid !== 'string' || typeof key.path !== 'string' ||
    !Number.isFinite(Date.parse(key.retiredAt)))) throw new Error('CREDENTIAL_RETIRED_KEYS must list { kid, path, retiredAt }');
  return [
    ...(env.CREDENTIAL_PUBLIC_KEY_PATH ? [{ kid: env.CREDENTIAL_KEY_ID || DEFAULT_KEY_ID, path: env.CREDENTIAL_PUBLIC_KEY_PATH, status: 'active' }] : []),
    ...(env.CREDENTIAL_TEST_PUBLIC_KEY_PATH ? [{ kid: env.CREDENTIAL_TEST_KEY_ID || DEFAULT_TEST_KEY_ID, path: env.CREDENTIAL_TEST_PUBLIC_KEY_PATH, status: 'active' }] : []),
    // The key that signs the status lists (assurance audit D2).
    ...(env.STATUS_LIST_PUBLIC_KEY_PATH && env.STATUS_LIST_KEY_ID ? [{ kid: env.STATUS_LIST_KEY_ID, path: env.STATUS_LIST_PUBLIC_KEY_PATH, status: 'active' }] : []),
    ...retired.map((key) => ({ kid: key.kid, path: key.path, status: 'retired', retiredAt: new Date(key.retiredAt).toISOString() })),
  ];
}

function readKey(source) {
  if (!fs.existsSync(source.path)) throw new Error(`issuer key ${source.kid} has no file at its configured path`);
  return fs.readFileSync(source.path, 'utf8');
}

/** @param {NodeJS.ProcessEnv} env @returns {{ keys: object[] }} the issuer's public keys as a JWKS */
function issuerJwks(env = process.env) {
  return { keys: keySources(env).map((source) => {
    const { kty, crv, x } = createPublicKey(readKey(source)).export({ format: 'jwk' });
    return { kty, crv, x, kid: source.kid, alg: 'EdDSA', use: 'sig', status: source.status,
      ...(source.retiredAt ? { retiredAt: source.retiredAt } : {}) };
  }) };
}

/**
 * @param {string} kid the credential's key id
 * @param {string} issuedAt when the credential was issued (its validFrom)
 * @returns {string | null} the PEM public key for this kid, or null when unknown or retired before issuance
 */
function publicKeyForKid(kid, issuedAt, env = process.env) {
  const source = keySources(env).find((value) => value.kid === kid);
  if (!source) return null;
  if (source.retiredAt && !(Date.parse(issuedAt) < Date.parse(source.retiredAt))) return null;
  return readKey(source);
}

module.exports = { issuerJwks, keySources, publicKeyForKid };
