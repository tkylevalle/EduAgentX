// Builds docs/poc/EduAgentX-PoC.pptx. Diagrams are native shapes so the team can edit them.
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const ROOT = path.resolve(__dirname, '../../..');
const SHOT = (name) => path.join(ROOT, 'docs/poc/screens', `${name}.png`);
const OUT = path.join(ROOT, 'docs/poc/EduAgentX-PoC.pptx');

const C = {
  ink: '050608', panel: '0B0D11', panel2: '11141A', line: '232A35', lineHi: '343D4B',
  text: 'F2F4F7', text2: 'AEB6C4', text3: '6F7889',
  signal: '5CF2B4', danger: 'FF5A4E', amber: 'FFBF47', info: '86AEFF', signalInk: '021A10',
};
const F = { head: 'Bahnschrift', body: 'Segoe UI', mono: 'Cascadia Mono' };
const W = 13.333, H = 7.5;
const TOTAL = 16;

const pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'EduAgentX — Proof of Concept';
pres.company = 'EduAgentX capstone team';

// ── primitives ──────────────────────────────────────────
const box = (s, x, y, w, h, { fill = C.panel, line = C.line, lw = 0.75, dash } = {}) =>
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: fill ? { color: fill } : { type: 'none' },
    line: line ? { color: line, width: lw, ...(dash ? { dashType: dash } : {}) } : { type: 'none' } });
const label = (s, text, x, y, w, opts = {}) =>
  s.addText(text, { x, y, w, h: opts.h || 0.25, fontFace: F.mono, fontSize: opts.size || 9, color: opts.color || C.text3,
    charSpacing: 1.5, margin: 0, valign: 'middle', bold: !!opts.bold, align: opts.align || 'left' });
const text = (s, t, x, y, w, h, o = {}) =>
  s.addText(t, { x, y, w, h, fontFace: o.face || F.body, fontSize: o.size || 13, color: o.color || C.text2, margin: 0,
    valign: o.valign || 'top', bold: !!o.bold, align: o.align || 'left', lineSpacingMultiple: o.ls || 1.1, ...(o.extra || {}) });
const heading = (s, t, x, y, w, h, size = 30, color = C.text) =>
  s.addText(t.toUpperCase(), { x, y, w, h, fontFace: F.head, fontSize: size, bold: true, color, margin: 0, valign: 'top', charSpacing: 0.5 });
const arrow = (s, x1, y1, x2, y2, { color = C.lineHi, width = 1.25, dash, head = 'triangle' } = {}) => {
  const flipH = x2 < x1, flipV = y2 < y1;
  s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(0.001, Math.abs(x2 - x1)),
    h: Math.max(0.001, Math.abs(y2 - y1)), flipH, flipV,
    line: { color, width, endArrowType: head, ...(dash ? { dashType: dash } : {}) } });
};
const pill = (s, t, x, y, w, color) => {
  box(s, x, y, w, 0.26, { fill: C.ink, line: color });
  s.addText(t.toUpperCase(), { x, y, w, h: 0.26, fontFace: F.mono, fontSize: 8, color, align: 'center', valign: 'middle', margin: 0, charSpacing: 1 });
};

// Every content slide: requirement tag, index, title, footer.
function frame(n, req, title, kicker) {
  const s = pres.addSlide();
  s.background = { color: C.ink };
  box(s, 0.45, 0.42, 0.62, 0.62, { fill: C.panel, line: C.line });
  s.addText(String(n).padStart(2, '0'), { x: 0.45, y: 0.42, w: 0.62, h: 0.62, fontFace: F.mono, fontSize: 13, color: C.signal, align: 'center', valign: 'middle', margin: 0 });
  if (req) label(s, req, 1.27, 0.42, 8, { color: C.signal, size: 9 });
  heading(s, title, 1.27, 0.66, 11.6, 0.6, 28);
  if (kicker) text(s, kicker, 1.27, 1.2, 11.5, 0.35, { size: 12.5, color: C.text3 });
  s.addShape(pres.shapes.LINE, { x: 0.45, y: 7.03, w: W - 0.9, h: 0, line: { color: C.line, width: 0.75 } });
  label(s, 'EDUAGENTX · PROOF OF CONCEPT · 19 OCT 2026', 0.45, 7.1, 6);
  label(s, `${String(n).padStart(2, '0')} / ${TOTAL}`, W - 2.45, 7.1, 2, { align: 'right' });
  return s;
}
const shot = (s, name, x, y, w, h, crop) => {
  box(s, x - 0.04, y - 0.04, w + 0.08, h + 0.08, { fill: C.panel, line: C.lineHi });
  s.addImage({ path: SHOT(name), x, y, w, h, sizing: { type: 'cover', w, h, ...(crop || {}) } });
};

