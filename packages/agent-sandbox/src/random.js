'use strict';

// Deterministic randomness from a seed: SHA-256 of seed and counter. The same
// seed always builds the same world, so every episode can be replayed.

const { createHash } = require('node:crypto');

const UINT32_RANGE = 2 ** 32;

/** @param {string} seed @returns {() => number} a generator of values in [0, 1) */
function seededRandom(seed) {
  let counter = 0;
  return () => {
    const digest = createHash('sha256').update(`${seed}:${counter}`).digest();
    counter += 1;
    return digest.readUInt32BE(0) / UINT32_RANGE;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, low, high) => low + Math.floor(random() * (high - low + 1));
const hex = (random, length) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join('');

module.exports = { between, hex, pick, seededRandom };
