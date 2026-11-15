'use strict';

// A sprint gate whose checks can fail. A check passes only when its body
// finishes without throwing; node:assert throws on a wrong result. A check
// that is not run (or depends on one that failed) is recorded with its
// reason, and the gate is then INCOMPLETE, never PASS.
// Exit codes: 0 PASS, 1 FAIL, 2 INCOMPLETE.

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCOMPLETE: 2 });

function createGate(name) {
  const checks = [];
  const statusOf = (id) => checks.find((check) => check.id === id)?.status;

  async function check(id, title, body, { needs = [] } = {}) {
    const blocked = needs.filter((dependency) => statusOf(dependency) !== 'PASS');
    if (blocked.length) {
      checks.push({ id, title, status: 'NOT_RUN', reason: `needs ${blocked.join(', ')} to pass first` });
      return null;
    }
    const startedAt = Date.now();
    try {
      const observed = await body();
      checks.push({ id, title, status: 'PASS', durationMs: Date.now() - startedAt, observed: observed ?? null });
      return observed;
    } catch (error) {
      checks.push({ id, title, status: 'FAIL', durationMs: Date.now() - startedAt,
        error: error?.message || String(error), code: error?.code || null });
      return null;
    }
  }

  function notRun(id, title, reason) {
    checks.push({ id, title, status: 'NOT_RUN', reason });
  }

  function result() {
    const statuses = checks.map((value) => value.status);
    const status = statuses.includes('FAIL') ? 'FAIL'
      : statuses.length === 0 || statuses.includes('NOT_RUN') ? 'INCOMPLETE' : 'PASS';
    return { gate: name, status, exitCode: EXIT[status], checks: checks.map((value) => ({ ...value })) };
  }

  return { check, notRun, result };
}

module.exports = { EXIT, createGate };
