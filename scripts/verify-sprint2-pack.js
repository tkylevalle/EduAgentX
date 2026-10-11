'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const relative = process.argv[2];
const technicalOnly = process.argv.includes('--technical-only');
if (!relative) throw new Error('pack path required');
const pack = path.resolve(root, relative);
const evidenceRoot = path.resolve(root, 'evidence', 'sprint-2');
if (!pack.startsWith(`${evidenceRoot}${path.sep}`)) throw new Error('pack must be inside evidence/sprint-2');
const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [name, digest] of Object.entries(manifest.hashes)) {
  if (path.basename(name) !== name || sha(path.join(pack, name)) !== digest) throw new Error(`pack integrity failed: ${name}`);
}
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', manifest.implementationCommit, 'HEAD'], { cwd: root });
if (ancestor.status !== 0) throw new Error('implementation commit is not an ancestor of HEAD');
const delta = spawnSync('git', ['diff', '--quiet', manifest.implementationCommit, 'HEAD', '--',
  'services', 'packages', 'docker-compose.yml', 'scripts/run-sprint2-live.js'], { cwd: root });
const dirty = spawnSync('git', ['diff', '--quiet', '--',
  'services', 'packages', 'docker-compose.yml', 'scripts/run-sprint2-live.js'], { cwd: root });
if (delta.status !== 0 || dirty.status !== 0) throw new Error('implementation code differs from sealed commit');
const tests = JSON.parse(fs.readFileSync(path.join(pack, 'test-results.json'), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(pack, 'live-smoke.json'), 'utf8'));
const quality = JSON.parse(fs.readFileSync(path.join(pack, 'quality.json'), 'utf8'));
if (manifest.technicalResult !== 'PASS' || tests.unit.result !== 'passed' ||
    tests.sprint1GatePython.exitCode !== 0 || tests.trainingKpiRun.exitCode !== 0 ||
    tests.trainingKpi.status !== 'Green' || live.status !== 'technical_pass' ||
    !quality.gates.passed || !quality.measurements.sourceTraceability.invariantMet ||
    !quality.measurements.objectiveCoverage.floorMet)
  throw new Error('technical gate failed');
const status = technicalOnly ? 'TECHNICAL_PASS_FORMAL_BLOCKED' : 'BLOCKED_HUMAN_REVIEW';
process.stdout.write(`${JSON.stringify({ status, pack, implementationCommit: manifest.implementationCommit })}\n`);
if (!technicalOnly) process.exitCode = 1;
