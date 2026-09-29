const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
function safeId(value) {
  if (typeof value !== 'string') return undefined;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value
    : 'sha256:' + createHash('sha256').update(value).digest('hex');
}
// Explicit allowlist: never serialize an Error, request, body, header or URL.
function log(service, event, fields = {}) {
  const record = { timestamp: new Date().toISOString(), service, event };
  const correlationId = safeId(fields.correlationId || context.getStore());
  if (correlationId) record.correlationId = correlationId;
  for (const key of ['method', 'path', 'statusCode', 'durationMs', 'dependency', 'operation', 'outcome']) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  console.log(JSON.stringify(record));
}
function middleware(service) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    let emitted = false;
    const done = (outcome) => {
      if (emitted) return;
      emitted = true;
      log(service, 'http_request_completed', {
        correlationId: req.correlationId, method: req.method,
        path: req.route?.path || '[unmatched]', statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - start) / 1e6, outcome,
      });
    };
    res.once('finish', () => done('completed'));
    res.once('close', () => done('aborted'));
    context.run(req.correlationId, next);
  };
}
async function observe(service, dependency, operation, fn, correlationId) {
  const start = process.hrtime.bigint();
  let outcome = 'ok';
  try { return await fn(); }
  catch (error) { outcome = 'error'; throw error; }
  finally { log(service, 'dependency_operation', {
    dependency, operation, correlationId, outcome,
    durationMs: Number(process.hrtime.bigint() - start) / 1e6,
  }); }
}
module.exports = { log, middleware, observe, safeId };
