# Issue 33 rebaseline after PRs 84, 86 and 89

This extends, rather than erases, the historical Phase 1/2 handoffs. The original
feature commits are 02e7dd7 and 9b41068. Current main e865b8f was merged normally
at 50e7056; no old branch or commit was recreated. No formal 1,000 verdict exists.

## Execution authority

The frozen formal dataset remains version 1.0.0, hash
`sha256:c54705fbdc5a4ea51e00b8f3517a504d1a17019c085fa049a65f838df8c3abfd`.
Its five categories retain 200 cases each, four unsafe variants 50 each, and
malformed/inconsistent/timing-out/unavailable 50 each. Rehearsal is exactly the
first 20 frozen narratives per category; developer mode is the first five.

`executor.js` generates actual replies using the #84 authoritative executor.
This generation is separate from `oracle.js`, which imports no grader, matcher
or executor. Training and admission select an explicitly enrolled source;
responses carry receipts bound to the immutable Training/Examination run.
Enrolled subjects still authenticate through the existing Gateway RS256 issuer.
Caller labels do not grant execution authority.

Salman explicitly approved `synthetic:remediable:applied-low-effort-v1`: safe
recall/adversarial behavior plus low-effort applied behavior. Its separate
`remediable-v1.js` source pin preserves all existing reference source digests.
The source is opt-in, deterministic, versioned, and validated by the unchanged
receipt/run binding rules. Focused tests prove the intended safe failure and a
separate safe passing re-examination. No grading policy changed.

The private golden runner can provision 2,000 finite identities: 1,000 frozen formal
learners plus 1,000 separate supplemental golden-cohort learners. Supplemental
learners NEVER inflate the formal profile count. Normal lifecycle runs retain
exactly the original 1,000 configured learners. Secrets are random and private.
A bounded, read-only preload passes the enrollment file through the existing
validator because a 1,000-row JSON environment value exceeds Linux's per-string
exec limit. Only the isolated Gateway/Training commands use this preload; normal
Compose, authentication and enrollment defaults are unchanged.

## Measurements and independent expectations

`oracle.js` predicts original terminal state/reasons, registration, Training,
original credential count, remediation/re-examination, certification/verification,
Marketplace lane, policy, labels and trust properties from the frozen narrative.
The original failed examination remains distinct from its passing re-examination.
Missing measurements are UNMEASURED, never conformance. Critical-rule sets are
compared exactly, including the required empty set for safety-aware behavior. Mandatory-safety and
invariant results remain independent of the aggregate rate.

Marketplace projection is asynchronous. The suite probes public eligibility with
fresh deterministic probe keys before spending the stable match command key.
A replay must preserve the original snapshot, even if its cohort was empty.
The resulting eligible explanation retains only allowlisted labels, policy,
trust verdicts and a digest, never signed values, prompts or answers.

## Golden cohort: preserved v1 and approved v2

`marketplace.js` retains golden v1 unchanged, including its original 90/80,
ten-day-old fixture declarations. These are not the scores/age of newly issued
current synthetic credentials. Do not silently pretend those preconditions hold.

`golden-v2.js` is a SEPARATE revision approved by Salman on 9 November 2026.
It preserves the 20/20/20/15/15/10 family allocation and uses explicitly declared
current baseline scores 94.4 overall / 86 adversarial, five assessed objectives,
standard assessment, simulation/synthetic evidence. Lifecycle-issued signed
facts must match those declarations before matching; actual matching output
never supplies the expected lane or score.

`cohort.js` defines 1,000 independent supplemental identities. `golden-run.js`
registers, trains, examines, certifies and verifies them through the public seam,
then publishes listings. It creates one separate additional examination for a
representative-credential case, never database rows or fake signed evidence.
Status changes use admin suspend/reinstate/revoke APIs. Fingerprint changes use
learner registration; withdrawal uses the public listing workflow. Request
versions, closure, retries and historical reads use Marketplace APIs.

`golden-oracle.js` uses its own explicit state ledger and the published policy
arithmetic. Server IDs/issuance dates are inputs, not expected matching outcomes.
The server's evaluation timestamp is a time input only. All expected membership,
rank, components, gaps, ordering explanations and trust exclusions are computed
independently. The runner compares to real results and reconciles each command.

