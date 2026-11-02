'use strict';
// No Docker execution, service writes, or scenario execution.
const fs = require('node:fs');
const path = require('node:path');
const { preflight } = require('../packages/e2e-suite/readiness');
const { sourceIdentity } = require('../packages/e2e-suite/run');
try {
const args = process.argv.slice(2), index = args.indexOf('--pilot-report');
const pilot = index < 0 ? undefined : JSON.parse(fs.readFileSync(args[index + 1], 'utf8'));
const report = { ...preflight({ phase1: pilot }), source: sourceIdentity(), createdAt: new Date().toISOString() };
const out = path.resolve('artifacts/issue-33', `preflight-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path: out, readiness: report.readiness, formal1000: report.formal1000,
  manifest: report.manifest, runtime: report.runtimeEstimate, marketplace: report.marketplace.counts,
  missingHarnessCases: report.marketplace.missingHarnessCases }));
process.exitCode = report.manifest.valid ? 0 : 1;
} catch {
  console.error('issue33_preflight_unavailable');
  process.exitCode = 1;
}
