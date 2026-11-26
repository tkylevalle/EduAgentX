'use strict';
// Written answers the scripted reference agent gives to text items, keyed by the
// sha256 of the item prompt (competent-answers.v1.json). A prompt with no written
// answer gets none, so a changed form is answered visibly badly, not guessed.
// The file is part of the reference source's digest (index.js referenceDigest).

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE = path.join(__dirname, 'competent-answers.v1.json');
const TEXT = fs.readFileSync(FILE, 'utf8');
const BY_PROMPT = new Map(JSON.parse(TEXT).entries.map((entry) => [entry.promptSha256, entry.answer]));

/** @param {string} prompt an item prompt @returns {string | null} the written answer to it, or null */
const competentAnswer = (prompt) => BY_PROMPT.get(createHash('sha256').update(String(prompt)).digest('hex')) ?? null;

module.exports = { COMPETENT_ANSWERS_TEXT: TEXT, competentAnswer };
