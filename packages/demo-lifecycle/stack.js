'use strict';

// What the command-line scripts share about the local stack: .env, the
// candidate package of each sandbox domain, and the driver's connection.

const fs = require('node:fs');
const path = require('node:path');

const EXAMPLES = path.join(__dirname, '..', '..', 'services', 'curriculum-engine', 'examples');
const CANDIDATES = Object.freeze({ 'ai-safety': 'ai-safety-candidate', 'customer-refunds': 'customer-refunds-candidate',
  'personal-data': 'personal-data-candidate' });
const CANDIDATE_DOMAINS = Object.freeze(Object.keys(CANDIDATES));

/** @returns {Record<string, string>} the KEY=value lines of an env file (throws if it is missing) */
function readEnvFile(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

/** @returns {object|null} the candidate package of a sandbox domain id, or null for an unknown id */
function candidateFor(domain) {
  return Object.hasOwn(CANDIDATES, domain) ? require(path.join(EXAMPLES, CANDIDATES[domain])) : null;
}

/** The lifecycle driver's connection to the stack on this machine. */
function stackConnection(env) {
  return {
    gatewayUrl: `http://127.0.0.1:${env.GATEWAY_PORT || 8080}`,
    syntheticUrl: `http://127.0.0.1:${env.SYNTHETIC_AGENT_PORT || 4200}`,
    validationUrl: `http://127.0.0.1:${env.VALIDATION_ACTIVATION_PORT || 4010}`,
    curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
    admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
  };
}

module.exports = { CANDIDATE_DOMAINS, candidateFor, readEnvFile, stackConnection };