// ── 1 · title ────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.ink };
  label(s, 'CSCI435 CAPSTONE · PROOF OF CONCEPT · REMO · MON 19 OCT 2026', 0.6, 0.6, 8, { color: C.signal });
  s.addText('EDUAGENTX', { x: 0.55, y: 1.15, w: 6.6, h: 1.2, fontFace: F.head, fontSize: 66, bold: true, color: C.text, margin: 0, charSpacing: 1 });
  heading(s, 'Competency assurance for AI agents', 0.6, 2.35, 6.2, 1.0, 24, C.signal);
  text(s, 'Train an agent on a validated curriculum, examine it adversarially, fail it closed on any unsafe action, and issue a signed credential that anyone can verify, suspend or revoke.',
    0.6, 3.35, 5.9, 1.3, { size: 14.5, color: C.text2, ls: 1.2 });
  const facts = [['14', 'services live'], ['547', 'unit tests passing'], ['8', 'lifecycle stages, one real run']];
  facts.forEach(([v, k], i) => {
    const x = 0.6 + i * 1.98;
    box(s, x, 4.95, 1.85, 1.15, { fill: C.panel, line: C.line });
    s.addText(v, { x: x + 0.18, y: 5.05, w: 1.6, h: 0.6, fontFace: F.head, fontSize: 30, bold: true, color: C.text, margin: 0 });
    label(s, k.toUpperCase(), x + 0.18, 5.7, 1.65, { size: 7.5 });
  });
  label(s, 'RANIYA · PRANAV · TIMOTHY · NEERAJ · TIMURMALIK · LUIS · SALMAN', 0.6, 6.55, 7);
  shot(s, 'lab-passed', 7.05, 0.6, 5.75, 6.3, { x: 0.15, y: 0 });
}

// ── 2 · problem ──────────────────────────────────────────
{
  const s = frame(2, '1 · PROBLEM WE ARE SOLVING', 'Agents are deployed on trust, not evidence',
    'Organisations hand AI agents real tools and data. Nothing today proves an agent is competent and safe in a domain, or withdraws that proof.');
  const items = [
    ['01', 'No standard certification', 'There is no agreed way to show an agent can do a domain\'s work safely before it is deployed.', '23% of organisations already run agentic AI in at least one function (McKinsey, 2025).', C.signal],
    ['02', 'Benchmarks reward memorising', 'Static question sets leak into training data; scores inflate while skill does not.', 'Benchmark contamination inflates scores across major suites (Katzman et al., 2025; Xu et al., 2025).', C.info],
    ['03', 'A high score hides one unsafe act', 'An agent at 90% that follows one injected instruction is still unsafe. Averages cannot see that.', 'In our run: 90% overall, failed on rule critical-o4.', C.danger],
    ['04', 'Claims cannot be checked or revoked', 'A badge on a web page cannot be verified, suspended when risk appears, or matched to work.', '40% of enterprise software expected to use task-focused agents by end of 2026 (Gartner, 2025).', C.amber],
  ];
  items.forEach(([n, t, body, fact, color], i) => {
    const x = 0.45 + i * 3.13, y = 1.85, w = 2.98, h = 4.85;
    box(s, x, y, w, h, { fill: C.panel, line: C.line });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.06, fill: { color }, line: { type: 'none' } });
    s.addText(n, { x: x + 0.25, y: y + 0.3, w: 1, h: 0.6, fontFace: F.head, fontSize: 34, bold: true, color, margin: 0 });
    heading(s, t, x + 0.25, y + 1.05, w - 0.45, 0.9, 17);
    text(s, body, x + 0.25, y + 2.0, w - 0.45, 1.5, { size: 12.5, ls: 1.2 });
    s.addShape(pres.shapes.LINE, { x: x + 0.25, y: y + 3.6, w: w - 0.5, h: 0, line: { color: C.line, width: 0.75, dashType: 'dash' } });
    text(s, fact, x + 0.25, y + 3.75, w - 0.45, 1.0, { size: 10, color: C.text3, face: F.mono, ls: 1.15 });
  });
}

// ── 3 · differentiation table ────────────────────────────
{
  const s = frame(3, '2 · WHAT DIFFERENTIATES US FROM COMPETITORS', 'Built for agents, and built to fail closed',
    'Learning platforms certify people. Benchmarks score models. None of them examine, certify and keep revoking the right of an agent to act.');
  const yes = (t) => ({ text: `✓  ${t}`, options: { color: C.signal } });
  const no = (t = 'Not offered') => ({ text: `✕  ${t}`, options: { color: C.text3 } });
  const part = (t) => ({ text: `◐  ${t}`, options: { color: C.amber } });
  const head = ['Capability', 'EduAgentX', 'Coursera / edX', 'LinkedIn Learning', 'Pluralsight', 'HumanLayer', 'Stanford HELM'];
  const rows = [
    ['Who is the learner', yes('AI agents'), no('Humans'), no('Humans'), no('Humans'), part('Humans + agent workflows'), part('Language models')],
    ['Curriculum', yes('Pinned sources, 6 gates, 2 reviewers'), no('Human SMEs'), no('Human SMEs'), no('Human SMEs'), no(), part('Fixed scenarios')],
    ['Adversarial examination', yes('15 items, 4 adversarial'), no('Static quizzes'), no('Static quizzes'), part('Skill assessments'), no(), part('Static benchmark')],
    ['Fails closed on unsafe action', yes('Critical rules beat score'), no(), no(), no(), part('Human approval gates'), no('Reports metrics')],
    ['Targeted remediation', yes('Gap → retrain → re-exam'), no(), no(), part('Course suggestions'), no(), no()],
    ['Verifiable credential', yes('W3C VC 2.0, Ed25519'), part('Course certificate'), part('Completion certificate'), part('Course certificate'), no(), no('Leaderboard')],
    ['Suspend / revoke status', yes('Live status registry'), no(), no(), part('Licence expiry'), no(), no()],
    ['Marketplace eligibility', yes('Hard credential gates'), no(), no(), no(), no(), no()],
  ];
  const cell = (c, i, r) => {
    const base = { fontFace: i === 0 ? F.head : F.body, fontSize: i === 0 ? 10.5 : 9.5, color: i === 0 ? C.text : C.text2, bold: i === 0,
      fill: { color: i === 1 ? '0E1A16' : (r % 2 ? C.panel : C.ink) }, valign: 'middle', margin: [3, 8, 3, 8] };
    return typeof c === 'string' ? { text: c, options: base } : { text: c.text, options: { ...base, ...c.options } };
  };
  const table = [head.map((h, i) => ({ text: h.toUpperCase(), options: { fontFace: F.mono, fontSize: 8.5, color: i === 1 ? C.signal : C.text3,
    fill: { color: i === 1 ? '0E1A16' : C.panel2 }, bold: true, valign: 'middle', margin: [3, 8, 3, 8], charSpacing: 1 } }))]
    .concat(rows.map((row, r) => row.map((c, i) => cell(c, i, r))));
  s.addTable(table, { x: 0.45, y: 1.65, w: W - 0.9, colW: [2.15, 2.25, 1.6, 1.7, 1.6, 1.55, 1.58], rowH: 0.5,
    border: { type: 'solid', color: C.line, pt: 0.75 } });
  label(s, '✓ OFFERED   ◐ PARTIAL   ✕ NOT OFFERED · COMPETITOR SET FROM OUR WEEK 6 FEASIBILITY REPORT, PLUS HELM AS THE BENCHMARK BASELINE', 0.45, 6.78, 12.4, { size: 8 });
}

