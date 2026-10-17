'use strict';
const express = require('express');
const { ingestEvent, getSnapshot, getServiceHealth, getAgentAssurance, getAllKPIs, getAttention, updateServiceHealth } = require('./projections');

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'monitoring-service' });
});

// GET /snapshot — full read-only projection snapshot
app.get('/snapshot', (_req, res) => {
  res.json(getSnapshot());
});

// GET /health/services — operational health per service
app.get('/health/services', (_req, res) => {
  const snapshot = getSnapshot();
  res.json(snapshot.operationalHealth);
});

// GET /health/services/:serviceId
app.get('/health/services/:serviceId', (req, res) => {
  res.json(getServiceHealth(req.params.serviceId));
});

// GET /assurance/:agentId — assurance posture for one agent
app.get('/assurance/:agentId', (req, res) => {
  res.json(getAgentAssurance(req.params.agentId));
});

// GET /kpis — all KPI evidence
app.get('/kpis', (_req, res) => {
  res.json(getAllKPIs());
});

// GET /attention — deduplicated attention records
app.get('/attention', (_req, res) => {
  res.json(getAttention());
});

// POST /events — ingest a domain event (read-only projection, never writes authoritative data)
app.post('/events', (req, res) => {
  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ error: 'missing_event_type' });
  ingestEvent(event);
  res.status(202).json({ accepted: true, type: event.type });
});

// POST /heartbeat — services ping their health here
app.post('/heartbeat', (req, res) => {
  const { serviceId, status, metrics } = req.body || {};
  if (!serviceId) return res.status(400).json({ error: 'missing_serviceId' });
  updateServiceHealth(serviceId, status || 'ok', metrics || {});
  res.json({ recorded: true, serviceId });
});

const PORT = process.env.PORT || 4040;
app.listen(PORT, () => console.log(`[monitoring-service] listening on ${PORT}`));
module.exports = { app };
