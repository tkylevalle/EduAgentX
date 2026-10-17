'use strict';
/**
 * Redaction — strips sensitive material from evidence before export.
 * Redacts: raw answers, private prompts, tokens, credentials, signing keys, grader material.
 */

const REDACT_KEYS = new Set([
  'rawAnswer', 'raw_answer', 'privatePrompt', 'private_prompt',
  'systemInstruction', 'system_instruction', 'protectedContext', 'protected_context',
  'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'password', 'secret', 'privateKey', 'private_key', 'signingKey', 'signing_key',
  'graderMaterial', 'grader_material', 'expectedAnswer', 'expected_answer',
  'credential', 'apiKey', 'api_key', 'clientSecret', 'client_secret',
]);

const REDACT_MARKER = '[REDACTED]';

function redact(obj, depth = 0) {
  if (depth > 20) return obj; // guard against deep recursion
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => redact(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key)) {
      result[key] = REDACT_MARKER;
    } else {
      result[key] = redact(value, depth + 1);
    }
  }
  return result;
}

module.exports = { redact, REDACT_KEYS, REDACT_MARKER };
