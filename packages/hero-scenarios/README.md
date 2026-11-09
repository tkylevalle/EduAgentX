# hero-scenarios (issue 34)

Declares the nine capstone demonstrations, the fault declarations for the six hero risk scenarios, and the evidence record format. It does not start any service.

- `src/scenarios.js` is the catalog. Edit it to change a scenario or a bound.
- `src/validate.js` checks the catalog against the issue 34 acceptance criteria.
- `src/evidence.js` builds and verifies evidence records.
- `npm test` runs the checks. `npm run check` prints the catalog. `npm run docs` rewrites `docs/sprint-5/hero-scenarios.md`.

## Wiring a runner

A runner that drives the live stack does this for each scenario:

1. Run the steps with the declared isolated learner and test keys.
2. Call `createEvidenceRecord({ scenario, runId, executorMode, startedAt, finishedAt, artifacts, checks, incident, outcome })`. Store ids and digests in `artifacts`, never raw answers, credentials or keys.
3. Write each record under `evidence/sprint-5/hero/<scenario id>/`.
4. Call `verifyEvidenceSet(scenario, records)` and fail the run if it returns errors.

The record's `evidenceMode` is always the mode of the executor that produced the run, so a replay run cannot be labelled live.