// ── 4 · solution loop ────────────────────────────────────
{
  const s = frame(4, '3 · SOLUTION OFFERED', 'One closed loop from curriculum to revocation',
    'Every stage is owned by one service and answered over a versioned contract. A failed exam is not the end: it opens a targeted remediation.');
  const stages = [['PACKAGE', 'validate + activate'], ['REGISTER', 'agent identity'], ['TRAIN', 'deliver, no fine-tune'], ['EXAMINE', '15 items, graded'],
    ['CERTIFY', 'decision + VC'], ['VERIFY', '7 checks'], ['MONITOR', 'posture, signals'], ['MARKET', 'eligibility']];
  const x0 = 0.45, y = 2.2, w = 1.4, gap = 0.15;
  stages.forEach(([t, sub], i) => {
    const x = x0 + i * (w + gap);
    const hot = t === 'EXAMINE';
    box(s, x, y, w, 1.15, { fill: hot ? '1A0F0E' : C.panel, line: hot ? C.danger : C.signal, lw: 1 });
    label(s, String(i + 1).padStart(2, '0'), x + 0.12, y + 0.1, 0.5, { color: hot ? C.danger : C.signal, size: 8 });
    s.addText(t, { x: x + 0.12, y: y + 0.38, w: w - 0.2, h: 0.4, fontFace: F.head, fontSize: 15, bold: true, color: C.text, margin: 0 });
    text(s, sub, x + 0.12, y + 0.78, w - 0.2, 0.3, { size: 9.5, color: C.text3 });
    if (i < stages.length - 1) arrow(s, x + w + 0.01, y + 0.575, x + w + gap - 0.01, y + 0.575, { color: C.signal, width: 1.5 });
  });
  // remediation branch: EXAMINE → gap → TRAIN
  const ex = x0 + 3 * (w + gap), tr = x0 + 2 * (w + gap);
  arrow(s, ex + w / 2, y + 1.15, ex + w / 2, y + 1.75, { color: C.danger, width: 1.5 });
  box(s, tr + 0.2, y + 1.75, 2.85, 0.75, { fill: '1A0F0E', line: C.danger, dash: 'dash' });
  s.addText('FAIL CLOSED → SKILL GAP → TARGETED RETRAINING', { x: tr + 0.3, y: y + 1.8, w: 2.7, h: 0.65, fontFace: F.mono, fontSize: 8.5, color: C.danger, margin: 0, valign: 'middle', charSpacing: 1 });
  arrow(s, tr + 0.5, y + 1.75, tr + 0.5, y + 1.15, { color: C.danger, width: 1.5 });
  const ideas = [
    ['Only the owner decides', 'Examination grades, Certification decides, Verification answers status. Nothing is decided twice or by the UI.'],
    ['Evidence, not claims', 'Every decision keeps ids, digests and timestamps. The credential carries the scores it was issued for.'],
    ['Fail closed', 'Missing evidence, an unreachable dependency or a critical rule stops the lifecycle. It never guesses yes.'],
  ];
  ideas.forEach(([t, b], i) => {
    const x = 0.45 + i * 4.18;
    box(s, x, 5.05, 4.0, 1.7, { fill: C.panel, line: C.line });
    heading(s, t, x + 0.22, 5.22, 3.6, 0.4, 15, C.signal);
    text(s, b, x + 0.22, 5.65, 3.6, 1.0, { size: 11.5, ls: 1.2 });
  });
}

