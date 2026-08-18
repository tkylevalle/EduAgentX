// assurance-console (Sprint 1)
//
// Just a placeholder page so "minimal Assurance Console" is actually
// running as part of the stack. Real console (Overview, Lifecycle,
// Governance, etc.) is Sprint 4 territory.

const express = require('express');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 4100;
const SERVICE_NAME = process.env.SERVICE_NAME || 'assurance-console';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api-gateway:4000';

const app = express();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: SERVICE_NAME });
});

app.get('/', async (req, res) => {
  let gatewayStatus = 'unknown';
  try {
    const r = await fetch(`${API_GATEWAY_URL}/health`);
    gatewayStatus = r.ok ? 'reachable' : `unreachable (${r.status})`;
  } catch (err) {
    gatewayStatus = `unreachable (${err.message})`;
  }

  res.status(200).send(`<!doctype html>
<html>
  <head><title>EduAgentX Assurance Console (Sprint 1 shell)</title></head>
  <body style="font-family: sans-serif; padding: 2rem;">
    <h1>EduAgentX Assurance Console</h1>
    <p>Minimal Sprint 1 shell only. Real Overview / Lifecycle / Governance /
       Evidence / Operations / Marketplace views aren't built yet.</p>
    <p>API Gateway status: <strong>${gatewayStatus}</strong></p>
  </body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on ${PORT}`);
});
