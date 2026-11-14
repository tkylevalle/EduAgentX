'use strict';
// Preload ONLY in private evaluation containers. A file avoids the Linux
// per-environment-string exec limit for 1000 explicit enrolled principals.
const fs = require('node:fs');
const execution = require('../execution-provenance');
const MAX_BYTES = 2 * 1024 * 1024;
function readPrincipals(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error();
    const data = Buffer.alloc(MAX_BYTES + 1);
    let count = 0, n;
    while (count < data.length && (n = fs.readSync(fd, data, count, data.length - count, null)) > 0) count += n;
    if (count > MAX_BYTES) throw new Error();
    const rows = JSON.parse(data.subarray(0, count).toString('utf8'));
    if (!Array.isArray(rows) || !rows.length || rows.length > 2000 || rows.some(r =>
      !/^e2e33-[0-9a-f]{40}$/.test(r?.subject || '') || r.evidenceMode !== 'synthetic')) throw new Error();
    return execution.enrollments(rows); // Same finite catalog/policy; no forged reviews.
  } catch { throw new Error('invalid_private_execution_enrollment'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
if (process.env.E2E_EXECUTION_PRINCIPALS_PATH) {
  const existing = execution.enrollments();
  process.env.EXECUTION_PRINCIPALS = JSON.stringify(execution.enrollments([
    ...existing, ...readPrincipals(process.env.E2E_EXECUTION_PRINCIPALS_PATH) ]));
}
module.exports = { readPrincipals, MAX_BYTES };