// ── 5 · key features ─────────────────────────────────────
{
  const s = frame(5, '3 · KEY FEATURES', 'What the PoC actually does today', 'Each feature maps to a GitHub work package; all of them ran in the live lifecycle you will see.');
  const feats = [
    ['Domain Assurance Package', '#9 #10 #14', 'Immutable, versioned package: pinned sources, objectives, 5 modules, exam template, rubric, fallback bank. 6 automated gates, then 2 distinct reviewers before activation.'],
    ['Training without fine-tuning', '#12 #13', 'Event-sourced sessions pinned to one package and agent configuration. Delivers lessons and practice; model weights never change.'],
    ['Adversarial examination', '#16 #17 #18 #21', '15 items per attempt: 5 recall, 6 applied, 4 adversarial. Pass needs 80% overall, 70% adversarial and zero critical violations.'],
    ['Remediation loop', '#13 #21', 'A failure commits a remediation event with the exact skill gap. Training opens a session on those objectives only; only then is a re-exam admitted.'],
    ['Signed credential', '#23 #24', 'W3C VC 2.0 signed with Ed25519. Verifier checks signature, schema, time, suspension, revocation, issuer and type, each on its own.'],
    ['Operate and observe', '#25 #26 #28 #30', 'Monitoring projection per agent, issuance KPI, evidence bundle, and marketplace eligibility that fails closed without a valid credential.'],
  ];
  feats.forEach(([t, tag, b], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.45 + col * 4.18, y = 1.8 + row * 2.6;
    box(s, x, y, 4.0, 2.42, { fill: C.panel, line: C.line });
    label(s, tag, x + 0.22, y + 0.2, 3.6, { color: C.signal });
    heading(s, t, x + 0.22, y + 0.5, 3.6, 0.45, 16);
    text(s, b, x + 0.22, y + 1.0, 3.6, 1.35, { size: 11.5, ls: 1.2 });
  });
}

// ── 6 · architecture ─────────────────────────────────────
{
  const s = frame(6, '4 · MAIN DESIGN DIAGRAM · COMPONENT VIEW', 'Microservices behind one gateway',
    'Each service owns its data: one PostgreSQL schema and role per owner. Versioned HTTP plus Redis Streams with outboxes.');
  // actors
  const actor = (t, sub, y) => { box(s, 0.45, y, 1.95, 0.85, { fill: C.panel2, line: C.lineHi });
    s.addText(t, { x: 0.58, y: y + 0.1, w: 1.8, h: 0.35, fontFace: F.head, fontSize: 12, bold: true, color: C.text, margin: 0 });
    text(s, sub, 0.58, y + 0.45, 1.8, 0.35, { size: 9, color: C.text3 }); };
  actor('Agent Learner', 'external or synthetic', 2.15);
  actor('Operator', 'web app :4300', 3.35);
  actor('Verifier', 'anyone with a VC', 4.55);
  // gateway
  box(s, 2.85, 1.85, 1.55, 3.95, { fill: '0E1A16', line: C.signal, lw: 1 });
  s.addText('API\nGATEWAY', { x: 2.85, y: 2.2, w: 1.55, h: 0.8, fontFace: F.head, fontSize: 15, bold: true, color: C.text, align: 'center', margin: 0 });
  text(s, 'RS256 JWT\nroles\nrate limits\nenvelope\nvalidation\ncorrelation ids', 2.95, 3.1, 1.35, 2.5, { size: 9.5, color: C.text2, align: 'center', face: F.mono });
  [2.575, 3.775, 4.975].forEach((y) => arrow(s, 2.4, y, 2.85, y, { color: C.signal }));
  // service groups
  const groups = [
    ['CURRICULUM', ['curriculum-engine', 'validation-activation', 'curriculum-index']],
    ['LEARNING', ['agent-registry', 'training-service', 'synthetic-learner']],
    ['ASSESSMENT', ['examination-engine', 'grading-service']],
    ['TRUST', ['certification-service', 'credential-verification']],
    ['OPERATIONS', ['monitoring-service', 'evidence-bundle', 'marketplace-service']],
  ];
  groups.forEach(([g, svcs], i) => {
    const y = 1.85 + i * 0.8;
    label(s, g, 4.95, y + 0.2, 1.25, { color: C.text3, size: 8 });
    svcs.forEach((name, j) => {
      const x = 6.2 + j * 2.25;
      box(s, x, y + 0.04, 2.1, 0.6, { fill: C.panel, line: C.line });
      s.addText(name, { x: x + 0.1, y: y + 0.04, w: 1.95, h: 0.6, fontFace: F.mono, fontSize: 9.5, color: C.text, valign: 'middle', margin: 0 });
    });
    arrow(s, 4.4, y + 0.34, 4.9, y + 0.34, { color: C.lineHi, width: 1 });
  });
  // data layer
  const data = [['PostgreSQL', 'schema + role per owner'], ['Redis Streams', 'outbox → inbox events'], ['ChromaDB', 'rebuildable index'], ['Prometheus · Grafana', 'health + metrics']];
  data.forEach(([t, sub], i) => {
    const x = 2.85 + i * 2.5;
    box(s, x, 6.05, 2.35, 0.78, { fill: C.panel2, line: C.info });
    s.addText(t, { x: x + 0.12, y: 6.1, w: 2.2, h: 0.35, fontFace: F.head, fontSize: 12, bold: true, color: C.info, margin: 0 });
    text(s, sub, x + 0.12, 6.45, 2.2, 0.3, { size: 9, color: C.text3 });
  });
}

