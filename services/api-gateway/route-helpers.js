'use strict';

// Small rules the Gateway's route modules share, so each is stated once.

// The platform's one UUID pattern, owned by the execution provenance package.
const { UUID } = require('../../packages/execution-provenance');

// An opaque identifier a caller may send (idempotency keys, item ids, domain
// ids): printable ASCII, at most 256 characters.
const TRAINING_IDENTIFIER = /^[\x20-\x7e]{1,256}$/;

/** @param {unknown} value @returns {boolean} whether value is an identifier string; no other type is coerced */
const isIdentifier = (value) => typeof value === 'string' && TRAINING_IDENTIFIER.test(value);

// The 503 a route answers when its upstream is not configured or not reachable.
const unavailable = (req, res, error) => res.status(503).json({ apiVersion: 'v1', error, correlationId: req.correlationId });

module.exports = { UUID, TRAINING_IDENTIFIER, isIdentifier, unavailable };
