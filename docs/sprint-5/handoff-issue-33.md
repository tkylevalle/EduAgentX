# Issue 33 Phase 1: deterministic public lifecycle evaluation

**Current status, 11 November 2026: ISSUE #33 ACCEPTANCE PASS — READY FOR PR.**
Formal Run 2 combined acceptance is the final authoritative technical result;
see the final section and `issue-33-final-test-report-deltas.md`. Earlier Phase 1,
Phase 2 and readiness statements below describe their historical snapshots and
are superseded for current status, without changing any retained run verdict.

Primary: Salman Akram. Base: `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0`.
Branch: `salman/issue-33-e2e-suite`. Phase 1 was committed and pushed as
`02e7dd7cc2ac9726d0c8f79d63d133d0cb929926`. At this original handoff, Phase 2
changes were uncommitted; see [the Phase 2 handoff](handoff-issue-33-phase2.md).

## Scope and evidence boundary

Phase 1 builds the dataset, public client/orchestration, assertions, isolated
runner and evidence pipeline. It does **not** claim 1,000 scenarios passed or
Marketplace acceptance. Only actual run reports are measurement evidence.
Unit, scripted-client, HTTP contract and PostgreSQL tests are labelled supporting
checks; their injected authorities never count as formal lifecycle evidence.

The deployed path is real Docker Compose services → real Gateway token issuance
and authenticated public `/v1` workflows → authoritative public/admin reads.
The harness never sets grades, finalizes attempts, signs credentials, inserts
Registry/Marketplace records or manually publishes Redis lifecycle events.
Package setup submits the existing reference candidate through public intake,
six validation gates, two distinct configured simulation reviewers and activation.
Those reviewer accounts are not independent human approval evidence.

## Frozen formal dataset

`packages/e2e-suite/manifest.js` defines `issue-33-scenarios/1.0.0`, seed
`eduagentx-sprint5-issue33-v1`. It contains exactly 1,000 stable logical scenarios:

| Approved category | Count | Variants |
|---|---:|---|
| Competent and safety-aware | 200 | Safe escalation baseline |
| Knowledgeable but adversarially vulnerable | 200 | 50 each hostile instruction, authorization boundary, secret protection, unsafe tool |
| Partially competent and remediable | 200 | Failing applied responses, targeted practice, a separate safe re-examination |
| Consistently underqualified | 200 | Low-effort responses; no credential |
| Malformed, inconsistent, timing-out or unavailable | 200 | Exactly 50 per variant |

Authority: `docs/blueprint/issues/03-decide-demo-agent-boundary.md`.
The eight legacy synthetic profile names are not eight formal categories.
Expected stage narratives and critical-rule identifiers are declared independently
of the production grader/matcher. Tests pin both dataset hashes to prevent
silent same-version recalibration.

Malformed learner output is submitted to the real Examination response contract.
Inconsistent behavior attempts a conflicting replacement and stale sequence,
then reaches the authoritative malformed-response failure. Timing-out submits
three responses; unavailable submits none **after valid admission**. Both await
the owner deadline and expect `agent_failed/response_deadline_elapsed`. The
legacy adapter's self-reported unavailability is not an Examination System-Aborted
outcome. Real infrastructure aborts remain a separate fault-test scope.

## Architecture and identities

`identity.js` namespaces learner/client IDs, commands, correlations, idempotency
keys, request IDs and Marketplace request identities by version, seed, scenario
and operation. The same logical command is never repurposed for another step.
Server UUIDs/timestamps are recorded as mappings, not required to repeat.

`client.js` wraps the existing `GatewayProtocolClient` and shared external-agent
protocol. All identities share a 150 ms request pacer, including token calls.
Transport retries use the same body/key, with at most three harness attempts.
429 observes bounded `Retry-After`; permanent validation/authorization errors
are not retried. No internal route is an accepted client seam.

`lifecycle.js` registers/replays, completes ordered Training, admits/replays an
immutable attempt, probes answer finality/replay/sequence rejection, observes
the owner terminal state and verifies Certification presence/absence. Failing
scenarios inspect real remediation evidence. Skill Gap reads the original
examination trace and observes its existing Training assignment; the remediable
category completes that session and starts a genuinely new examination.
Original outcomes are compared before/after remediation.

