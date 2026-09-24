'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
loadEnv(path.join(root, '.env'));

const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
const clientId = process.env.AGENT_CLIENT_ID || 'synthetic-agent-learner-dev';
const clientSecret = process.env.AGENT_CLIENT_SECRET || 'changeme_local_only_agent_secret';
const sampleSize = positiveInteger(process.env.LATENCY_SAMPLE_SIZE, 100);
const warmupSize = positiveInteger(process.env.LATENCY_WARMUP_SIZE, 5);
const acceptanceFloorMs = positiveInteger(process.env.REGISTRATION_P95_FLOOR_MS, 3000);
const targetMs = positiveInteger(process.env.REGISTRATION_P95_TARGET_MS, 2000);
const resultsDirectory = process.env.SPRINT1_RESULTS_DIR
  ? path.resolve(process.env.SPRINT1_RESULTS_DIR)
  : path.join(root, 'artifacts', 'sprint1');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const tokenResponse = await fetch(`${gatewayBaseUrl}/v1/auth/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.accessToken) throw new Error(`Token exchange failed: HTTP ${tokenResponse.status}`);

  for (let index = 0; index < warmupSize; index += 1) {
    await register(tokenBody.accessToken, `warmup-${index}-${Date.now()}`);
  }

  const latencies = [];
  const failures = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const suffix = `sample-${index}-${Date.now()}`;
    const started = performance.now();
    const response = await register(tokenBody.accessToken, suffix);
    const durationMs = performance.now() - started;
    if (response.status !== 200 && response.status !== 201) {
      failures.push({ index, status: response.status, body: response.body });
    } else {
      latencies.push(Number(durationMs.toFixed(3)));
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const maximum = sorted.length ? sorted[sorted.length - 1] : null;
  const result = failures.length === 0 && p95 !== null && p95 <= acceptanceFloorMs ? 'passed' : 'failed';
  const report = {
    schemaVersion: '1.0.0',
    measure: 'registration-p95-latency',
    completedAt: new Date().toISOString(),
    environment: {
      gatewayBaseUrl,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    configuration: { sampleSize, warmupSize, acceptanceFloorMs, targetMs },
    metrics: {
      successfulRequests: latencies.length,
      failedRequests: failures.length,
      p50Ms: p50,
      p95Ms: p95,
      maximumMs: maximum,
      targetMet: p95 !== null && p95 <= targetMs,
      acceptanceFloorMet: p95 !== null && p95 <= acceptanceFloorMs,
    },
    result,
    failures,
    latenciesMs: latencies,
  };

  fs.mkdirSync(resultsDirectory, { recursive: true });
  const outputPath = path.join(resultsDirectory, 'registration-latency.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Registration latency: p50=${p50}ms p95=${p95}ms max=${maximum}ms (${result})`);
  console.log(`Wrote ${outputPath}`);
  if (result !== 'passed') process.exitCode = 1;
}

async function register(accessToken, suffix) {
  const response = await fetch(`${gatewayBaseUrl}/v1/registrations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-correlation-id': `latency-${suffix}`,
    },
    body: JSON.stringify({
      agentLearnerKey: clientId,
      model: { provider: 'synthetic', version: '1.0.0' },
      systemPromptHash: `sha256:${suffix}`,
      approvedToolManifest: [{ name: 'knowledge.lookup', version: '1.0.0', permissions: ['read'] }],
      policyConfigurationHash: 'sha256:latency-policy',
      adapterVersion: 'latency-runner-1.0.0',
    }),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

function percentile(sorted, value) {
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[index];
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
