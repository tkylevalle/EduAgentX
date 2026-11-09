'use strict';
// Read-only: this script never executes scenarios or changes services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preflight, rebaselineReadiness } = require('../packages/e2e-suite/readiness');
const { sourceIdentity } = require('../packages/e2e-suite/run');
try {
  const args = process.argv.slice(2);
  const read = key => args.includes(key) ? JSON.parse(fs.readFileSync(args[args.indexOf(key) + 1], 'utf8')) : undefined;
  const pilot = read('--pilot-report');
  const stat = fs.statfsSync('.');
  const available = process.platform === 'linux' ? Number(fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024 : os.freemem();
  const resources = { freeDiskGiB: stat.bavail * stat.bsize / 2**30, availableMemoryGiB: available / 2**30 };
  const regression = read('--regression-report');
  let merged = false;
  try { execFileSync('git', ['merge-base','--is-ancestor','origin/main','HEAD'], {stdio:'pipe'}); merged = true; } catch {}
  const dependenciesPresent = ['marketplace-service','skill-gap-service'].every(name =>
    regression?.components?.some(c => c.component === name && c.status === 'passed'));
  const current = rebaselineReadiness({ pilot, regression, postgres:read('--postgres-report'), faults:read('--fault-report'),
    stress:read('--stress-report'), defaults:read('--default-report'), goldenSmoke:read('--golden-report'),
    matrixApproved:args.includes('--golden-v2-approved'),resources,merged,dependenciesPresent });
  const report = { ...preflight({ phase1:pilot,goldenSmoke:read('--golden-report'),resources }), current, source:sourceIdentity(), createdAt:new Date().toISOString() };
  const out = path.resolve('artifacts/issue-33',`preflight-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({path:out,readiness:current.readiness,gates:current.gates,formal1000:'NOT_RUN',
    manifest:report.manifest,runtime:report.runtimeEstimate,marketplace:report.marketplace.counts,resources}));
  process.exitCode = report.manifest.valid ? 0 : 1;
} catch {
  console.error('issue33_preflight_unavailable');process.exitCode = 1;
}
