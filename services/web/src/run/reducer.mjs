// The lifecycle run as plain data. Operator Mode and the school both read the
// state this reducer builds from the stream, so they can never disagree.

/** The eight stages the lifecycle driver reports, in order. */
export const STEP_PLAN = Object.freeze([
  ['package', 'Activate Domain Assurance Package', 'curriculum-engine · validation-activation'],
  ['register', 'Register Agent Learner', 'api-gateway · agent-registry'],
  ['train', 'Complete Training Session', 'training-service'],
  ['examine', 'Sit standard Examination', 'examination-engine · grading-service'],
  ['certify', 'Certification Decision and credential', 'certification-service'],
  ['verify', 'Verify Competency Credential', 'credential-verification'],
  ['status', 'Suspend, re-verify and reinstate', 'credential-verification'],
  ['monitor', 'Monitoring and marketplace projection', 'monitoring-service · marketplace-service'],
].map(([id, title, owner]) => Object.freeze({ id, title, owner })));

/** @param {number} [id] @returns a run that has not started */
export const blankRun = (id = 0) => ({
  id, scenario: null, running: false, outcome: null, remediation: null, events: [],
  steps: STEP_PLAN.map((entry) => ({ ...entry, status: 'pending' })),
});

/**
 * @param {ReturnType<typeof blankRun>} run
 * @param {{ type: string, at?: number, [key: string]: unknown }} event a stream message, or the local `start`
 */
export function reduce(run, event) {
  switch (event.type) {
    case 'start':
      return { ...blankRun(event.runId), scenario: event.scenario, running: true, events: [event] };
    case 'step':
      return { ...run, events: [...run.events, event],
        steps: run.steps.map((entry) => (entry.id === event.step.id ? { ...entry, ...event.step } : entry)) };
    case 'remediation':
      return { ...run, remediation: event.remediation, events: [...run.events, event] };
    case 'done':
      return { ...run, running: false, outcome: event.report, events: [...run.events, event] };
    default:
      return run;
  }
}

/** @param {Array<object>} events @returns the run those events describe */
export const replay = (events) => events.reduce(reduce, blankRun());

export const stepOf = (run, id) => run.steps.find((entry) => entry.id === id);

const DONE_COPY = {
  stream_ended: 'stream ended before the run reported a result',
  run_in_progress: 'another run is in progress; wait for it to finish',
};

/** The Run console's lines, derived from the same events. */
export function consoleLines(events) {
  const lines = [];
  const write = (event, text, tone = '') => lines.push({ at: event.at, text, tone });
  for (const event of events) {
    if (event.type === 'start') write(event, `run requested · scenario ${event.scenario}`);
    if (event.type === 'step') {
      const { step } = event;
      if (step.status === 'running') write(event, `→ ${step.title}`);
      else if (step.status === 'passed') write(event, `✓ ${step.title} · ${step.durationMs} ms`, 'ok');
      else write(event, `✗ ${step.title} · ${step.error}`, 'bad');
      const used = step.detail?.live;
      if (step.status !== 'running' && used) {
        write(event, `  LIVE · ${used.model} · ${used.calls} model calls · ${used.promptTokens + used.completionTokens} tokens`);
      }
    }
    if (event.type === 'done') {
      const { report } = event;
      if (report.status === 'passed') write(event, 'lifecycle complete · credential issued and verified', 'ok');
      else write(event, DONE_COPY[report.error] || (report.local ? `run failed · ${report.error}` : `lifecycle stopped · ${report.error}`), 'bad');
    }
  }
  return lines;
}
