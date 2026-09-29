// An expected failure with a stable HTTP status and machine-readable code.
// app.js turns it into a JSON error response; anything else becomes a 500.
class RegistryError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'RegistryError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = { RegistryError };
