#!/usr/bin/env node
'use strict';
// Usage: node packages/release-gate/cli.js [--fingerprint]
// Exit 0 = PASS, 2 = BLOCKED, 1 = the gate could not run.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { runReleaseGate } = require('./src');
const { collectReleaseInput } = require('./src/collect');

const EXIT_BLOCKED = 2;

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  if (process.argv.includes('--fingerprint')) {
    process.stdout.write(`${collectReleaseInput(root).fingerprint}\n`);
    return 0;
  }
  const result = { schemaVersion: 'release-gate/1.0.0', generatedAt: new Date().toISOString(), ...runReleaseGate(root) };
  const output = path.join(root, 'artifacts', 'release', 'release-result.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write([
    `Release gate: ${result.status}`,
    `Source fingerprint: ${result.fingerprint}`,
    `Scanned ${result.scannedFiles} tracked files, read ${result.recordsRead} release records.`,
    ...result.blockers.map((blocker) => `  BLOCKER ${blocker}`),
    `Result: ${path.relative(root, output)}`,
  ].join('\n') + '\n');
  return result.status === 'PASS' ? 0 : EXIT_BLOCKED;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`Release gate could not run: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
