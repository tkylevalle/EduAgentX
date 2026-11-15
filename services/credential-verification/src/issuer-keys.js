'use strict';

// The issuer's public keys (assurance audit D3): the active production key,
// the test issuer's key, any retired keys and the status-list key, published
// as a JWKS so that a third party can check a signature without asking this
// service. Each key has one purpose: 'credential' keys verify credentials;
// the 'status-list' key verifies only the status lists (assurance audit D2)
// and is never accepted for a credential. This service holds the status-list
// private key, to sign the lists, and no credential-signing key.
//
// A retired key verifies only credentials whose validFrom is before its
// retirement time. validFrom is chosen by whoever signs, so a leaked retired
// key could back-date a forgery: retirement narrows exposure, it does not end
// it. See docs/release/key-rotation.md.

const fs = require('node:fs');
const { createPublicKey } = require('node:crypto');
const { SIMULATION_ISSUER } = require('../../../packages/execution-provenance');

const DEFAULT_KEY_ID = 'https://eduagentx.example/issuers/eduagentx#dev-ed25519-1';
const DEFAULT_TEST_KEY_ID = `${SIMULATION_ISSUER}#test-ed25519-1`;
const CREDENTIAL = 'credential';
const STATUS_LIST = 'status-list';

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ kid: string, path: string, status: string, purpose: string, retiredAt?: string }[]} the configured keys
 */
function keySources(env = process.env) {
  let retired;
  try { retired = JSON.parse(env.CREDENTIAL_RETIRED_KEYS || '[]'); } catch {
    throw new Error('CREDENTIAL_RETIRED_KEYS is not valid JSON');
  }
  if (!Array.isArray(retired) || retired.some((key) => typeof key?.kid !== 'string' || typeof key.path !== 'string' ||
    !Number.isFinite(Date.parse(key.retiredAt)))) throw new Error('CREDENTIAL_RETIRED_KEYS must list { kid, path, retiredAt }');
  const sources = [
    ...(env.CREDENTIAL_PUBLIC_KEY_PATH ? [{ kid: env.CREDENTIAL_KEY_ID || DEFAULT_KEY_ID, path: env.CREDENTIAL_PUBLIC_KEY_PATH,
      status: 'active', purpose: CREDENTIAL }] : []),
    ...(env.CREDENTIAL_TEST_PUBLIC_KEY_PATH ? [{ kid: env.CREDENTIAL_TEST_KEY_ID || DEFAULT_TEST_KEY_ID, path: env.CREDENTIAL_TEST_PUBLIC_KEY_PATH,
      status: 'active', purpose: CREDENTIAL }] : []),
    ...(env.STATUS_LIST_PUBLIC_KEY_PATH && env.STATUS_LIST_KEY_ID ? [{ kid: env.STATUS_LIST_KEY_ID, path: env.STATUS_LIST_PUBLIC_KEY_PATH,
      status: 'active', purpose: STATUS_LIST }] : []),
    ...retired.map((key) => ({ kid: key.kid, path: key.path, status: 'retired', purpose: CREDENTIAL, retiredAt: new Date(key.retiredAt).toISOString() })),
  ];
  if (new Set(sources.map((source) => source.kid)).size !== sources.length) throw new Error('two configured keys share one kid');
  return sources;
}

function readKey(source) {
  if (!fs.existsSync(source.path)) throw new Error(`issuer key ${source.kid} has no file at its configured path`);
  return fs.readFileSync(source.path, 'utf8');
}

/** @param {NodeJS.ProcessEnv} env @returns {{ keys: object[] }} the issuer's public keys as a JWKS, each with its purpose */
function issuerJwks(env = process.env) {
  return { keys: keySources(env).map((source) => {
    const { kty, crv, x } = createPublicKey(readKey(source)).export({ format: 'jwk' });
    return { kty, crv, x, kid: source.kid, alg: 'EdDSA', use: 'sig', purpose: source.purpose, status: source.status,
      ...(source.retiredAt ? { retiredAt: source.retiredAt } : {}) };
  }) };
}

/** @param {string} kid @param {NodeJS.ProcessEnv} env @returns {boolean} whether this kid names the status-list key, which never verifies a credential */
const isStatusListKid = (kid, env = process.env) => keySources(env).some((source) => source.kid === kid && source.purpose === STATUS_LIST);

/**
 * @param {string} kid the credential's key id
 * @param {string} issuedAt when the credential was issued (its validFrom)
 * @returns {string | null} the PEM public key of the credential key with this kid, or null when unknown,
 *   not a credential key, or retired before issuance
 */
function publicKeyForKid(kid, issuedAt, env = process.env) {
  const source = keySources(env).find((value) => value.kid === kid && value.purpose === CREDENTIAL);
  if (!source) return null;
  if (source.retiredAt && !(Date.parse(issuedAt) < Date.parse(source.retiredAt))) return null;
  return readKey(source);
}

module.exports = { issuerJwks, isStatusListKid, keySources, publicKeyForKid };