Approved v2 covers fresh-cohort score boundaries, objective/mode shortfalls,
status/fingerprint/listing/environment trust failures, preference components,
recency arithmetic, stable ordering, replay/version/history, lane limits and
representative credentials. It does not claim a freshly issued credential is
old, or that a real issuance-time tie occurred when it did not. Real aged-
credential exclusion requires a retained governed aged cohort; exact timestamp
and ID ties have supporting pure tests and are measured live only if present.
Those additional preconditions remain explicit; v1 is not relabelled executed.

Supporting age coverage in `services/marketplace-service/test/app.test.js`
executes the actual authenticated Marketplace HTTP route/gate at a fixed clock:
exactly one day passes; one millisecond over is excluded from Eligible and
reported as Not Eligible with `CREDENTIAL_TOO_OLD`. Its owner sources are
explicit component fixtures, not formal lifecycle-origin evidence. A real aged
retained-cohort run remains NOT_RUN and is not counted among the formal 100.
No fractional-day API override, fake clock in Compose, or backdated credential
is used for the formal matrix.

`age-case.js` and `scripts/verify-issue-33-age.js` provide the separate real public
retained-cohort workflow. Configure `E2E_GATEWAY_URL`, `ADMIN_CLIENT_ID` and
`ADMIN_CLIENT_SECRET` securely for that deployment, then run:

```sh
node scripts/verify-issue-33-age.js --examination-id <naturally-aged-passing-examination-uuid>
```

It reads the lifecycle-issued credential, verifies its signed value in memory,
requires a naturally elapsed age greater than one day, and opens a one-day-age
request through the Gateway. The target must be excluded from Eligible for
exactly `CREDENTIAL_TOO_OLD`, with every owner source answered and no trust
failure. Immutable check replay/history must agree. Fresh, missing, expired,
unpublished or unverifiable evidence cannot pass. No signed value is retained.
This public aged-cohort execution is **NOT_RUN** because no naturally aged,
retained deployment was supplied. Five adapter/oracle unit tests and the actual
HTTP gate test are supporting coverage, never substituted for that execution.
Age is a request requirement under the unchanged policy: an otherwise trusted
over-age candidate may appear in the separately labelled Not Eligible Near Match
lane. Exclusion here means exclusion from Eligible, not a new trust prohibition.

Developer golden smoke uses 12 real learners and 19 cases across all six families.
It is NOT the 100-case/1,000-agent Marketplace acceptance run. Full approved v2
execution requires both `--formal-approved` and `--golden-v2-approved`.

## Commands and gating

```sh
node scripts/verify-issue-33.js
python3 scripts/verify-issue-33-postgres.py
python3 -m unittest discover -s scripts -p 'test_sprint1_*.py'
python3 -m unittest discover -s scripts -p 'test_sprint5_*.py'
python3 scripts/run-sprint5.py --mode developer
python3 scripts/run-sprint5.py --mode golden-developer
python3 scripts/run-sprint5.py --mode phase2
```

Only after GREEN readiness and explicit execution review:

```sh
python3 scripts/run-sprint5.py --mode rehearsal --rehearsal-approved
# Full acceptance: fault proof, 1000 frozen narratives, 100-case/1000-agent golden, finalizer
python3 scripts/run-sprint5.py --mode formal --formal-approved --golden-v2-approved
# Optional full golden diagnostic alone; not required in addition to the command above
python3 scripts/run-sprint5.py --mode golden --formal-approved --golden-v2-approved
```

Rehearsal/formal retain real 60-minute response deadlines. Fault mode stops only
its private grader and retains the REAL 15-minute retry period; its accelerated
one-minute learner deadline is explicitly labelled. Source fingerprints are
locked during each stage. Nothing deletes developer volumes or old artifacts.

Formal mode now owns the whole staged run. It uses distinct private projects/
volumes for fault proof, the 1000-profile matrix, and the supplemental golden
cohort, then invokes the digest-checking finalizer. The lifecycle stage cannot
silently treat a missing golden measurement as PASS. The 90% floor controls
continuation independently of the 95% Target; an invariant, duplicate, safety or
measurement failure stops the pipeline. Formal and full-golden stages have a
bounded 12-hour process budget, separate from unchanged business deadlines.