Preparation workers and deadline observers are separate. A learner waiting for
its deadline holds no preparation worker. Fully answered attempts are observed
through the grading retry window after the last accepted response, including
grading after `deadlineAt`; the harness never declares a learner failure itself.
Public certification absence is a bounded observation and is reported as such;
the backing unique constraints are additional, separately labelled evidence.

Marketplace entry probes run serially after lifecycle observation. A learner
publishes, requests a real match, checks durable replay/reconciliation and
withdraws its test listing. These probes are labelled `pilot-lifecycle-entry`,
not counted as completed formal golden cases. Current trust exclusions remain
BLOCKED. No cached-success or inferred-label fallback exists.

## Minimal testability changes

### Explicit evaluation clients

Gateway `evaluation-clients.js` extends `knownClients()` only when
`EVALUATION_CLIENTS_ENABLED=true` and `EVALUATION_CLIENTS_PATH` names a valid file.
The normal Compose file is unchanged; the isolated runner alone mounts that
file read-only. At most 2,000 explicit clients and 512 KiB are allowed.
Entries contain only `clientId` and a strong generated secret. IDs use the
bounded `e2e33-` namespace; duplicate/conflicting IDs, wildcard IDs, weak secrets
and caller-supplied roles are refused. Roles are always `agent`.
Only regular files are accepted. The descriptor read is capped at 512 KiB plus
one overflow byte, including file growth after metadata validation.

The real RS256 token issuer, audience/issuer checks, route roles and ownership
checks are unchanged. Invalid enabled configuration fails closed. Outside the
explicit opt-in, the existing configured-client behavior is unchanged.
All 1,000 IDs can be provisioned from the manifest; passwords are random and
written only to the runner's private temporary file, never source/evidence.
This is provisioning capacity, not evidence that 1,000 learners executed.

### Answer-free reconciliation

New Gateway routes require **admin**, not the broader assurance-reader roles:

| Route | Required exact query | Safe result |
|---|---|---|
| `/v1/admin/reconciliation/examinations` | `agentLearnerKey`, `idempotencyKey` | Count and attempt IDs |
| `/v1/admin/reconciliation/credentials` | `examinationId` | Count and credential IDs |
| `/v1/admin/reconciliation/matches` | `actor`, `idempotencyKey` | Count, result IDs, learner/lane appearances |

Each owner uses parameterized, exact-filter SQL and its existing service key.
Examination/Marketplace also require derived admin role; Certification requires
Gateway read role plus derived reconciliation-admin permission. No prompts,
answers, rationale, JWS, credential payloads or mutation routes are added.
HTTP authorization/privacy tests and disposable PostgreSQL assertions cover
these reads. They do not supply the missing Marketplace origin authority.

## Independent accounting

Scenario statuses: `CONFORMANT`, `MISMATCH`, `BLOCKED`, `UNMEASURED`, `HARNESS_ERROR`.
`lifecycleStatus` separately records a conforming lifecycle when downstream
Marketplace integration is blocked. A correct learner failure can be conformant.
Setup/source errors cannot masquerade as infrastructure success.

Invariant groups are Registration, Curriculum/Training, Examination,
Certification, Marketplace, Remediation/Skill Gap and Cross-cutting Safety.
Missing observations remain unmeasured; conflicting duplicate observations fail.
Mandatory safety checks independently verify the named critical rule, no unsafe
pass and no credential. An unrelated low total score cannot hide a missed rule.

Prohibited duplicates mean multiple attempt IDs per admission key, credentials
per examination, result IDs per actor/key, or repeated learner appearance in a
result. A new remediation examination or deliberately fresh match is separate.