// ── 7 · sequence ─────────────────────────────────────────
{
  const s = frame(7, '4 · UML SEQUENCE · ONE LIFECYCLE RUN', 'Who answers each step',
    'The run you will see live. Solid: request. Dashed: event or reply. Red: the failure path that opens remediation.');
  const lanes = ['Agent\nLearner', 'API\nGateway', 'Training', 'Examination', 'Grading', 'Certification', 'Verification', 'Monitoring ·\nMarketplace'];
  const top = 1.7, bottom = 6.9, x0 = 1.1, step = 1.57;
  const lx = (i) => x0 + i * step;
  lanes.forEach((t, i) => {
    box(s, lx(i) - 0.7, top, 1.4, 0.55, { fill: i === 1 ? '0E1A16' : C.panel, line: i === 1 ? C.signal : C.lineHi });
    s.addText(t, { x: lx(i) - 0.7, y: top, w: 1.4, h: 0.55, fontFace: F.head, fontSize: 9.5, bold: true, color: C.text, align: 'center', valign: 'middle', margin: 0 });
    s.addShape(pres.shapes.LINE, { x: lx(i), y: top + 0.55, w: 0, h: bottom - top - 0.55, line: { color: C.line, width: 1, dashType: 'dash' } });
  });
  const msgs = [
    [0, 1, 'training.session.start (agent JWT)'],
    [1, 2, 'start session pinned to package'],
    [1, 7, 'training.started', 'dash'],
    [0, 1, 'POST /v1/examinations · 15 answers'],
    [1, 3, 'create attempt · record responses'],
    [3, 4, 'grade sweep: rubric + critical rules'],
    [4, 3, 'scores, violations → complete', 'dash'],
    [3, 2, 'agent_failed → remediation event (outbox)', 'dash', C.danger],
    [5, 3, 'read passed evidence (sweep)'],
    [5, 6, 'register status · active'],
    [5, 7, 'credential.issued (Redis Stream)', 'dash'],
    [1, 6, 'POST /v1/credentials/verify → 7 checks'],
  ];
  msgs.forEach(([a, b, t, dash, color], i) => {
    const y = top + 0.85 + i * 0.38;
    const c = color || (dash ? C.text3 : C.signal);
    arrow(s, lx(a) + (b > a ? 0.03 : -0.03), y, lx(b) + (b > a ? -0.03 : 0.03), y, { color: c, width: 1.1, dash: dash ? 'dash' : undefined });
    const left = Math.min(lx(a), lx(b));
    s.addText(`${i + 1}  ${t}`, { x: left + 0.06, y: y - 0.24, w: Math.max(2.6, Math.abs(lx(b) - lx(a)) - 0.1), h: 0.22, fontFace: F.mono, fontSize: 8,
      color: color || C.text2, margin: 0, valign: 'bottom' });
  });
}

// ── 8 · state machines ───────────────────────────────────
{
  const s = frame(8, '4 · UML STATE MACHINES', 'Two states that cannot lie',
    'An examination ends in exactly one terminal state. A credential is never rewritten: only its status changes, and revocation is final.');
  const state = (t, x, y, color, w = 2.0) => { box(s, x, y, w, 0.7, { fill: C.panel, line: color, lw: 1.25 });
    s.addText(t, { x, y, w, h: 0.7, fontFace: F.head, fontSize: 13, bold: true, color, align: 'center', valign: 'middle', margin: 0 }); };
  const note = (t, x, y, w, color = C.text3) => s.addText(t, { x, y, w, h: 0.3, fontFace: F.mono, fontSize: 8.5, color, margin: 0, valign: 'middle' });
  const dot = (x, y) => s.addShape(pres.shapes.OVAL, { x, y, w: 0.22, h: 0.22, fill: { color: C.text }, line: { type: 'none' } });
  // left panel: examination attempt
  box(s, 0.45, 1.75, 6.05, 5.1, { fill: C.ink, line: C.line });
  label(s, 'EXAMINATION ATTEMPT · ISSUES #17 #18 #21', 0.65, 1.9, 5.5, { color: C.signal });
  dot(0.62, 3.64); arrow(s, 0.84, 3.75, 0.95, 3.75, { color: C.text });
  state('IN PROGRESS', 0.95, 3.4, C.text, 1.7);
  state('COMPLETE', 4.25, 2.35, C.signal); state('AGENT FAILED', 4.25, 3.4, C.danger); state('SYSTEM ABORTED', 4.25, 4.45, C.amber);
  arrow(s, 2.65, 3.55, 4.25, 2.7, { color: C.signal }); note('graded pass', 2.7, 2.65, 1.2, C.signal);
  arrow(s, 2.65, 3.75, 4.25, 3.75, { color: C.danger });
  s.addText('critical rule ·\nbelow line · timeout', { x: 2.95, y: 3.25, w: 1.3, h: 0.45, fontFace: F.mono, fontSize: 7.5, color: C.danger, margin: 0, valign: 'bottom' });
  arrow(s, 2.65, 3.95, 4.25, 4.8, { color: C.amber });
  s.addText('grader or\ninfra fault', { x: 2.6, y: 4.38, w: 0.85, h: 0.42, fontFace: F.mono, fontSize: 7.5, color: C.amber, margin: 0 });
  box(s, 0.75, 5.6, 2.9, 0.8, { fill: '1A0F0E', line: C.danger, dash: 'dash' });
  s.addText('REMEDIATION ASSIGNED\nonly then a new attempt\nis admitted', { x: 0.85, y: 5.62, w: 2.75, h: 0.76, fontFace: F.mono, fontSize: 8.5, color: C.danger, margin: 0, valign: 'middle' });
  // AGENT FAILED → remediation, routed down the right side to clear SYSTEM ABORTED
  s.addShape(pres.shapes.LINE, { x: 6.25, y: 3.75, w: 0.12, h: 0, line: { color: C.danger, width: 1.25, dashType: 'dash' } });
  s.addShape(pres.shapes.LINE, { x: 6.37, y: 3.75, w: 0, h: 2.25, line: { color: C.danger, width: 1.25, dashType: 'dash' } });
  arrow(s, 6.37, 6.0, 3.65, 6.0, { color: C.danger, dash: 'dash' });
  arrow(s, 1.6, 5.6, 1.6, 4.1, { color: C.danger, dash: 'dash' }); note('new attempt', 1.7, 4.65, 1.2, C.danger);
  // right panel: credential status
  box(s, 6.83, 1.75, 6.05, 5.1, { fill: C.ink, line: C.line });
  label(s, 'COMPETENCY CREDENTIAL STATUS · ISSUES #23 #24', 7.03, 1.9, 5.5, { color: C.signal });
  dot(7.13, 3.09); arrow(s, 7.35, 3.2, 7.75, 3.2, { color: C.text }); note('issued (signed VC)', 7.15, 2.6, 2, C.text2);
  state('ACTIVE', 7.75, 2.85, C.signal); state('SUSPENDED', 10.6, 2.85, C.amber); state('REVOKED', 9.2, 5.0, C.danger);
  arrow(s, 9.75, 3.05, 10.6, 3.05, { color: C.amber }); note('suspend', 9.82, 2.7, 0.8, C.amber);
  arrow(s, 10.6, 3.4, 9.75, 3.4, { color: C.signal }); note('reinstate', 9.8, 3.45, 0.8, C.signal);
  arrow(s, 8.75, 3.55, 9.7, 5.0, { color: C.danger }); arrow(s, 11.6, 3.55, 10.7, 5.0, { color: C.danger });
  s.addText('revoke ·\nirreversible', { x: 9.65, y: 4.0, w: 1.1, h: 0.45, fontFace: F.mono, fontSize: 8.5, color: C.danger, align: 'center', margin: 0 });
  text(s, 'Verify answers VALID only while ACTIVE. Every change records actor, reason and time, and emits an event to monitoring.', 7.05, 6.05, 5.6, 0.7, { size: 10.5, color: C.text3 });
}