`progress.jsonl` retains allowlisted provisional lifecycle and case snapshots
if a long run is interrupted. Its distinct schema explicitly says it is NOT
acceptance evidence. Only final reports and validated artifact manifests can
feed acceptance. There is no in-place resume; rerun in fresh private volumes.
No signed values, responses, prompts, grader text, tokens or secrets enter the
journal. Ordinary retries remain the owner's authenticated idempotent commands.

The formal lifecycle report still requires the full golden evidence gate and
therefore cannot report acceptance merely from 1,000 lifecycle narratives.
The finalizer binds reports only after checking artifact digests, the exact
source/dataset/cohort, all 100 unique requests/results, independent oracle
expectations, duplicates, real fault checks and full-cohort latency. Do not
manually relabel the lifecycle report PASS. Use:

```sh
node scripts/finalize-issue-33.js --lifecycle <formal/report.json> \
  --golden <golden/report.json> --faults <faults/report.json> \
  --output artifacts/issue-33/<new-combined-run>
```

## Current verification record

The first adapted pilot after the normal merge measured 25/25 complete outcomes,
all invariants, five safety cases and zero observed duplicates. All ten formerly
Marketplace-blocked outcomes became CONFORMANT. This is pilot evidence only.
Fresh disposable PostgreSQL tests passed 22/22. Merged baseline Node passed
919/919; one later 926-test run had an existing 200ms fallback-source HTTP timeout
under contention (925/926), with 11/11 in isolation. A quiet two-CPU-affinity complete run passed 934/934, zero skipped; this bounds
Node automatic test-file concurrency without changing any timeout or assertion.
Final golden/fault results must be taken from their dated run records,
not inferred from the intermediate pilot.

Replay still requires two real fixture reviews; live provenance remains disabled.
Neither is a prerequisite for synthetic Issue 33. #31 matching and #32 Skill Gap
contracts are present in merged code regardless of stale tracker state. The
Superseded/Deprecated mismatch and separate Red grading KPI are unchanged.
The private runner also requires PostgreSQL TCP readiness. The cached official
image's initdb server has `listen_addresses=''`; the normal socket health check
can therefore admit separate TCP DB-init jobs before the final server starts.
Several source-locked trials recorded `db_connection` / exit 2 before scenarios.
The private-only TCP probe fixes that setup race without changing tracked Compose,
roles, credentials, DNS, GRANT locking, or any business timing.

`reconciliation.js` repeats every logical admission, credential and match inventory
after all selected scenarios finish. It distinguishes a deliberate retake from a
replayed admission, catches a late duplicate, and updates original-attempt safety
credential counts so a late forbidden issuance cannot hide behind an earlier zero.
Unavailable final inventory is BLOCKED. Formal completion requires this final sweep.

The public Gateway currently uses a 5-second upstream proxy timeout for matching.
A successful 12-candidate smoke does not prove that 1,000-candidate fanout fits it.
The 30-second policy latency floor is not permission to change that timeout; load
failures remain visible. Full formal plus independent supplemental cohort may take
much longer than the lifecycle-only estimate. Use separately measured cohort setup
and case latency, with high-fanout runtime explicitly unmeasured.

No trust gate, threshold, production duration, or immutable outcome was weakened.

Golden source outages are BLOCKED when the observable remainder still matches
the independent oracle. A blocker cannot conceal an invalid inclusion, wrong
score/explanation, duplicate or rank among observable candidates. Approved v2
hash: `sha256:71994f305399d24726fd23ad74f668443f097209d13ebf82680f335dfac455e4`.


The final component baseline is 948/948 complete Node tests,
639/639 focused checks, 22/22 disposable PostgreSQL tests, and 9/9 + 16/16 Python
runner tests. Node's complete run uses a two-CPU affinity to bound automatic test
file concurrency; no assertion or timeout changed. The focused verifier separately
lists five optional PostgreSQL configurations NOT_RUN when absent; the disposable
runner executed all five. Two upstream opt-in mixed lifecycle/replay Compose test
entry points were NOT_RUN; Issue33 uses its own real public synthetic seam and
never fabricates replay reviews. These figures are component/pilot evidence,
not a formal 1000-case verdict. Dated runtime records retain earlier setup and
harness failures as well as their successful reruns.

## Measured rehearsal and final readiness: 9 November 2026

All fourteen pre-rehearsal gates were GREEN. The real 100-scenario rehearsal
ran from 14:08:16.300 to 15:27:56.578 UTC: **79 minutes 40 seconds**, with the
unchanged 60-minute learner deadline. It measured 100/100 exact COMPLETE
narratives, 20/20 in each approved category. Both the 90% Floor and 95% Target
were met **for this non-formal selected sample only**.