Formal exact rate uses the frozen denominator 1,000. At least 900 exact outcomes
meet the Acceptance Floor; 950 meet the separately reported Target. An invariant
or prohibited duplicate overrides the percentage. Missing required evidence
blocks technical acceptance. Developer rates never become formal percentages.
Passed invariant flags cannot replace missing duplicate inventories, item-level
safety/credential observations or source/build provenance. Contradictory
conformance labels and altered frozen definitions are rejected. Formal technical
acceptance also requires the unchanged 60-minute response configuration.
An infrastructure-aborted unsafe profile has no trusted safety assessment: its
safety checks remain unmeasured, while credential absence is checked separately.
An actually observed guard violation still fails even outside a happy-path list.
Human approval, second-machine reproduction and cumulative release readiness
remain separate from technical checks.

## Marketplace golden framework

`marketplace.js` declares 100 cases: 20 eligibility/boundaries, 20 request gaps,
20 trust exclusions, 15 ranking/explanations, 15 replay/version/history and 10
lane/representative-credential cases. Requests, named real-lifecycle fixtures,
independent expected membership/reason codes and a literal arithmetic anchor
are retained. Assertions accept independent expected ordering/scores and compare
output; they never call production `matchCandidates` or `checkEligibility`.

The full real-cohort setup/action driver and 1,000-candidate/100-request execution
are **not completed acceptance in Phase 1**. Real aged/tied/status-varied cohorts,
targetable objective coverage, unsupported-domain probes, complete explanation
arithmetic, and full load/reproduction still need Phase 2 execution/work.
Do not promote a generic envelope assertion or replay into full golden coverage.
The future cohort must come from real lifecycle issuance; failed formal profiles
do not count as credentialed candidate setup. No direct candidate insertion is
allowed. Marketplace p95 floor is 30 s, with the 10 s Target separate.

## Developer mode and reproduction

Node 24, Python 3.9+ and Docker Compose v2 are required.

```sh
node scripts/install-dependencies.js
node scripts/generate-test-keys.js
node scripts/verify-issue-33.js
node scripts/run-unit-tests.js
python3 -m unittest discover -s scripts -p 'test_sprint1_*.py'
python3 -m unittest discover -s scripts -p 'test_sprint5_*.py'
python3 scripts/verify-issue-33-postgres.py
python3 scripts/run-sprint5.py --mode developer
git diff --check
```

The developer runner first runs one competent canary, then one case per category,
then the 25-case pilot (five unchanged formal entries per category). Each stage
has fresh private volumes, database and network. Downstream BLOCKED Marketplace
measurements permit progressing only when every measured lifecycle invariant
holds and all core narratives conform. A failed core canary stops progression.

Developer mode defaults to the **existing configurable one-minute Examination
deadline**, recorded in each report. This makes the two learner timeout cases
practical without changing their definitions or simulating the server clock.
Use `--developer-deadline-minutes 60` to rehearse the default-duration timing.
Formal mode retains 60 minutes. Developer output is always labelled
**NOT FORMAL ISSUE #33 ACCEPTANCE** and does not prove default-duration acceptance.

For a narrow audit regression, `--stop-after canary` stops developer execution
after the unchanged competent scenario; `--stop-after categories` stops after
the five-category stage. These options are refused in formal mode. The full
25-case pilot remains the default developer workflow.

The formal manifest is available but do not launch its execution until the pilot
has been reviewed. The CLI requires a separate `--formal-approved` opt-in. Phase
1 still reports the unfinished full golden/load/fault measurements NOT_RUN.

The PostgreSQL verifier creates one new disposable container, five separate
databases and temporary random credentials. Its fixtures test storage contracts,
not lifecycle provenance. It removes only that named container/test data.
Alternatively the focused JS verifier runs the five integration suites when
their `*_TEST_DATABASE_URL` variables refer to fresh disposable databases.
Absent variables are recorded NOT_RUN; skips never count as passing.

The existing cumulative technical command remains
`python3 scripts/run-sprint1.py --technical-only`. Its output is a separate
Sprint 1 measurement, not proof of this suite's complete lifecycle coverage.

## Isolation, privacy and artifacts

`run-sprint5.py` resolves `.env.example` with fresh private secrets, ignores local
`.env`/client overrides, strips fixed container/network/volume names and publishes
only its own loopback Gateway port. Private signing keys and evaluation roster
live in a temporary directory mounted read-only. Existing developer volumes and
old branches are never touched. Cleanup targets only this invocation's projects.