// ── 9 · interface ────────────────────────────────────────
{
  const s = frame(9, '5 · POLISHED INTERFACE · REAL FRONTEND, LIVE DATA', 'An operator console, not a mock-up',
    'React + Express on :4300. Credentials stay on the server; the browser only sees sanitized reads and a live NDJSON stream of the run.');
  shot(s, 'overview', 0.5, 1.75, 8.0, 4.7);
  label(s, 'OVERVIEW · LIVE LEDGER, POSTURE, ACTIVITY', 0.5, 6.53, 8, { color: C.text2, size: 8.5 });
  [['credentials', 'CREDENTIALS · VC + STATUS CONTROL'], ['curriculum', 'DOMAIN ASSURANCE PACKAGE']].forEach(([n, t], i) => {
    const y = 1.75 + i * 2.45;
    shot(s, n, 8.8, y, 4.05, 2.05, { y: 0 });
    label(s, t, 8.8, y + 2.1, 4.05, { color: C.text2, size: 8.5 });
  });
}

// ── 10 · in action: fail closed ──────────────────────────
{
  const s = frame(10, '6 · SYSTEM IN ACTION · RUN 1', 'A hostile agent scores 90% and still fails',
    'Synthetic Agent Learner, "hostile instruction" behaviour, through the real stack.');
  shot(s, 'lab-failed-exam', 0.5, 1.75, 8.6, 5.05);
  const notes = [
    [C.danger, 'Fails closed', '100% recall, 100% applied, 90% overall. One adversarial answer followed an injected instruction (critical-o4), so the attempt is agent_failed.'],
    [C.text, 'No credential', 'Certification never sees a passing result, so stages 5–8 never run.'],
    [C.amber, 'Remediation, not a dead end', 'The skill gap (objective o4) is committed with the failure and delivered to Training through the outbox.'],
  ];
  notes.forEach(([c, t, b], i) => {
    const y = 1.75 + i * 1.72;
    box(s, 9.4, y, 3.48, 1.58, { fill: C.panel, line: C.line });
    s.addShape(pres.shapes.RECTANGLE, { x: 9.4, y, w: 0.06, h: 1.58, fill: { color: c }, line: { type: 'none' } });
    heading(s, t, 9.62, y + 0.15, 3.1, 0.35, 14, c);
    text(s, b, 9.62, y + 0.55, 3.15, 1.0, { size: 10.5, ls: 1.15 });
  });
}

// ── 11 · in action: remediation → credential ─────────────
{
  const s = frame(11, '6 · SYSTEM IN ACTION · RUN 2', 'Retrain on the gap, re-examine, certify',
    'Same agent, competent behaviour. The gate now admits it only through the targeted remediation session.');
  shot(s, 'lab-remediation', 0.5, 1.75, 6.15, 5.05, { x: 0.05 });
  shot(s, 'lab-passed', 6.85, 1.75, 6.0, 3.3, { y: 0 });
  const steps = [['TRAIN', 'targeted remediation · objective o4 only'], ['EXAMINE', '94.4% · adversarial 86% · passed'], ['CERTIFY', 'W3C VC signed with Ed25519'],
    ['VERIFY', 'VALID → suspended INVALID → reinstated VALID']];
  steps.forEach(([k, v], i) => {
    const y = 5.25 + i * 0.4;
    label(s, k, 6.9, y, 1.2, { color: C.signal, bold: true });
    text(s, v, 8.1, y, 4.8, 0.25, { size: 11, color: C.text2, valign: 'middle' });
  });
}

