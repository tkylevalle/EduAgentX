'use strict';

// DEMO FIXTURE ONLY - this is NOT validation-activation.
//
// It serves one made-up Domain Assurance Package in exactly the shape
// training-service/clients.js expects, so Training can be checked end to end
// while the real Active state is not yet durable. The lesson text is
// placeholder content, not approved teaching material. POST /__control is a
// stub-only route that changes the package state and digest; the real
// service has nothing like it. Never run this outside a local check.
//
// Run: node services/training-service/dev/stub-package-service.js  (PORT, default 4010)

const http = require('node:http');

const PORT = Number(process.env.PORT || 4010);
const STATES = ['Active', 'Quarantined', 'Candidate', 'Superseded'];

const lesson = (moduleId, n, text) => ({ id: `${moduleId}-lesson-${n}`, kind: 'lesson', text });
// Every module ends with one practice item, so the default completion policy
// (TRAINING_MIN_PRACTICE_PER_MODULE=1) accepts the package.
const practice = (moduleId, text) => ({ id: `${moduleId}-practice-1`, kind: 'practice', text });
// Listed out of `sequence` order on purpose, so delivery order is visibly
// decided by `sequence` and not by array position. Module m2 has two lessons.
const modules = [
  { id: 'm3', sequence: 3, title: 'Generative AI failure modes', content: 'Demo content for module 3.',
    objectiveIds: ['o3'], deliveryItems: [lesson('m3', 1, 'Demo lesson: spot a confabulated claim and escalate.'),
      practice('m3', 'Demo practice: rewrite a confabulated answer with a citation.')] },
  { id: 'm1', sequence: 1, title: 'AI systems, actors, and impacts', content: 'Demo content for module 1.',
    objectiveIds: ['o1'], deliveryItems: [lesson('m1', 1, 'Demo lesson: draw the system boundary of an agent.'),
      practice('m1', 'Demo practice: name the actors for a given agent.')] },
  { id: 'm5', sequence: 5, title: 'Adversarial evaluation and response', content: 'Demo content for module 5.',
    objectiveIds: ['o5'], deliveryItems: [lesson('m5', 1, 'Demo lesson: classify a poisoning scenario.'),
      practice('m5', 'Demo practice: choose a response to a poisoning alert.')] },
  { id: 'm2', sequence: 2, title: 'Lifecycle risk management', content: 'Demo content for module 2.',
    objectiveIds: ['o2'], deliveryItems: [
      lesson('m2', 1, 'Demo lesson: Govern and Map an agent use case.'),
      lesson('m2', 2, 'Demo lesson: Measure and Manage residual risk.'),
      practice('m2', 'Demo practice: pick the treatment for a residual risk.'),
    ] },
  { id: 'm4', sequence: 4, title: 'Safe agent autonomy', content: 'Demo content for module 4.',
    objectiveIds: ['o4'], deliveryItems: [lesson('m4', 1, 'Demo lesson: refuse a goal-hijacking instruction.'),
      practice('m4', 'Demo practice: answer a goal-hijacking prompt safely.')] },
];
const objectives = modules.map((module, index) => ({
  id: module.objectiveIds[0],
  statement: `Demo objective ${index + 1}`,
  deliveryItemIds: module.deliveryItems.map((item) => item.id),
}));

const current = { packageId: 'demo-ai-safety', version: '1.0.0', digest: 'demo-digest-1', state: 'Active' };

// The response shape clients.js maps with toPackageRecord.
const packageBody = () => ({
  packageId: current.packageId, digest: current.digest, version: current.version, state: current.state,
  objectives, modules,
});

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://stub');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'stub-package-service' });
  // The stub's single package stands in for whatever the active pointer holds,
  // whatever its state, so Training's own state checks are what get tested.
  if (req.method === 'GET' && url.pathname === '/packages/active') return send(res, 200, packageBody());
  if (req.method === 'GET' && url.pathname.startsWith('/packages/')) {
    const id = decodeURIComponent(url.pathname.slice('/packages/'.length));
    return id === current.packageId ? send(res, 200, packageBody()) : send(res, 404, { error: 'not_found' });
  }
  if (req.method === 'POST' && url.pathname === '/__control') {
    const body = await readJson(req);
    if (!body || (body.state !== undefined && !STATES.includes(body.state)) ||
      (body.digest !== undefined && (typeof body.digest !== 'string' || !body.digest))) {
      return send(res, 400, { error: 'invalid_control', allowedStates: STATES });
    }
    if (body.state !== undefined) current.state = body.state;
    if (body.digest !== undefined) current.digest = body.digest;
    return send(res, 200, { state: current.state, digest: current.digest });
  }
  return send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`[stub-package-service] DEMO FIXTURE listening on ${PORT}`));
