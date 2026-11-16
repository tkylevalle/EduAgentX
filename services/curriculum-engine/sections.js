'use strict';

// A claim is traced to its source when it quotes a stored section of that
// source (assurance audit C4). The comparison ignores whitespace differences
// only; every other character must match the stored text.

const { createHash } = require('node:crypto');

// A quote this short could match by accident; six words carry the claim.
const MIN_QUOTE_WORDS = 6;
const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const wordCount = (text) => normalise(text).split(' ').filter(Boolean).length;

/** @param {{ text: string }} section @param {string} quote @returns {boolean} whether the quote is long enough and appears in the section */
const quoteFound = (section, quote) => wordCount(quote) >= MIN_QUOTE_WORDS && normalise(section?.text).includes(normalise(quote));

/**
 * A source kept as sections rather than as a file is pinned by the digest of
 * its stored sections, in package order. Building and validating a package
 * both use this, so the two can never compute it differently.
 * @param {{ text: string }[]} sections  one source's stored sections @returns {string} hex SHA-256
 */
const sectionsDigest = (sections) => createHash('sha256').update(sections.map((section) => section.text).join('\n')).digest('hex');

module.exports = { MIN_QUOTE_WORDS, normalise, quoteFound, sectionsDigest, wordCount };
