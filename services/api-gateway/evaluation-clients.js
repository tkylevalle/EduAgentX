'use strict';
// Explicit opt-in extension of the existing credential roster. No alternate
// token issuer, wildcard subject or ownership exception. Mount the file read-only.
const fs = require('node:fs');
const MAX_CLIENTS = 2000;
const MAX_BYTES = 512 * 1024;
function readRoster(file) {
  // A configured path must be a regular file, never a blocking pipe/device.
  // Bound the read itself too: a file can grow after its metadata is checked.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, read;
    do { read = fs.readSync(fd, bytes, size, bytes.length - size, null); size += read; }
    while (read && size < bytes.length);
    if (size > MAX_BYTES) throw new Error();
    return JSON.parse(bytes.subarray(0, size).toString('utf8'));
  } finally { fs.closeSync(fd); }
}
function evaluationClients(existingIds = [], env = process.env) {
  if (env.EVALUATION_CLIENTS_ENABLED !== 'true') return [];
  try {
    if (!env.EVALUATION_CLIENTS_PATH) throw new Error();
    const clients = readRoster(env.EVALUATION_CLIENTS_PATH);
    if (!Array.isArray(clients) || !clients.length || clients.length > MAX_CLIENTS) throw new Error();
    const ids = new Set(existingIds);
    return clients.map(c => {
      if (!c || Object.keys(c).sort().join(',') !== 'clientId,clientSecret' ||
        typeof c.clientId !== 'string' || !/^e2e33-[a-z0-9-]{1,110}$/.test(c.clientId) || ids.has(c.clientId) ||
        typeof c.clientSecret !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(c.clientSecret)) throw new Error();
      ids.add(c.clientId);
      return { clientId: c.clientId, clientSecret: c.clientSecret, role: 'agent' };
    });
  } catch { throw new Error('evaluation_clients_invalid'); }
}
module.exports = { evaluationClients, MAX_CLIENTS, MAX_BYTES };
