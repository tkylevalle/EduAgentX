'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const keyDirectory = path.join(root, 'keys');
const privateKeyPath = path.join(keyDirectory, 'dev-jwt-private.pem');
const publicKeyPath = path.join(keyDirectory, 'dev-jwt-public.pem');

if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
  console.log('Local test keypair already exists.');
  process.exit(0);
}

fs.mkdirSync(keyDirectory, { recursive: true });
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
console.log(`Generated local-only test keypair in ${keyDirectory}.`);
