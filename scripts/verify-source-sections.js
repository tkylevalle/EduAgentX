#!/usr/bin/env node
'use strict';

// Re-derives every stored source section from its publication (target design
// 3.2 step 1; assurance audit C4), so a section's text is checked against the
// source and not only against its own digest:
//   PDF source    download the pinned file, check its SHA-256 against the pin,
//                 extract its text with pdftotext as the sections were
//                 extracted (ligatures expanded, footnote reference numbers
//                 dropped, whitespace collapsed), and find every section in it
//   HTML source   fetch each section's page and find the section in its text
//   embedded      a sample policy has no publication; it is reported, not checked
// Needs pdftotext (poppler) on PATH. Exit 1 when any section is not found.
//
//   node scripts/verify-source-sections.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { normalise } = require('../services/curriculum-engine/sections');
const { observeSource } = require('../services/validation-activation/src/freshness-job');

const PACKAGES = ['ai-safety-candidate', 'customer-refunds-candidate', 'personal-data-candidate']
  .map((name) => require(`../services/curriculum-engine/examples/${name}`));
const LIGATURES = Object.freeze({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' });
// A footnote reference is one or two digits stuck to the end of a word or sentence.
const FOOTNOTE_REFERENCE = /(?<=[a-z.])\d{1,2}(?=\s|$)/g;
const FETCH_TIMEOUT_MS = 60000;

const asExtracted = (text) => normalise(Object.entries(LIGATURES).reduce((value, [from, to]) => value.replaceAll(from, to), text)
  .replace(FOOTNOTE_REFERENCE, ''));

async function pdfText(url, expectedSha256) {
  const response = await fetch(url, { headers: { 'user-agent': 'EduAgentX-section-check/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== expectedSha256) throw new Error(`pdf digest ${digest} does not match the pin`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eax-sections-'));
  try {
    fs.writeFileSync(path.join(dir, 'source.pdf'), bytes);
    execFileSync('pdftotext', ['-enc', 'UTF-8', path.join(dir, 'source.pdf'), path.join(dir, 'source.txt')], { stdio: ['ignore', 'ignore', 'ignore'] });
    return asExtracted(fs.readFileSync(path.join(dir, 'source.txt'), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  let missing = 0;
  const seen = new Set();
  for (const pkg of PACKAGES) {
    for (const source of pkg.sources) {
      const sections = pkg.sourceSections.filter((section) => section.sourceId === source.id);
      const key = `${source.id}:${sections.map((section) => section.id).join(',')}`;
      if (!sections.length || seen.has(key)) continue;
      seen.add(key);
      if (source.snapshotKind === 'embedded') { process.stdout.write(`embedded ${source.id}: sample policy, no publication to check\n`); continue; }
      if (source.snapshotKind === 'pdf') {
        const text = await pdfText(source.snapshotUrl, source.contentSha256);
        for (const section of sections) {
          const found = text.includes(asExtracted(section.text));
          missing += found ? 0 : 1;
          process.stdout.write(`${found ? 'found  ' : 'MISSING'} ${source.id}/${section.id} (${section.locator})\n`);
        }
      } else {
        const observed = await observeSource(source, sections, fetch);
        for (const section of sections) {
          const found = !observed.missingSectionIds.includes(section.id);
          missing += found ? 0 : 1;
          process.stdout.write(`${found ? 'found  ' : 'MISSING'} ${source.id}/${section.id} (${section.locator})\n`);
        }
      }
    }
  }
  process.stdout.write(missing ? `${missing} section(s) not found in their source\n` : 'every stored section was found in its source\n');
  if (missing) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`verify-source-sections: ${error.message}\n`); process.exitCode = 1; });