Runtime files stay under ignored `artifacts/issue-33/<run-id>/`: JSON/HTML report,
scenario and Marketplace JSONL, latency/failure summaries and content-digest
manifest. Source SHA, dirty state, source/dataset/configuration/image fingerprints,
seed, timing, counts, invariants, blockers and reproduction command are retained.
The writer builds allowlisted evidence; arbitrary response bodies and signed
credential values are never dumped. HTML escapes exported text. Supporting test
logs retain summary counts rather than assertion bodies. Diagnostic attempts
remain separate and are never silently replaced by a later green run.

## Current blockers and unproven work

1. Marketplace lifecycle-origin adapter still fails closed.
2. Trusted environment/evidence labels still do not reach signed credentials.
3. Explicit multi-agent provisioning is implemented; 1,000 actual lifecycle
   executions are not yet proven.
4. Exact-command public reconciliation is implemented; full-run duplicate absence
   must still be measured, and empty Marketplace lanes prove no positive ranking.
5. Unbounded production matching fan-out has not been load-tested here.
6. Skill Gap's `Deprecated` versus governance's `Superseded` policy is unchanged.
7. The separate retained grading quality KPI remains Red.

Full 1,000-scenario acceptance, 100-case/1,000-candidate/100-request Marketplace
acceptance, real grading-outage/System-Aborted and post-deadline grading fault
runs, second-machine reproduction, and independent human release review are not
implied by Phase 1. Consult the actual reports for executed counts and failures.
No threshold, trust gate or original assurance outcome has been weakened.

## Targeted Marketplace remediation after Formal Run 1 (10 November 2026)

This section supersedes the Phase 1 blocker list above. #84 supplies actual
lifecycle origin and signed synthetic/simulation provenance; those checks must
remain mandatory. Formal Run 1 is permanently **BLOCKED**: 1000/1000 lifecycle
narratives conformed, but only 600 complete outcomes conformed. Its 180 missing
match replies and 220 retained origin-uncheckable results are disjoint. See
`issue-33-final-test-report-deltas.md` for the immutable run references.

Marketplace now uses a single application-wide FIFO candidate queue shared by
eligibility and matching requests, including overlapping retries. Server-only
`MARKETPLACE_AUTHORITY_CONCURRENCY` defaults to **16**, accepts integers 1..32,
and leaves readiness closed on invalid configuration. Each candidate starts its
four source branches only after dispatch; queue waiting does not spend the
unchanged **2000ms** source deadline. Verification still performs both signature/
schema and current-status reads: **5N HTTP reads per fresh N-candidate request**.
There is no cross-request cache, new batch API, package coalescing, SQL rewrite,
trust-policy change or ranking change. Results retain deterministic input order.

A separate disposable diagnostic built 400 real public lifecycle learners and
performed three fresh requests at each size 10/50/100/250/400. All 15 committed
results matched the independent oracle; all 12150 authority HTTP reads succeeded.
At 400, all three callers received Gateway 504 although correct results committed
and were observed roughly 9.0–11.3s after authority dispatch began. Source deadlines
and container resources were unchanged. These are diagnostic samples, not a formal
latency verdict. Evidence: `artifacts/issue-33/eduagentx-issue33-20261110t150424z-38953/`.

Only **POST eligibility-checks / matches** now receive the Gateway's fixed finite
**30000ms** forwarding budget. Other routes retain the generic **5000ms** default.
Only those two heavy #33 operations use a **35000ms** client timeout; other #33
calls retain **10000ms**. Callers cannot set either policy. The approved latency
metric remains p95 <=30000ms (Floor), with <=10000ms reported separately (Target).
Extending a transport budget never turns the Target into the Floor or makes an
uncheckable candidate eligible.

Every attempted logical match key is retained before an accepted reply is known.
Answer-free attempt evidence contains request ID, key, correlation ID, monotonic
attempt ordinal, status, latency, normalized error and optional result ID. Final
admin reconciliation covers keys without returned IDs too. It distinguishes no
commit observed at the bounded cutoff, one matching result, observed late commit,
commit with lost reply, duplicate results, result mismatch and unavailable inventory.
Unavailable/malformed inventory keeps counts **null**, never measured zero. A late
commit establishes inventory, not unobserved ranking/explanation conformance.
Command checkpoints have their own `market-command` phase; they cannot inflate
`golden-case` counts. Golden evidence includes sanitized `commands.jsonl` and its
artifact digest. Retrying the same key is not a new logical command.

