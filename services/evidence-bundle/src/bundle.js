'use strict';
/**
 * Evidence Bundle builder.
 * Binds build/environment, contracts, packages, policies, datasets, KPIs,
 * incidents, demonstrations, costs, limitations, and content digests.
 * All sensitive material is redacted before export.
 */
const crypto = require('node:crypto');
const { redact } = require('./redactor');

const BUNDLE_VERSION = '1.0.0';
const RETENTION = Object.freeze({
  raw: '90d',
  aggregate: '365d',
  project_lifetime: 'indefinite',
  active_investigation: 'hold',
});

function digest(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Build a sanitized Evidence Bundle.
 * @param {object} input - raw evidence data
 * @returns {object} sanitized, digested bundle
 */
function buildBundle(input = {}) {
  const {
    buildEnv = {},
    contracts = [],
    packages = [],
    policies = [],
    datasets = [],
    kpis = {},
    incidents = [],
    demonstrations = [],
    costs = {},
    limitations = [],
  } = input;

  // Redact all sensitive material
  const sanitized = {
    buildEnv: redact(buildEnv),
    contracts: redact(contracts),
    packages: redact(packages),
    policies: redact(policies),
    datasets: redact(datasets),
    kpis: redact(kpis),
    incidents: redact(incidents),
    demonstrations: redact(demonstrations),
    costs: redact(costs),
    limitations,
  };

  // Content digests for each section
  const digests = {};
  for (const [key, value] of Object.entries(sanitized)) {
    digests[key] = digest(value);
  }

  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    retention: RETENTION,
    sections: sanitized,
    digests,
    bundleDigest: digest(sanitized),
  };

  return bundle;
}

/**
 * Render bundle as sanitized HTML for export.
 */
function renderHTML(bundle) {
  const sections = Object.entries(bundle.sections).map(([key, value]) => `
    <section>
      <h2>${key}</h2>
      <pre>${JSON.stringify(value, null, 2)}</pre>
      <p class="digest">SHA-256: ${bundle.digests[key]}</p>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EduAgentX Evidence Bundle</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1e293b; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 32px; }
  h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 32px; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .digest { font-size: 10px; color: #94a3b8; font-family: monospace; margin-top: 4px; }
  .bundle-digest { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-top: 32px; font-size: 12px; }
  @media(max-width:390px) { body { padding: 12px; } pre { font-size: 11px; } }
</style>
</head>
<body>
<h1>EduAgentX Evidence Bundle</h1>
<div class="meta">
  Generated: ${bundle.generatedAt} &nbsp;|&nbsp;
  Version: ${bundle.bundleVersion} &nbsp;|&nbsp;
  Retention: raw ${bundle.retention.raw} / aggregate ${bundle.retention.aggregate}
</div>
${sections}
<div class="bundle-digest">
  <strong>Bundle SHA-256:</strong> ${bundle.bundleDigest}
</div>
</body>
</html>`;
}

module.exports = { buildBundle, renderHTML, BUNDLE_VERSION, RETENTION };
