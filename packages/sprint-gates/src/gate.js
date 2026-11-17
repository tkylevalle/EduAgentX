'use strict';

// A sprint gate whose checks can fail. A check passes only when its body
// finishes without throwing; node:assert throws on a wrong result. A check
// that is not run (or depends on one that did not pass) is recorded with its
// reason, and the gate is then INCOMPLETE, never PASS.

const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_RUN: 'NOT_RUN', INCOMPLETE: 'INCOMPLETE' });
const EXIT = Object.freeze({ [STATUS.PASS]: 0, [STATUS.FAIL]: 1, [STATUS.INCOMPLETE]: 2 });

/**
 * @param {string} name
 * @returns {{ check: (id: string, title: string, body: () => Promise<unknown>, options?: { needs?: string[] }) => Promise<unknown>,
 *   notRun: (id: string, title: string, reason: string) => void,
 *   result: () => { gate: string, status: string, exitCode: number, checks: object[] } }}
 */
function createGate(name) {
  const checks = [];
  const statusOf = (id) => checks.find((check) => check.id === id)?.status;

  async function check(id, title, body, { needs = [] } = {}) {
    const blocked = needs.filter((dependency) => statusOf(dependency) !== STATUS.PASS);
    if (blocked.length) {
      checks.push({ id, title, status: STATUS.NOT_RUN, reason: `needs ${blocked.join(', ')} to pass first` });
      return null;
    }
    const startedAt = Date.now();
    try {
      const observed = await body();
      checks.push({ id, title, status: STATUS.PASS, durationMs: Date.now() - startedAt, observed: observed ?? null });
      return observed;
    } catch (error) {
      checks.push({ id, title, status: STATUS.FAIL, durationMs: Date.now() - startedAt,
        error: error?.message || String(error), code: error?.code || null, detail: error?.detail || null });
      return null;
    }
  }

  function notRun(id, title, reason) {
    checks.push({ id, title, status: STATUS.NOT_RUN, reason });
  }

  function result() {
    const statuses = checks.map((check) => check.status);
    const status = statuses.includes(STATUS.FAIL) ? STATUS.FAIL
      : statuses.length === 0 || statuses.includes(STATUS.NOT_RUN) ? STATUS.INCOMPLETE : STATUS.PASS;
    return { gate: name, status, exitCode: EXIT[status], checks: checks.map((check) => ({ ...check })) };
  }

  return { check, notRun, result };
}

module.exports = { EXIT, STATUS, createGate };