// ── 12 · trust: tamper ───────────────────────────────────
{
  const s = frame(12, '6 · SYSTEM IN ACTION · VERIFICATION', 'Change one number and the credential dies',
    'Anyone can paste a credential. We raise the claimed score to 100% and keep the original signature: exactly what a forger would try.');
  shot(s, 'verify-tampered', 0.5, 1.75, 8.6, 5.05);
  const bullets = [['Signature', 'Ed25519 over the exact bytes. Any edit fails the first check.'], ['Status', 'Asked live from the status registry, not stored in the token.'],
    ['Policy', 'Issuer must be trusted and the type must be a competency credential.'], ['Independent', 'Each of the 7 checks reports on its own, so a report says why.']];
  bullets.forEach(([t, b], i) => {
    const y = 1.85 + i * 1.22;
    label(s, String(i + 1).padStart(2, '0'), 9.45, y, 0.5, { color: C.signal });
    heading(s, t, 9.95, y - 0.02, 2.9, 0.35, 14);
    text(s, b, 9.95, y + 0.38, 2.9, 0.75, { size: 10.5 });
  });
}

// ── 13 · evidence ────────────────────────────────────────
{
  const s = frame(13, '6 · WHAT WE IMPLEMENTED SO FAR', 'Measured, not claimed', 'Numbers from the run on 18 Oct 2026 on one laptop (Docker Compose).');
  const stats = [['547', '/ 0 failed', 'unit + integration tests across 19 components'], ['14/14', 'healthy', 'services probed live from inside the network'],
    ['16/16', 'steps', 'end-to-end smoke through the Gateway'], ['560', 'ms p95', 'credential issuance vs 5,000 ms target'], ['7/7', 'checks', 'independent verification checks per credential'],
    ['29', 'of 35', 'work packages merged (Sprints 1–4 + #30)']];
  stats.forEach(([v, u, k], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 0.45 + col * 2.75, y = 1.8 + row * 1.85;
    box(s, x, y, 2.6, 1.7, { fill: C.panel, line: C.line });
    s.addText([{ text: v, options: { fontFace: F.head, fontSize: 34, bold: true, color: C.text } }, { text: `  ${u}`, options: { fontFace: F.mono, fontSize: 10, color: C.text3 } }],
      { x: x + 0.2, y: y + 0.2, w: 2.35, h: 0.75, margin: 0, valign: 'bottom' });
    text(s, k, x + 0.2, y + 1.05, 2.25, 0.6, { size: 10.5, color: C.text2 });
  });
  box(s, 8.85, 1.8, 4.03, 3.55, { fill: C.panel, line: C.line });
  label(s, 'REAL', 9.05, 1.95, 2, { color: C.signal, bold: true });
  text(s, 'Services, PostgreSQL schemas, Redis Streams, JWT auth, Ed25519 signatures, status registry, grading pipeline, outboxes, monitoring events, marketplace projection.', 9.05, 2.25, 3.65, 1.3, { size: 10.5 });
  label(s, 'SIMULATED · STATED OPENLY', 9.05, 3.6, 3.5, { color: C.amber, bold: true });
  text(s, 'The agent is the deterministic Synthetic Agent Learner. Grading is a deterministic keyword rubric, not an LLM judge. Capability requests are simulated. Runs locally.', 9.05, 3.9, 3.65, 1.35, { size: 10.5 });
  box(s, 0.45, 5.55, 12.43, 1.25, { fill: '0E1A16', line: C.signal });
  label(s, 'INTEGRATION FIXED FOR THE POC', 0.65, 5.68, 6, { color: C.signal, bold: true });
  text(s, 'Certification → verification status → Redis Stream → monitoring + marketplace now run as one lifecycle. A passed re-examination now closes the remediation gate (it blocked forever before). One driver runs the whole lifecycle from the CLI or the web app.',
    0.65, 5.98, 12.0, 0.8, { size: 11 });
}

// ── 14 · live demo runbook ───────────────────────────────
{
  const s = frame(14, '6 · LIVE DEMO · ABOUT 4 MINUTES', 'What we will click', 'If the network fails, slides 10–12 are screenshots of this exact run.');
  const steps = [
    ['Overview', 'Live ledger: credentials, issuance p95, gates, posture. Every number is read from the services.'],
    ['Lifecycle Lab · key 2 · Enter', 'Hostile instruction. Watch stages stream in; exam fails closed on critical-o4; remediation delivered.'],
    ['Lifecycle Lab · key 1 · Enter', 'Competent agent. Training starts the targeted o4 session; re-exam passes; credential signed and verified.'],
    ['Credentials', 'Open the new credential. Suspend with a reason → live verify says INVALID. Reinstate → VALID.'],
    ['Verify', 'Load latest credential → VALID on 7 checks. Tamper with score → signature fails → INVALID.'],
    ['Curriculum · System', 'The package behind it all (6 gates, 2 reviewers, 15-slot blueprint) and the 14 services by layer.'],
  ];
  steps.forEach(([t, b], i) => {
    const y = 1.8 + i * 0.84;
    box(s, 0.45, y, 12.43, 0.72, { fill: i % 2 ? C.ink : C.panel, line: C.line });
    s.addText(String(i + 1), { x: 0.6, y, w: 0.5, h: 0.72, fontFace: F.head, fontSize: 22, bold: true, color: C.signal, valign: 'middle', margin: 0 });
    heading(s, t, 1.2, y + 0.2, 3.6, 0.35, 13);
    text(s, b, 4.9, y, 7.8, 0.72, { size: 11.5, valign: 'middle' });
  });
}

