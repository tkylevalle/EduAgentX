# Issue 33 Phase 2: fault evidence and execution readiness

Owner: Salman Akram. Feature base `02e7dd7cc2ac9726d0c8f79d63d133d0cb929926`;
main base `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0`.
This phase does not execute the formal 1,000 scenarios or 100 golden cases.
The frozen formal and Marketplace dataset versions/hashes remain unchanged.

## Acceptance checklist (not acceptance verdicts)

Authority: GitHub [Issue 33](https://github.com/tkylevalle/EduAgentX/issues/33).

| Requirement | Current classification | Evidence still needed |
|---|---|---|
| 1,000 scenarios, five approved profiles, public seam | IMPLEMENTED BUT NOT FORMALLY EXECUTED | Actual complete 1,000 execution; pilot is supporting evidence only |
| At least 90% exact complete outcomes, 95% Target separately | IMPLEMENTED BUT NOT FORMALLY EXECUTED; upstream BLOCKED | Real complete outcomes and Marketplace integration; 400 current candidate narratives cannot complete matching |
| Independent Registration, Curriculum Delivery, Examination and Certification invariants | IMPLEMENTED BUT NOT FORMALLY EXECUTED | Full population observations, not an aggregate substitute |
| Zero duplicate examinations, credentials, matches; zero mandatory-safety false passes | IMPLEMENTED BUT NOT FORMALLY EXECUTED | Full population reconciliation and item-level safety/credential checks |
| 100 golden cases, 1,000 agents, 100 requests, explanations/latency | BLOCKED BY EXTERNAL/UPSTREAM INTEGRATION and NOT YET IMPLEMENTED in harness | Real trusted cohort/action driver, per-case oracle bindings, load, execution |

DONE AND VERIFIED applies to dataset counts, deterministic helpers, supporting
accounting/security tests and the measured Phase 1 pilot only. A new Phase 2
report proves only its explicitly listed checks; it cannot promote this table
to formal acceptance. No formal verdict can be supplied before execution.

## New focused execution

```sh
node scripts/verify-issue-33.js
node scripts/run-unit-tests.js
python3 -m unittest discover -s scripts -p 'test_sprint1_*.py'
python3 -m unittest discover -s scripts -p 'test_sprint5_*.py'
python3 scripts/verify-issue-33-postgres.py
python3 scripts/run-sprint5.py --mode phase2
node scripts/preflight-issue-33.js --pilot-report artifacts/issue-33/eduagentx-issue33-20261102t093015z-35875/developer/report.json
git diff --check
```

The Phase 2 runner creates three fresh isolated projects and stops after them:

1. `default-duration`: a competent real lifecycle with an exact 3,600-second
   immutable admission duration. This proves normal configured timing plus a
   positive path, not a real hour-long incomplete-learner timeout.
2. `stress`: competent and remediable narratives with eight concurrent admission
   replays and response retries; changed semantic key reuse, answer replacement
   and stale sequences must conflict. Reconciliation counts one attempt per key,
   one credential per passing examination and one result per match command. A
   separate remediation examination is expected, never counted as a duplicate.
   Marketplace remains blocked for trust, while stored-command replay and safe
   counts are still measurable. Stress bursts allow eight overlapping HTTP calls,
   spaced by 1,200 ms between bursts; the shared budget remains below 600/minute.
3. `faults`: stop only the private project's grader. Accept all 15 responses on
   time, observe the complete attempt staying in progress through the **real
   default 15-minute grading retry period**, then verify `system_aborted` /
   `grading_unavailable`, null assessment and no credential. Partial (3 responses)
   and unavailable (0) learners instead reach `agent_failed` /
   `response_deadline_elapsed`. Admit another complete timely submission near the
   end of that outage, let its deadline pass, restore the actual grader and prove
   trusted passing grading/issuance afterward. The aborted attempt stays aborted.

Only the response duration for `stress` and `faults` defaults to the existing
one-minute isolated evaluation setting. Reports explicitly label accelerated
response timing. There is no clock manipulation, shortened grading retry window,
changed business rule or injected grader result. The 60-minute production/default
configuration is untouched. A genuine grading service outage is the infrastructure
abort exercised here; arbitrary other database/network outage types are not proved.

All lifecycle requests use the real authenticated Gateway. Service stop/start
uses an opt-in control restricted to `grading-service` in this invocation's
private `*-faults` Compose project; named/external volumes and fixed container
names are refused. A finally block restores the grader and the outer runner
removes only its own volumes. Source fingerprints are checked across builds,
between stages and at each Node run's end. Source changes invalidate evidence.
No source edits should occur while recording composed evidence.
Use `--phase2-case faults` (or `stress` / `default-duration`) to rerun only an
affected case. This selector is refused outside Phase 2. Outage reports retain
submission/acknowledgement bounds and compare the authoritative `abortedAt`,
so an early abort cannot pass merely because it was first polled later.

### Certification concurrency evidence boundary

Certification currently issues via its authenticated service poller.
`services/certification-service/index.js` accepts commands only from the trusted
examination-engine role; the Gateway is read-only. Phase 2 therefore stresses
concurrent public lookup/reconciliation of a poller-issued credential. It does
**not** claim those reads are concurrent issuance commands. The disposable
`services/certification-service/integration/postgres.test.js` explicitly races
`store.issue` in a real database and proves convergence/restart/uniqueness; this
is labelled supporting store evidence, not a black-box lifecycle command.
Adding a new public issuance mutation solely for testing would broaden trust.

## Marketplace integration boundary and ownership

**Recommendation: OPTION B — coordinate with the Certification/Marketplace owners.**
No integration repair is made in Phase 2.

### A. Lifecycle origin

- `services/marketplace-service/clients.js:createLifecycleSource()` always throws
  `SourceError('certification-service', 'source_not_available')`.
- `services/marketplace-service/index.js` wires that source into real checks.
- `services/certification-service/index.js` now has private decision lookup and
  credential listing routes, but no agreed Marketplace credential-origin check.
- `services/certification-service/store.js` and `schema.sql` own immutable decisions,
  credentials and the examination link; Marketplace must not read their tables.
- `docs/contracts/marketplace.md` still says the lifecycle-origin route is absent.
  `docs/sprint-5/handoff-issue-30.md` assigns issuer/origin integration to Timurmalik;
  #31 and #32 handoffs explicitly retain this as an upstream dependency.

Minimal proposed repair: an authenticated read-only issuer endpoint takes an
exact credential ID and confirms its immutable issued decision/examination link,
subject and fingerprint, with an agreed identity/digest binding to the projected
credential. Marketplace calls it through a bounded HTTP client. Unknown,
mismatched, failed, unavailable or malformed authority remains excluded. Never
accept mere existence of a signed blob or client-supplied origin claims.
Required tests: positive real issued decision; unknown/mismatched credential,
subject/fingerprint/payload; failed/aborted examination refusal; unauthorized
caller; restart; bounded timeout; real composed issuer-to-market eligibility;
continued fail-closed exclusions during an issuer outage. Contract and caller
permission changes need owner agreement.

### B. Signed environment/evidence mode

- `services/marketplace-service/clients.js:toCandidate()` reads only explicit
  signed top-level `vc.environment` and `vc.evidenceMode`.
- `services/certification-service/evidence.js:validatedEvidence/issueCredential`
  do not propagate or sign those labels today.
- `services/examination-engine/generation.js` already pins Training completion
  evidence under `form.training.evidence`; its certification projection in
  `index.js` currently drops it. This is a possible authoritative provenance
  source, not permission to default all credentials to simulation.
- `docs/contracts/external-agent-learner-protocol.md` defines synthetic/replay/live
  evidence labels; `docs/contracts/marketplace-matching.md` requires explicit
  trusted labels. These contracts do not yet define a complete issuer provenance
  mapping for every standard/fallback/legacy case.

Minimal proposed repair: agree and validate trusted Training/admission provenance,
expose that purpose-limited immutable evidence to Certification, validate allowed
mode/environment combinations, persist it with the decision, and include it
**before signing** new credentials. Missing legacy provenance stays uncheckable;
never edit old signed credentials or infer labels from provider/model names.
Tests: synthetic/replay/live combinations; missing/conflicting/spoofed provenance;
standard/fallback handling; pinned evidence after governance changes; signed-value
verification/tamper rejection; actual event projection, eligibility and near match.

This spans authority, issuer semantics and signed credential contracts, rather
than a missing test import. It should be coordinated rather than silently absorbed
into #33. OPTION A is defensible only after those owners approve an exact contract
and a minimal patch. No test threshold or trust policy is weakened either way.

### Historical blockers that are now fixed

The old #30 handoff predates PoC integration. Current Certification publishes a
transactional outbox to `certification.credentials`, registers credential status,
and supports listing. Current verifier accepts the issued credential shape and
protects status mutations. `services/certification-service/publisher.js`,
`services/credential-verification/src/index.js` and `src/verifier.js` take precedence
over older statements claiming those integrations do not exist. Those improvements
do not implement the origin adapter or add the signed labels.

## Golden readiness: two independent axes

All six declared families exist (20 eligibility, 20 gaps, 20 trust, 15 ranking,
15 history, 10 lane/representative cases). Generic assertions compare independently
supplied membership, scores, component points, reason codes, ordering and replay.
However, `fixtureFacts` are declarations (e.g. 90/80 and 10 days), not proof that
an attainable real lifecycle cohort has those exact values. Several cases require
aged/tied or multiple-credential cohorts; repeated family templates are not proof
of 100 distinct fully executable oracles.

With the current real authority configuration the primary execution statuses are:
**READY 0, BLOCKED 100, NOT_IMPLEMENTED 0**. Independently, **100/100 still have
missing harness work**: the real cohort/action driver and per-case oracle binding.
These counts overlap deliberately. Removing origin/label blockers alone yields
READY 0 / NOT_IMPLEMENTED 100; it does not magically finish the golden harness.
No injected-authority unit result increases READY. Within trust/history families
some denial/replay mechanics can be observed, but attribution to one intended
trust gate, honest Near Matches/ranking and preserved prior eligible outcomes
remain unproved. The full formal golden execution is NOT_RUN.

## Formal dry/preflight and reproducibility

`readiness.js` and `scripts/preflight-issue-33.js` perform no lifecycle writes.
They check 1,000 entries, 200/category, 50 per fifth-category variant, explicit
identity capacity, unique command keys, dataset hashes and the real request budget.
The runner retains private projects/volumes/keys, safe allowlisted artifacts and
source/config/image identities. There is intentionally **no in-place resume**:
an interrupted run is retained as partial; rerun with the same deterministic
logical IDs in fresh private volumes and record new UUID/timestamp mappings.
Never mix partial runs into one acceptance denominator or resume after changing
source, configuration or dataset. Cross-machine reproducibility remains future
measurement.

Use the actual Phase 1 developer `startedAt`/`finishedAt` for a measured 25-case
extrapolation; preflight outputs both a simple 40x estimate and a more conservative
range adding the real 60-minute timeout tail, grading retry and contention margin.
It excludes extra golden candidate construction and high-fanout matching. The
formal 1,000 narratives yield only 400 passing/credentialed learners (200 initial
competent plus 200 remediated), so the golden 1,000-candidate cohort needs at least
600 additional real passing learners. Exactly 400 current full narratives would
be Marketplace BLOCKED; even 600 other exact outcomes give only 60%, below 90%.

Preparation uses four workers, at most eight, and parked deadline observers.
Every poll shares the 400/minute budget. Large numbers of parked observers can
increase poll latency and total run time; no 1,000-load performance is claimed.
Plan at least 8 GiB available RAM and 10 GiB free disk for the existing stack,
private images/volumes and evidence; these are conservative preflight budgets,
not measured maximum requirements. Existing Compose limits remain intact.
Check local resources before execution; image/database/evidence growth at the
full cohort remains unmeasured. Generated artifacts are ignored and answer-free.

## Remaining completion work

Coordinate the two upstream trust contracts, implement the real golden cohort and
case-specific action/oracle bindings, rehearse safe full-cohort matching/load,
verify full-duration incomplete learners if required for acceptance, review Phase 2
evidence, then obtain approval for formal 1,000 + golden execution. Independently
require all invariants, zero prohibited duplicates and zero mandatory-safety false
passes. Keep Skill Gap Superseded/Deprecated mismatch and the separate grading KPI
Red visible. No PR, commit, push or automatic issue closure occurs in this phase.
