'use strict';
// Finds committed secrets, signing keys and real credentials in tracked files.
// A finding names the file, line and rule. It never contains the matched value.

const ENVIRONMENT_FILE = /^\.env(\..+)?$/;
const ALLOWED_ENVIRONMENT_FILES = new Set(['.env.example']);
const KEY_FILE = /\.(pem|key|p12|pfx)$/i;
const COMPOSE_FILE = /^(docker-)?compose[\w.-]*\.ya?ml$/;
const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|KEY)$/;
const PLACEHOLDER_PREFIX = 'example-only-';

const CONTENT_RULES = [
  { rule: 'private-key-block', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { rule: 'signed-token', pattern: /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/ },
  { rule: 'provider-api-key', pattern: /\b(?:sk-[\w-]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_\w{40,}|AKIA[0-9A-Z]{16})\b/ },
];
const ENVIRONMENT_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/;
const COMPOSE_LINE = /^\s*(?:-\s*)?([A-Z][A-Z0-9_]*)\s*[:=]\s*(.*)$/;

const baseName = (path) => path.split('/').pop();
const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

function pathFindings(path) {
  const name = baseName(path);
  if (ENVIRONMENT_FILE.test(name) && !ALLOWED_ENVIRONMENT_FILES.has(name)) {
    return [{ path, line: null, rule: 'environment-file' }];
  }
  return KEY_FILE.test(name) ? [{ path, line: null, rule: 'key-file' }] : [];
}

// Example and Compose files may name a secret but must not carry its value.
function assignmentChecker(path) {
  const name = baseName(path);
  if (ENVIRONMENT_FILE.test(name)) {
    return (line) => secretValue(line.match(ENVIRONMENT_LINE), (value) => value === ''
      || value.startsWith(PLACEHOLDER_PREFIX));
  }
  if (COMPOSE_FILE.test(name)) {
    return (line) => secretValue(line.match(COMPOSE_LINE), (value) => value === ''
      || value.includes('${') || value.startsWith(PLACEHOLDER_PREFIX));
  }
  return () => false;
}

function secretValue(match, isPlaceholder) {
  if (!match || !SECRET_NAME.test(match[1])) return false;
  return !isPlaceholder(unquote(match[2]));
}

function contentFindings(path, text) {
  const hasSecretValue = assignmentChecker(path);
  return text.split(/\r?\n/).flatMap((line, index) => {
    const found = CONTENT_RULES.filter(({ pattern }) => pattern.test(line)).map(({ rule }) => rule);
    if (hasSecretValue(line)) found.push('non-placeholder-secret');
    return found.map((rule) => ({ path, line: index + 1, rule }));
  });
}

/**
 * @param {{ path: string, text: string }[]} files tracked files, paths relative to the repository root
 * @returns {{ path: string, line: number|null, rule: string }[]}
 */
function scanTrackedFiles(files) {
  return files.flatMap(({ path, text }) => [...pathFindings(path), ...contentFindings(path, text || '')]);
}

module.exports = { scanTrackedFiles };