| Invariant group | Passed | Failed | Unmeasured |
| --- | ---: | ---: | ---: |
| Registration | 300 | 0 | 0 |
| Curriculum / Training | 300 | 0 | 0 |
| Examination | 480 | 0 | 0 |
| Certification | 140 | 0 | 0 |
| Marketplace | 120 | 0 | 0 |
| Remediation / Skill Gap | 200 | 0 | 0 |
| Cross-cutting safety | 260 | 0 | 0 |

All 20 labelled mandatory-safety cases were measured: zero false passes.
Admission and credential inventories were reconciled for all 100 scenarios;
40 match commands/lane inventories were reconciled. Every duplicate count was
zero. All 40 Marketplace observations conformed, with fresh-command p95 860ms,
maximum 1341ms. No grouped failure, run error or current trust blocker remained.
The lifecycle report correctly retains `technicalChecks=BLOCKED` and
`formalAcceptance=NOT_RUN`: neither the formal 1000 nor its full golden gate was
executed. Separate fault reports are not silently merged into a rehearsal.

The final real golden smoke passed 19/19 cases using 12 lifecycle learners,
20 reconciled match commands and zero duplicates. It additionally verifies exact
gap parameters and satisfied-requirement lists. The current verifier adapter
maps INVALID overall suspension/revocation reports to `SCHEMA_INVALID` as well
as the status code; the independent oracle predicts that existing fail-closed
behavior explicitly. Production verification was not changed. An earlier smoke
mismatch is retained in its original artifacts, not overwritten.

| Evidence | Local ignored record |
| --- | --- |
| Complete Node 948/948 | `artifacts/issue-33/audited-final-node-1794243522817745121/unit-tests.json` |
| Focused 639/639; five optional DB configurations separately NOT_RUN | `artifacts/issue-33/verification-2026-11-09T16-58-42-090Z/report.json` |
| Disposable PostgreSQL 22/22, five service suites | `artifacts/issue-33/eduagentx-issue33-pg-20261109t135206z-6838/report.json` |
| Sprint1 composed technical 21/21 | `evidence/runs/eduagentx-evidence-20261109t125419z-189948/gate.json` |
| 25/25 real complete pilot | `artifacts/issue-33/eduagentx-issue33-20261109t131440z-2927/developer/report.json` |
| Default-duration 5/5, stress 7/7, real retry fault 41/41 | `artifacts/issue-33/eduagentx-issue33-20261109t131437z-2859/` |
| 100/100 real-deadline rehearsal | `artifacts/issue-33/eduagentx-issue33-20261109t140716z-12518/rehearsal/report.json` |
| Final 19/19 golden smoke | `artifacts/issue-33/eduagentx-issue33-20261109t165844z-15035/golden-developer/report.json` |

Each real run records its own pre-commit SHA, dirty status and locked content
fingerprint; later documentation/additional-age/explanation checks do not
retroactively change those source identities. The rehearsal's lifecycle/oracle
code remained unchanged afterward. Sprint1 technical PASS does not remove its
existing governance/reproduction release BLOCKED result. Upstream opt-in mixed
real/replay integration entrypoints remain NOT_RUN; no replay reviews were faked.

The rehearsal's roughly 19.7 minutes outside its fixed hour, scaled tenfold plus
one hour, suggests about 257 minutes for the formal lifecycle stage. The latest
12-agent golden setup took 126.8 seconds, suggesting another 176 minutes for
1000 supplemental passing learners before full-fanout cases. Add real 15-minute
fault observation, setup, final inventories and case control operations:
**plan about 7.5–10 hours for the combined command**, not a guaranteed duration.
1000-candidate fanout behind the unchanged five-second Gateway timeout is still
unmeasured. Roughly 945GiB free disk and 12GiB available RAM met preflight;
resource capacity at full load is not thereby proven.

**READY FOR FORMAL 1,000 RUN** means ready to launch and measure, not accepted.
Use the formal command above from the reviewed committed checkout in a durable
session. It has not been started here. Interruptions retain safe provisional
journals, but there is no in-place resume; reruns use fresh private volumes.
No PR or Issue33 closure is appropriate until actual formal acceptance exists.
