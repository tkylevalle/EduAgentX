// Structured JSON logging shared by every EduAgentX service.
//
// Only allowlisted fields are written. Never pass an Error, request, body,
// header or URL expecting it to be logged: it is dropped on purpose so that
// secrets and private learner content cannot reach the logs.
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const LOGGED_FIELDS = ['method', 'path', 'statusCode', 'durationMs', 'dependency', 'operation', 'outcome'];
const SIMPLE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

// Holds the current request's correlation ID across async calls.
const context = new AsyncLocalStorage();

// Returns a log-safe identifier: simple IDs unchanged, anything else hashed.
function safeId(value) {
  if (typeof value !== 'string') return undefined;
  if (SIMPLE_ID.test(value)) return value;
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

function log(service, event, fields = {}) {
  const record = { timestamp: new Date().toISOString(), service, event };
  const correlationId = safeId(fields.correlationId || context.getStore());
  if (correlationId) record.correlationId = correlationId;
  for (const key of LOGGED_FIELDS) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  console.log(JSON.stringify(record));
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// Express middleware: logs one record per request and binds the request's
// correlation ID (set earlier as req.correlationId) to the async context.
function middleware(service) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    let emitted = false;
    const done = (outcome) => {
      if (emitted) return;
      emitted = true;
      log(service, 'http_request_completed', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.route?.path || '[unmatched]',
        statusCode: res.statusCode,
        durationMs: elapsedMs(start),
        outcome,
      });
    };
    res.once('finish', () => done('completed'));
    res.once('close', () => done('aborted'));
    context.run(req.correlationId, next);
  };
}

// Runs fn and logs its duration and outcome against a named dependency.
async function observe(service, dependency, operation, fn, correlationId) {
  const start = process.hrtime.bigint();
  let outcome = 'ok';
  try {
    return await fn();
  } catch (error) {
    outcome = 'error';
    throw error;
  } finally {
    log(service, 'dependency_operation', {
      dependency, operation, correlationId, outcome, durationMs: elapsedMs(start),
    });
  }
}

module.exports = { log, middleware, observe, safeId };
