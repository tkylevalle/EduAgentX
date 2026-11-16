'use strict';

// A claim is traced to its source when it quotes a stored section of that
// source (assurance audit C4). The comparison ignores whitespace differences
// only; every other character must match the stored text.

// A quote this short could match by accident; six words carry the claim.
const MIN_QUOTE_WORDS = 6;
const normalise = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const wordCount = (text) => normalise(text).split(' ').filter(Boolean).length;

/** @param {{ text: string }} section @param {string} quote @returns {boolean} whether the quote is long enough and appears in the section */
const quoteFound = (section, quote) => wordCount(quote) >= MIN_QUOTE_WORDS && normalise(section?.text).includes(normalise(quote));

module.exports = { MIN_QUOTE_WORDS, normalise, quoteFound, wordCount };