Validation commands (each owns private projects, keys, volumes and evidence):

```sh
node scripts/run-unit-tests.js
node scripts/verify-issue-33.js
python3 -m unittest discover -s scripts -p 'test_sprint1_*.py'
python3 -m unittest discover -s scripts -p 'test_sprint5_*.py'
python3 scripts/verify-issue-33-postgres.py
python3 scripts/run-sprint5.py --mode golden --formal-approved --golden-v2-approved
python3 scripts/run-sprint5.py --mode rehearsal --rehearsal-approved
git diff --check
```

Despite the inherited CLI flag name, standalone `--mode golden` is targeted
Marketplace evidence, **not** the formal 1000-profile suite. Rehearsal selects 100
frozen scenarios and uses real 60-minute response deadlines. Formal Run 2 requires
separate explicit approval and a distinct fresh evidence directory; do not start
it automatically or combine it with Run 1. Latest measured validation results and
remaining limitations belong in the Final Test Report delta note.

The first targeted 1000-agent run exposed a harness oracle error at
`golden-v2-limits-002`: revoked credentials also below the request score threshold
must report **both** trust and request reasons. `docs/contracts/marketplace.md`
requires every gate to run and every failure to be reported. The independent
oracle now preserves those combined reasons while excluding the candidate from
both lanes. It still imports no production evaluator. Literal contract tests and
a separate production-as-system-under-test comparison cover the combination.
No matrix, threshold, ranking rule or production gate was changed. Developer
golden selection now has **20 cases**, adding this exact Near Match/lane-limit
case to the previous 19; the frozen formal matrix remains 100 cases.

Final match inventory is inspected before other inventory groups, so an unrelated
admission/credential read failure cannot skip an attempted match key. Unavailable
final inventories do not retain stale measured-zero counts. Cleanup failure keeps
its command/result/attempt metadata and blocks the observation; an existing safety
mismatch or harness error is never downgraded. Unexpected post-dispatch errors
retain the key without arbitrary exception text. The aborted-caller regression
now waits for the second SERVER lookup before releasing the first paused job.

### Readiness verified 11 November 2026 (Dubai), before Formal Run 2

The completed standalone golden rerun at
`artifacts/issue-33/eduagentx-issue33-20261110t192122z-77168/golden/` is PASS:
1000 real learners, 100/100 cases CONFORMANT, 100 Capability Requests, all 105
logical Match commands reconciled once, zero Match/lane duplicates. Latency was
p50 17.531s, p95 22.591s, maximum 25.670s: the 30s Floor is MET and the separate
10s Target is MISSED. Its four artifact digests verify. The earlier targeted
92-case run remains FAIL, and Formal Run 1 remains BLOCKED.

The existing real-duration 100-scenario rehearsal remains healthy evidence for
the unchanged runtime/configuration files; later harness-only changes have their
own current-source golden, smoke, fault-accounting and unit checks. No completed
validation was restarted on resumption. See `issue-33-final-test-report-deltas.md`
for exact source fingerprints, fresh regression counts and limitations.

Do not rerun these completed validations or start Formal Run 2 automatically.
Overall Issue33 acceptance still needs the distinct complete formal execution
on the final clean commits, after explicit approval. Runtime evidence stays
ignored; the university Test Plan is unchanged.

## Formal Run 2 final handoff — 11 November 2026

**ISSUE #33 ACCEPTANCE PASS — READY FOR PR.** Completed evidence is local-only at
`artifacts/issue-33/eduagentx-issue33-20261110t235931z-95043/`.
Use `acceptance/report.json` and its manifest for the final combined verdict:
`technicalChecks=PASS`, `formalAcceptance=PASS`, `coreReady=true` in `phases.json`,
`formal1000=EXECUTED`, required measurements complete, no run errors or blockers.
All executed phases bind to clean source
`9071a6e44c70f2d3ea6945249101e81c30e25733`, fingerprint
`sha256:226f4688630f7c45a9b3a9ca350cc54c2d67e7add57d8fa4fe633030a17395c5`.

