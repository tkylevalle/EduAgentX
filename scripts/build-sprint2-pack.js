'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { measureCurriculum } = require('../services/curriculum-engine/quality');
const { runValidationGates } = require('../services/validation-activation/src/gates');
const candidate = require('../services/curriculum-engine/examples/ai-safety-candidate');

const root = path.resolve(__dirname, '..');
const relativeOutput = process.argv[2] || 'evidence/sprint-2/pack-technical-2026-10-11';
const output = path.resolve(root, relativeOutput);
const evidenceRoot = path.resolve(root, 'evidence', 'sprint-2');
if (!output.startsWith(`${evidenceRoot}${path.sep}`) || fs.existsSync(output))
  throw new Error('choose a new output directory within evidence/sprint-2');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { command: [command, ...args].join(' '), exitCode: result.status,
    outputSha256: sha(`${result.stdout || ''}${result.stderr || ''}`),
    outputTail: `${result.stdout || ''}${result.stderr || ''}`.slice(-1200),
    error: result.error?.code || null };
};
const commit = run('git', ['rev-parse', 'HEAD']).outputTail.trim();
const codeChanges = run('git', ['status', '--porcelain', '--', 'services', 'packages', 'docker-compose.yml', 'scripts/run-sprint2-live.js']);
if (codeChanges.outputTail.trim()) throw new Error('implementation worktree must be clean before sealing evidence');
const unitRun = run(process.execPath, ['scripts/run-unit-tests.js']);
const pythonRun = run('python', ['-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_sprint1_gate.py']);
const kpiRun = run(process.execPath, ['services/training-service/kpi/measure.js', '--write']);
const unit = readJson('artifacts/sprint1/unit-tests.json');
const training = readJson('evidence/sprint-2/training-completion-kpi.json');
const live = readJson('artifacts/sprint2/live-smoke.json');
const quality = measureCurriculum(candidate);
const gates = runValidationGates(candidate);
const technicalPass = unitRun.exitCode === 0 && pythonRun.exitCode === 0 && kpiRun.exitCode === 0 &&
  unit.result === 'passed' && training.status === 'Green' && live.status === 'technical_pass' &&
  gates.passed && quality.sourceTraceability.invariantMet && quality.objectiveCoverage.floorMet;
const files = {
  'test-results.json': {
    unit: { ...unitRun, totals: unit.totals, result: unit.result, components: unit.components },
    sprint1GatePython: pythonRun, trainingKpiRun: kpiRun,
    trainingKpi: { dataset: training.dataset, expectedCompletion: training.expectedCompletion,
      completionOfCompletable: training.completionOfCompletable, status: training.status,
      invariants: training.invariants, invariantsHeld: training.invariantsHeld,
      environment: training.environment },
  },
  'quality.json': { package: { id: candidate.manifest.packageId, version: candidate.manifest.version },
    gates, measurements: quality, technicalSimulationReviewerMean: live.steps.find(step => step.name === 'synthetic_reviewer_2')?.mean,
    factualReview: 'not independently verified', formalReviewerApproval: 'missing' },
  'live-smoke.json': live,
  'configuration.json': { node: process.version, platform: process.platform,
    composeFile: 'docker-compose.yml', candidateFile: 'services/curriculum-engine/examples/ai-safety-candidate.js',
    schemaVersion: candidate.manifest.schemaVersion, packageVersion: candidate.manifest.version,
    fallbackPolicy: candidate.fallbackBank.scoringPolicy, trainingPolicy: 'training-completion/1',
    sources: candidate.sources.map(source => ({ id: source.id, edition: source.edition,
      canonicalUrl: source.canonicalUrl, snapshotUrl: source.snapshotUrl, contentSha256: source.contentSha256 })),
    noSecretsIncluded: true },
};
const readme = `# Sprint 2 Evidence Pack — technical simulation

Implementation commit: ${commit}
Generated: ${new Date().toISOString()}

Technical result: ${technicalPass ? 'PASS' : 'FAIL'}. Formal Sprint 2 exit: BLOCKED — simulated reviewer credentials are not independent human approval; known critical factual errors have not been independently assessed. The controlled training KPI uses an in-memory store/fake sources, while the live smoke covers one real learner and real PostgreSQL/Chroma. Sprint 1 historical waivers remain to be resolved for a strict cumulative exit.

Reproduce in an isolated checkout and Docker project:

1. Run `node scripts/install-dependencies.js` and `node scripts/setup-dev.js`.
2. Provision two distinct **simulation-only** reviewer client IDs/secrets as `REVIEWER_1_CLIENT_ID/SECRET` and `REVIEWER_2_CLIENT_ID/SECRET` for local Compose; do not treat these as human signoff.
3. Run `docker compose up -d --build` and wait for healthy services.
4. Export the matching `SPRINT2_REVIEWER_1_ID/SECRET` and `SPRINT2_REVIEWER_2_ID/SECRET` in the shell; run `node scripts/run-sprint2-live.js`. This script temporarily stops and restarts Chroma and PostgreSQL; use only an isolated stack.
5. Run `node scripts/build-sprint2-pack.js evidence/sprint-2/<new-pack-name>` to rerun unit, Python gate, and controlled KPI tests and seal a new pack.
6. Run `node scripts/verify-sprint2-pack.js evidence/sprint-2/<pack-name> --technical-only`; omit `--technical-only` for the strict exit check, which must fail until genuine reviews and factual verification are supplied.

The pack contains measured counts, commands, source pins, sanitized runtime observations and SHA-256 hashes. It does not contain credentials, raw fallback answers, or a claim of human approval. No `docker compose down -v` is required.
`;
fs.mkdirSync(output, { recursive: true });
for (const [name, value] of Object.entries(files))
  fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'README.md'), readme);
const hashes = Object.fromEntries([...Object.keys(files), 'README.md'].map(name =>
  [name, sha(fs.readFileSync(path.join(output, name)))]));
const manifest = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), implementationCommit: commit,
  technicalResult: technicalPass ? 'PASS' : 'FAIL', formalExit: 'BLOCKED_HUMAN_REVIEW',
  hashes };
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, technicalResult: manifest.technicalResult,
  formalExit: manifest.formalExit, unitTests: unit.totals, live: live.status })}\n`);
if (!technicalPass) process.exitCode = 1;
