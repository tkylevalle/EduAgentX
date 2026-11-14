'use strict';

const DEFAULT_CONCURRENCY = 16;
const MAX_CONCURRENCY = 32;

function concurrency(value = DEFAULT_CONCURRENCY) {
  const number = typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < 1 || number > MAX_CONCURRENCY)
    throw new Error('invalid MARKETPLACE_AUTHORITY_CONCURRENCY (expected integer 1..32)');
  return number;
}

// One queue per app, shared by eligibility and matching requests, including
// overlapping retries. Waiting is outside the owning sources' timeout windows:
// work() creates those timers only after a candidate receives a worker slot.
// Results retain input order; completion order never determines ranking.
function createAuthorityDispatch(limit = DEFAULT_CONCURRENCY) {
  const width = concurrency(limit);
  const queue = [];
  let active = 0;
  const drain = () => {
    while (active < width && queue.length) {
      const { work, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; drain(); });
    }
  };
  return (records, work) => Promise.all(records.map((record, index) => new Promise((resolve, reject) => {
    queue.push({ work: () => work(record, index), resolve, reject });
    drain();
  })));
}

module.exports = { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, concurrency, createAuthorityDispatch };