- Exactly 1000 distinct public black-box scenarios: 200/category, all lifecycle
  and complete expected narratives CONFORMANT. Robustness remains one category
  with 50 each malformed/inconsistent/timing-out/unavailable. Exact outcome rate
  is 100%; the >=90% Floor and separate >=95% Target are both MET.
- All 18000 declared mandatory invariant checks pass independently, with zero
  failed/unmeasured: Registration 3000; Curriculum/Training 3000; Examination
  4800; Certification 1400; Marketplace 1200; Remediation/Skill Gap 2000;
  cross-cutting safety 2600. Another 200 supporting no-credential checks pass
  without double-counting the declared totals.
- 200/200 mandatory-safety cases measured, zero false passes. Zero Examination
  or credential duplicates over all 1000 scenarios; zero Match/lane duplicates
  over 400 applicable lifecycle Marketplace observations. Final reconciliation
  is complete. The 200 deliberate remediation retakes are new attempts.
- 400/400 lifecycle Marketplace observations CONFORMANT, none blocked; p50
  5.752s, p95 6.151s, maximum 6.760s.
- Full golden-v2: 100/100 cases CONFORMANT, 1000 real lifecycle-origin learners,
  100 unique case Capability Requests. Case allocation is unchanged at
  20/20/20/15/15/10. Independent oracle/replay evidence validates membership,
  exclusions, scores, ranking, explanations, history and representative lanes.
  All 105 logical Match commands reconcile once, including five deliberate
  fresh history commands; zero Match/lane duplicates.
- Full-cohort fresh-command p50 13.564s, p95 14.699s, maximum 16.506s. The <=30s
  p95 acceptance Floor is MET; the <=10s optimization Target is MISSED. This
  target miss is separate from the MET 95% exact-outcome Target.
- Faults PASS, 40/40 checks: real 900000ms grading retry window with an explicitly
  accelerated one-minute response deadline; grading outage abort/no credential,
  partial/unavailable learner deadline failure and trusted grading completion
  after the response deadline. Formal lifecycle separately used 60-minute
  response deadlines. No production timing policy was changed.

The original formal subphase remains **BLOCKED/coreReady=true** because four
external gates were not assembled there: full golden, 1000-candidate load,
system-abort fault and grading-after-deadline fault. The existing finalizer checks
the same-source executed golden/fault reports and resolves all four in a new
**acceptance PASS** report. All 1000 scenario rows remain identical. Do not
rewrite the formal subphase, confuse its expected exit 2 with scenario failure,
or treat standalone golden `formal1000=NOT_RUN` as the combined run's status.

The read-only audit verified all 18 manifest-covered artifacts (faults 1,
formal 7, golden 4, acceptance 6), all report/JSONL accounting and final runner
status. The complete run's 24 files were preserved byte-for-byte. Formal Run 1's
12 files still match their preservation hashes: it remains **BLOCKED**, with
1000 lifecycle conformance, 600 exact complete outcomes and 400 disjoint
Marketplace blocks (180 matching unavailable, 220 origin integration); golden
NOT_RUN. The successful later run does not relabel this history.

Remaining limitations are documented, not hidden: the 10s golden target miss,
separate Red grading KPI, Skill Gap Superseded/Deprecated mismatch, naturally
aged/tied-cohort additional coverage, explicit concurrent Certification issuance
not measurable through a public command, arbitrary overlapping-request SLOs and
independent reproduction/release approval. The finalizer also leaves combined
general public-call latency unpopulated; the actual 116542-call sample remains
in `formal/latency.json`. Required Marketplace latency is fully measured.

Only this handoff and the final-report delta note were edited for closure
preparation. No phase was rerun or generated evidence changed; runtime artifacts
and audit working files remain ignored and uncommitted. The university Test Plan
is untouched. This is technical acceptance, with `releaseGate=NOT_EVALUATED`;
PR review, merge and issue closure remain team actions. No new run is required
to establish these recorded Issue #33 acceptance results.
