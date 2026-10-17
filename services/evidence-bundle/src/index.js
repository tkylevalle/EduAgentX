'use strict';
const express = require('express');
const { buildBundle, renderHTML } = require('./bundle');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'evidence-bundle' });
});

// POST /bundle — generate a sanitized evidence bundle (JSON)
app.post('/bundle', (req, res) => {
  try {
    const bundle = buildBundle(req.body || {});
    res.json(bundle);
  } catch (err) {
    res.status(422).json({ error: 'bundle_failed', message: err.message });
  }
});

// POST /bundle/html — generate a sanitized HTML evidence bundle
app.post('/bundle/html', (req, res) => {
  try {
    const bundle = buildBundle(req.body || {});
    const html = renderHTML(bundle);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(422).json({ error: 'bundle_failed', message: err.message });
  }
});

const PORT = process.env.PORT || 4050;
app.listen(PORT, () => console.log(`[evidence-bundle] listening on ${PORT}`));
module.exports = { app };