// ── 15 · team ────────────────────────────────────────────
{
  const s = frame(15, 'WHO BUILT WHAT', '7 people · 5 sprints · 35 work packages',
    'Planned primary owner of each package, one per person per sprint. Sprint 5 has just started; we pivoted to integrate the PoC.');
  const people = ['Raniya', 'Pranav', 'Timothy', 'Neeraj', 'Timurmalik', 'Luis', 'Salman'];
  const plan = {
    Raniya: ['#2 Docker Compose platform', '#10 Validation, review, activation', '#18 Grading, rubric, critical rules', '#26 Console overview + records', '#34 Hero scenarios, fault injection'],
    Pranav: ['#3 Gateway, auth, contracts', '#11 ChromaDB index + rebuild', '#19 Labelled dataset, grading KPIs', '#27 Governance, demo lab, permissions', '#35 Marketplace console, final evidence'],
    Timothy: ['#4 Agent Registry core', '#12 Training delivery + sessions', '#20 Deterministic fallback exam', '#28 Operations, evidence bundle', '#36 Release hardening, handoff'],
    Neeraj: ['#5 External protocol + synthetic learner', '#13 Practice, remediation, progress', '#21 Adversarial scenarios, remediation', '#29 Integration, recovery, security', '#30 Capability requests, eligibility'],
    Timurmalik: ['#6 PostgreSQL, Redis Streams, idempotency', '#14 Freshness, quarantine, fallback', '#22 Sprint 3 integration + evidence', '#23 Certification decisions, issuance', '#31 Ranking, near matches'],
    Luis: ['#7 Automated, security, integration tests', '#15 Sprint 2 integration + evidence', '#16 Exam generation, template policy', '#24 Signing, verification, status', '#32 Skill gap remediation contracts'],
    Salman: ['#8 Telemetry, demo, evidence pack', '#9 Domain Assurance Package model', '#17 Exam attempt state, atomicity', '#25 Monitoring projections, signals', '#33 1,000-scenario end-to-end suite'],
  };
  const head = ['', 'SPRINT 1 · PLATFORM', 'SPRINT 2 · CURRICULUM', 'SPRINT 3 · EXAMINATION', 'SPRINT 4 · TRUST', 'SPRINT 5 · MARKETPLACE'];
  const rows = [head.map((h, i) => ({ text: h, options: { fontFace: F.mono, fontSize: 8, bold: true, color: i === 5 ? C.amber : C.text3, fill: { color: C.panel2 }, margin: [3, 6, 3, 6], valign: 'middle' } }))];
  people.forEach((p, r) => rows.push([{ text: p.toUpperCase(), options: { fontFace: F.head, fontSize: 11, bold: true, color: C.text, fill: { color: r % 2 ? C.panel : C.ink }, margin: [3, 8, 3, 8], valign: 'middle' } }]
    .concat(plan[p].map((t, i) => ({ text: t, options: { fontFace: F.body, fontSize: 9, color: i === 4 && !t.startsWith('#30') ? C.text3 : C.text2, fill: { color: r % 2 ? C.panel : C.ink }, margin: [3, 6, 3, 6], valign: 'middle' } })))));
  s.addTable(rows, { x: 0.45, y: 1.75, w: W - 0.9, colW: [1.38, 2.21, 2.21, 2.21, 2.21, 2.21], rowH: 0.6, border: { type: 'solid', color: C.line, pt: 0.75 } });
  label(s, 'GREY = OPEN (#31–#36) · SWAPS IN PRACTICE: #4 BUILT BY NEERAJ, #8 BY TIMURMALIK, #30 BY TIMOTHY · PoC INTEGRATION + WEB APP: NEERAJ', 0.45, 6.7, 12, { size: 8 });
}

// ── 16 · close ───────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.ink };
  label(s, 'THANK YOU · QUESTIONS', 0.6, 0.6, 6, { color: C.signal });
  s.addText('PROVE IT.\nTHEN KEEP\nPROVING IT.', { x: 0.55, y: 1.1, w: 7.5, h: 3.4, fontFace: F.head, fontSize: 58, bold: true, color: C.text, margin: 0, lineSpacingMultiple: 0.95 });
  text(s, 'An agent earns a credential through evidence, loses it the moment the evidence changes, and is routed back to targeted training when it fails.', 0.6, 4.65, 6.6, 1.0, { size: 14, ls: 1.2 });
  box(s, 0.6, 5.85, 6.4, 0.75, { fill: C.panel, line: C.line });
  s.addText('docker compose -p eduagentx-poc up -d --wait   →   localhost:4300', { x: 0.75, y: 5.85, w: 6.2, h: 0.75, fontFace: F.mono, fontSize: 11, color: C.signal, valign: 'middle', margin: 0 });
  label(s, 'NEXT · SPRINT 5', 8.0, 0.6, 4, { color: C.amber });
  ['#31 Ranking, near matches and explanations', '#32 Skill gap remediation contracts', '#33 1,000-scenario end-to-end suite', '#34 Hero scenarios and fault injection',
    '#35 Marketplace console and final evidence', '#36 Release hardening and handoff drill'].forEach((t, i) => {
    const y = 1.1 + i * 0.9;
    box(s, 8.0, y, 4.85, 0.75, { fill: C.panel, line: C.line });
    text(s, t, 8.2, y, 4.5, 0.75, { size: 12, valign: 'middle', color: C.text2 });
  });
}

pres.writeFile({ fileName: OUT }).then((f) => console.log('wrote', f));
