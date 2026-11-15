'use strict';

// W3C Bitstring Status List (assurance audit D2): one signed list per status
// purpose. A credential carries an entry naming its list and its index; a
// set bit at that index means revoked (revocation list) or suspended
// (suspension list). Anyone can fetch a list and check its signature against
// the issuer's published status key, without calling this service's status
// API. The encoded list is the GZIP-compressed bitstring in base64url with
// the multibase prefix 'u'; index 0 is the left-most bit.

const { gzipSync, gunzipSync } = require('node:zlib');
const { signCredential } = require('./signer');

// The W3C minimum list size, 16 KB, so one credential's bit does not stand out.
const LIST_BITS = 131072;
const PURPOSES = Object.freeze(['revocation', 'suspension']);

/** @param {number[]} indices the set bits @returns {string} the encoded list */
function encodeList(indices) {
  const bits = Buffer.alloc(LIST_BITS / 8);
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= LIST_BITS) throw new RangeError(`status list index ${index} is outside the list`);
    bits[index >> 3] |= 0x80 >> (index % 8);
  }
  return `u${gzipSync(bits).toString('base64url')}`;
}

/** @param {string} encoded @returns {Buffer} the bitstring */
const decodeList = (encoded) => gunzipSync(Buffer.from(String(encoded).slice(1), 'base64url'));

/**
 * @param {{ purpose: string, listUrl: string, issuer: string, indices: number[], validFrom: string, privateKeyPem: string, keyId: string }} input
 * @returns {{ credential: object, compactJws: string }} the signed status list credential
 */
function statusListCredential({ purpose, listUrl, issuer, indices, validFrom, privateKeyPem, keyId }) {
  if (!PURPOSES.includes(purpose)) throw new RangeError(`unknown status purpose ${purpose}`);
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: listUrl,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer,
    validFrom,
    credentialSubject: { id: `${listUrl}#list`, type: 'BitstringStatusList', statusPurpose: purpose, encodedList: encodeList(indices) },
  };
  return { credential, compactJws: signCredential(credential, privateKeyPem, keyId) };
}

module.exports = { LIST_BITS, PURPOSES, decodeList, encodeList, statusListCredential };
