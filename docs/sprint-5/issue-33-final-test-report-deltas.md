# Issue 33: factual Test Plan to Final Test Report deltas

The submitted university Test Plan is external and untouched. This note records
implementation/setup/evidence changes; it is not a formal verdict or resubmission.

- PR84 adds exact signed-credential Certification-origin verification independent
  of signature/status checks. Descriptive learner labels no longer establish
  execution provenance; explicit enrollment and pinned executor receipts bind
  Training, Examination, Certification and projection.
- Synthetic simulation credentials use a separate test issuer and Ed25519 key.
  Tests and private Compose runners must provision this key, and PostgreSQL
  certification fixtures must use the simulation issuer instead of an arbitrary
  issuer. Production issuance policy was not changed by Issue33.
- The approved mixed remediable recipe has its own versioned source pin. Existing
  reference source digests remain stable. It tests the existing partially
  competent narrative rather than changing its expected outcome or grading.
- Latest TC_EXM_002 semantics remain correct: all 15 timely responses can be
  accepted while in_progress; poll for trusted grading, including after deadline.
- TC_EXM_003 identical authenticated retries still replay the original receipt.
  On enrolled provenance paths, an altered response with a stale receipt is
  rejected earlier as provenance_conflict. A changed semantic command with valid
  provenance still tests idempotency_conflict; stale valid sequence tests
  sequence_conflict. No duplicate result is permitted.
- TC_EXM_004 distinguishes learner deadline failure from the real 15-minute
  grading retry window and eventual system_aborted/grading_unavailable. Measured
  execution records, rather than assumed immediate abort, establish coverage.
- Marketplace Eligible can now be measured for actual signed synthetic lifecycle
  evidence. Public eligibility probes must observe async projection before an
  immutable matching command is frozen. A missing projection snapshot must not
  be rewritten on retry.
- Replay fixture execution remains governance-gated by actual recorded reviewers;
  live provenance remains disabled. Neither is required for synthetic Issue33.
- PR86 serializes concurrent DB-init GRANT operations; successful Compose startup
  alone is not a substitute for the owner PostgreSQL suites.
- PR89's seven passing hero scenarios are related platform evidence, not Issue33
  formal evidence. Its replay/live and reproduction limitations remain labelled.
- The original golden-v1 90/80 and ten-day-old declarations do not match a fresh
  current reference lifecycle (94.4/86). Salman approved a separately versioned fresh-cohort matrix on
  9 November 2026; no golden v1 case is silently rewritten or marked measured.

Use the latest final university classifications supplied by Salman: EXM001/002/
003 directly covered; EXM004 partially covered unless actual required-duration
fault evidence supports more. GRD002/005 and CRT002/003 remain conservative until
measured; GRD006 is directly covered. Marketplace classification can be strengthened
only using the new real public lifecycle results, never the upstream merge alone.
Separate age-gate HTTP contract coverage uses an explicit fixed clock and owner
fixtures; it proves the real request age gate without claiming aged Compose
lifecycle evidence. Over-age is excluded from Eligible, with a truthful Near
Match gap under the unchanged policy. The original submitted document is untouched.
No formal 1,000-scenario or full 100-case Marketplace verdict is asserted here.


Issue33 setup/evidence changes after the initial rebaseline:

- The private runner requires TCP PostgreSQL readiness. The official image's
  socket-only initialization server can otherwise release TCP db-init jobs early;
  failures were retained as BLOCKED setup trials, not scenario results. Normal
  tracked Compose and database permissions are unchanged.
- Final inventory reconciliation repeats logical admission, credential and match
  counts after the batch. Provisional progress survives interruption but is never
  aggregated as an acceptance result.
- Golden source uncertainty is BLOCKED only after checking the observable
  remainder for independent violations; it cannot conceal an invalid inclusion,
  duplicate, score, ordering or explanation.
- The full formal command includes separate fault, frozen-profile and golden
  projects, then digest-checked assembly. Watchdog process budgets are distinct
  from unchanged 60-minute learner and 15-minute grading contract windows.

Measured continuation on 9 November 2026:

- The new real pilot measured 25/25 complete narratives (100%), replacing the
  old 15/25 complete plus ten trust-blocked pilot comparison. This proves the
  previous synthetic origin/label gap is removed in this harness, not formal
  Issue33 acceptance.
- The real-deadline rehearsal measured 100/100 complete narratives, 20/category,
  in 79m40s. All independent invariants were held and measured; 20 mandatory
  safety cases had zero false passes, and all duplicate counters were zero.
  Its 40 Marketplace observations conformed. The 90% Floor and 95% Target are
  met for this sample only; formal 1000 and full golden 100 remain NOT_RUN.
- Fault evidence used the real 900000ms grading retry window, with a clearly
  labelled isolated one-minute response deadline. It proved eventual
  system_aborted/grading_unavailable without credential issuance, distinguished
  partial/unavailable learner timeouts, and accepted trusted passing grading
  after the response deadline. This does not claim a real-duration 60-minute
  infrastructure outage was executed.
- The final golden smoke measured 19 cases/12 real learners, including exact
  gaps and satisfied requirements. It is not the 100-case/1000-agent golden run.
  Existing verifier-adapter `SCHEMA_INVALID` plus suspended/revoked status codes
  are predicted explicitly rather than hidden by a subset explanation check.
- The additional aged-cohort public runner requires natural aging and current
  verification/origin/status/fingerprint/listing checks. Its adapter tests and
  the actual HTTP age-gate test pass; a retained naturally aged lifecycle-cohort
  execution remains NOT_RUN. Neither fake timestamps nor fixture authorities are
  counted as public acceptance. The unchanged policy excludes an over-age
  credential from Eligible and may report it honestly as Not Eligible/Near Match.

These facts may inform the later Final Test Report. They do not alter the
submitted Test Plan or supply any unexecuted formal verdict.

## Formal Run 1: BLOCKED — forensic update, 10 November 2026

The original, unmodified evidence is retained under
`artifacts/issue-33/eduagentx-issue33-20261109t171114z-18148/`.
It records clean source `da567e5f1fc19ad112a94b079cc28d361d6be9f7`, fingerprint
`sha256:529732bad50a26a01c96a892d74e5f7513fe19ce7a6c926c27e94d3b13542d87`.
All eight files covered by the formal/fault artifact manifests verified;
JSON, HTML, JSONL, final progress rows and latency/failure summaries agree.
This is hash consistency, not a new signed evidence attestation.

- Exactly 1000 public lifecycle scenarios executed and conformed: 200 in each
  approved profile. The four robustness subtypes remain 50 each. There were
  1200 distinct admitted attempts, including 200 deliberate remediation retakes,
  and 400 lifecycle-issued, verified credential mappings.
- The formal COMPLETE-outcome count was **600 CONFORMANT / 400 BLOCKED** (60%).
  The 90% Floor and 95% Target were MISSED; technical/formal acceptance remain
  **BLOCKED**. Lifecycle conformance is not complete Issue33 conformance.
- Registration 3000, Curriculum/Training 3000, Examination 4800, Certification
  1400, Remediation/SkillGap 2000 and cross-cutting safety 2600 invariant checks
  passed, with none failed/unmeasured in those groups. Marketplace had 440 passed,
  zero failed and 760 unmeasured; overall invariant measurement was incomplete.
- All 200 mandatory-safety cases were measured, with zero false passes.
  Examination/credential duplicate counts were zero over 1000 scenarios.
  Match/lane duplicate counts were zero over only 220 observed results. The
  remaining 180 ambiguous matching commands were not reconciled as matches;
  whole-run duplicate absence is therefore not proven. The report's final
  reconciliation flag must be read together with its incomplete duplicate flag.
- `matching_unavailable=180` means the harness retained no accepted match reply:
  119 competent and 61 remediable scenarios. HTTP status, exact retries, latency
  and late owner completion were not retained for these cases; they cannot all
  be relabelled as confirmed timeouts or confirmed non-commits.
- `marketplace_origin_integration=220` means a retained immutable match result
  contained `LIFECYCLE_ORIGIN_UNCHECKABLE` somewhere in its cohort: 81 competent,
  139 remediable. This legacy aggregate label is not proof that the old #84
  integration is missing. One such requested learner was itself Eligible; the
  other 219 were in neither returned lane. These populations do not overlap.
- All 220 retained results observed 400 projected credentials. The lifecycle
  phase issued credentials before its serial matching loop; there is no retained
  increasing-cohort curve in this phase. Size for the 180 missing replies is
  unrecorded. The blocker appeared before the separate 1000-agent golden cohort.
- There were 400 lifecycle Marketplace observations, zero conformant. The full
  golden phase was NOT_RUN after the formal-stage readiness check failed: zero
  formal golden cases, zero supplemental golden agents and zero golden requests.
- Among the 220 retained match timings, p50 was 6473ms, p95 12652ms and max
  17509ms, including retries/backoff for the fresh logical command. The missing
  180 timings make these unsuitable as whole-run performance acceptance evidence.
  No detailed original per-source traces, CPU samples or late-commit inventories
  survived invocation-owned container/volume cleanup.
- The separate fault phase passed 41/41 with the real 900000ms grading retry
  window and a labelled one-minute response deadline. Formal-stage NOT_RUN fault
  fields denote unassembled gates, not absence of that separate fault execution.

### Proven scalability boundary; repair pending

Current Marketplace code launches all candidates concurrently, with four logical
authority branches each. Verification makes separate signature/schema and status
HTTP reads: 5N scheduled HTTP calls (2000 at N=400; 5000 at N=1000). The same package
is fetched repeatedly; listing histories are read serially per learner, and
eligibility result rows are inserted serially. Idempotency prevents duplicate
committed results but does not prevent concurrent retries doing the same reads.

The owning sources have 2000ms client/guard deadlines, the Gateway uses its
generic 5000ms forwarding default, and Issue33's public client has a 10000ms
per-attempt bound with at most three attempts. Caller abort does not automatically
cancel downstream server/database work. The approved Marketplace contract is
**p95 <=30000ms, targeting <=10000ms**, not a five-second product maximum.
Increasing the Gateway timeout alone would not fix source-side uncheckability.

Small disposable diagnostics, with production timeouts/resource limits unchanged,
are retained separately under
`artifacts/issue-33/eduagentx-issue33-20261110t131602z-30898/`:

- Real public cohorts 10 and 50: three of three correct matches at each size.
  Their p95/max timings were 1152ms and 2439ms respectively (three-sample
  diagnostics, not formal latency evidence).
- Real public cohort 100: one of three correct; source deadlines excluded valid
  candidates even though all three requests returned HTTP 201 in 2.742–3.768s.
- A control with diagnostic preloads removed still produced only 1, 36 and 3
  Eligible candidates from 100 valid, published lifecycle learners. This rules
  out logging overhead as the sole cause. Supplementary control telemetry capture
  stopped on a non-object record; its seven completed measurement rows remain
  retained, and no missing detailed control trace is claimed.
- A read-only probe repeated real records from those 100 learners; it did NOT
  construct 400 distinct agents or count as acceptance. At 400 lookup jobs,
  unbounded dispatch timed out all 1600 logical source branches. Dispatching 16
  candidate jobs at a time obtained all 1600 valid answers with the SAME 2000ms
  per-source limits, in 8492ms in the no-preload control. No authority was mocked,
  no credential was fabricated, and no database was directly mutated.
- The diagnostic Marketplace cgroup was CPU-quota throttled; no OOM was observed.
  Instrumented 100-agent calls showed Marketplace event-loop p99 delay reaching
  1182ms. PostgreSQL query work is amplified, but a PostgreSQL engine failure,
  Redis bottleneck or hard socket-limit failure is not established. These are
  diagnostic observations, not recovered original-run resource metrics.

Classification: Marketplace fanout/scalability defect, secondary Gateway/source
budget mismatch, repeated lookup/SQL work and retry amplification. The #33
harness is already serial at the Marketplace observation level; it also has an
evidence gap for failed-command metadata/inventory. Cohort reduction, stale trust
caching, fixture substitution or weakening any authority gate are not remedies.

**READY FOR TARGETED FIX**, not ready for another formal run. First bound authority
dispatch and preserve every trust check. Re-measure correct results, then align
only the heavy-route/client budgets with the approved SLO if necessary; do not
blindly increase timeouts. Request-scoped read coalescing or batched owner SQL
may be evaluated next if measurements justify them, without cross-command status,
origin, fingerprint or governance caching. Preserve failure metadata and reconcile
every attempted match key even after an ambiguous reply.

No application source, production configuration or business rule was changed by
this forensic task. No formal rerun was started. Formal Run 1 remains BLOCKED;
after a reviewed repair, formal acceptance requires a distinct complete run with
matching source fingerprints and all lifecycle/golden/invariant/duplicate gates.

## Targeted remediation validation — 10 November 2026 (UTC)

Formal Run 1 remains BLOCKED and unchanged. The bounded-dispatch baseline is a
separate diagnostic at `artifacts/issue-33/eduagentx-issue33-20261110t150424z-38953/`:
15/15 committed results conformed at real cohorts 10/50/100/250/400, with 12150
successful direct authority HTTP reads. At 400, three Gateway 504 replies hid
correct late results; source limits remained 2000ms. This justified the narrow
30-second evaluation-route budget and 35-second heavy-client budget. Generic
Gateway/client defaults remain 5/10 seconds, and all trust/ranking policy is intact.

The real-duration rehearsal at
`artifacts/issue-33/eduagentx-issue33-20261110t161142z-57891/rehearsal/` completed:
100/100 full outcomes CONFORMANT; 1800/1800 invariant checks; 20/20 safety cases
measured with zero false passes; zero Exam/credential/Match/lane duplicates;
40/40 Marketplace observations conformant; matching p50 698ms, p95 1229ms,
max 2702ms. Both selected-sample outcome thresholds and both latency thresholds
were MET. The response deadline was 60 minutes. All seven manifest-covered files
verify. `coreReady=true`; the runner's exit 2 / technical BLOCKED deliberately
retains the unexecuted formal/golden/fault gates, rather than claiming acceptance.

The first targeted golden run at
`artifacts/issue-33/eduagentx-issue33-20261110t161139z-57497/golden/` remains **FAIL**:
1000 actual lifecycle candidates, 1001 projected credentials; 92/100 cases executed,
91 CONFORMANT, one MISMATCH (`golden-v2-limits-002`, `exclusion_reason`); eight cases
NOT_RUN. All 97 attempted match keys reconciled to exactly one result, zero lane
or Match duplicates; 189 transport attempts retained with no transport errors.
Conditional 92-case latency: p50 13631ms, p95 15952ms, max 18183ms. This is not a
complete 100-case latency/acceptance verdict. All four artifact digests verify.
The retained failure classification was `exclusion_reason`; detailed per-authority
traces were not retained for this run. The independent reproduction below proves
an oracle defect without inferring missing dependency timings or rewriting the
failed result.

Diagnosis: the oracle returned after collecting trust reasons, incorrectly omitting
simultaneous request-failure explanations for already revoked candidates. Current
production and the published every-gate contract agree on SCHEMA_INVALID,
STATUS_REVOKED **and** SCORE_OVERALL_BELOW. A component reproduction confirmed the
old oracle omitted the third reason. Correcting this is a harness fix, not a
relaxation of trust, explanations, thresholds or the 100-case matrix. The developer
subset now includes this combination. A distinct targeted rerun must supply the
missing complete golden result; the failed report is never overwritten or relabelled.

These two runtime reports share source fingerprint
`sha256:5ad897710609e9840d5d8fa447e32dd001cbf498a399369fbf807fa798eaaa6e`
on dirty base `da567e5`. Subsequent oracle/error-accounting/test hardening is kept
explicit: runtime Marketplace/Gateway/config files remain byte-identical, while
harness/test/documentation fingerprints change. New current-source validation is
required for that harness delta. No Formal Run 2, commit, push or PR has occurred
at this point. Final measured rerun results will be appended separately.

## Completed targeted golden validation — verified 11 November 2026 (Dubai)

**FORMAL RUN 1: BLOCKED.** Its twelve retained files still match the preservation
hashes. The separate 33-file forensic record also verifies. Its established
1000/1000 lifecycle conformance, 600/1000 complete outcomes, 400 Marketplace blocks
(`matching_unavailable=180`, `marketplace_origin_integration=220`, disjoint) and
golden phase NOT_RUN are unchanged. The earlier 92-case targeted failure remains
FAIL; no later evidence replaces or relabels either run.

**TARGETED 1000-AGENT GOLDEN VALIDATION: PASS.** Completed evidence:
`artifacts/issue-33/eduagentx-issue33-20261110t192122z-77168/golden/`.
This is standalone Marketplace readiness evidence, not overall Issue33 acceptance.

| Measurement | Verified result |
| --- | --- |
| Actual lifecycle candidate learners | 1000 |
| Projected credentials | 1001, including one deliberate representative-credential case |
| Golden cases | 100/100 CONFORMANT |
| Case families | 20 eligible, 20 gaps, 20 trust, 15 ranking, 15 history, 10 limits |
| Unique case Capability Requests | 100 |
| Logical Match commands reconciled | 105/105, including five deliberate fresh history commands |
| Retained transport attempts | 205: 105 HTTP 201 and 100 HTTP 200; zero transport errors |
| Match / lane duplicates | 0 / 0 |
| Fresh-command p50 / p95 / maximum | 17.531s / 22.591s / 25.670s |
| p95 <=30s acceptance Floor | MET |
| p95 <=10s Target | MISSED |
| Final reconciliation | Complete |

The four manifest-covered files (`report.json`, `marketplace.jsonl`,
`commands.jsonl`, `progress.jsonl`) verify byte-for-byte against their SHA-256
digests. The streams agree with the report: 100 unique declared cases, all
CONFORMANT; 1000 unique lifecycle mappings; one committed result for every
attempted logical match key; zero duplicate lane appearances. The runner records
PASS, `coreReady=true`, exit 0, and `formal1000=NOT_RUN`. Its private containers
have exited and been removed. No validation was restarted during the resumption.

The validated snapshot is dirty base
`da567e5f1fc19ad112a94b079cc28d361d6be9f7`, fingerprint
`sha256:a73a452ec27517080e1e65385a9973564d0bd19d3ea8f75e963c82449b2b0f3a`.
The resumption confirmed that the code matched that fingerprint before adding
these documentation results. Documentation updates change the full fingerprint;
the original evidence retains its actual source identity, rather than receiving
a later commit SHA retroactively.

### Remediation and trust review

The proven root cause was unbounded Marketplace authority fanout/queueing. A
shared candidate dispatcher now defaults to 16 workers, with server-only integer
configuration 1..32. Waiting for dispatch does not consume the unchanged 2000ms
source deadline. Every signature/schema, status/revocation, exact lifecycle origin,
provenance, current fingerprint, package/governance and discoverability check
remains in force. Uncertainty still excludes both result lanes. No trust gate,
grading/safety threshold, ranking rule or explanation requirement was weakened;
no authority cache, package coalescing, batch API or SQL rewrite was introduced.

Only heavy eligibility-check/match POST routes receive a 30000ms Gateway budget;
unrelated routes keep 5000ms. Only corresponding #33 heavy calls receive 35000ms;
other #33 calls keep 10000ms. The old five-second implementation bound was not the
approved Marketplace p95 contract. The measured 10s Target miss is therefore
acceptable for the 30s Floor while remaining an explicit missed target.

Harness corrections retain every attempted match key and answer-free transport
metadata, including missing replies and cleanup failures. Reconciliation checks
the owning inventory even when another group fails; unavailable inventory remains
unknown/BLOCKED rather than a measured zero. The independent oracle now reports
simultaneous trust and request failures as the existing every-gate contract
requires. The formal scenario manifest and 100-case golden matrix are unchanged.

### Current-source regressions and rehearsal validity

Fresh resumption checks, with no skipped tests counted as passes:

| Command / scope | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Complete Node suite | 973 | 0 | 0 |
| Focused #33 unit/security/contract checks | 664 | 0 | 0 |
| Sprint1 Python runner tests | 9 | 0 | 0 |
| Sprint5 Python runner tests | 16 | 0 | 0 |
| Disposable PostgreSQL integrations | 22 | 0 | 0 |

The focused verifier itself reports PARTIAL because its five optional database
environment slots are NOT_RUN. The dedicated disposable verifier separately
executed all five suites (Examination 13, Certification 2, Marketplace 5, Skill Gap
1, Training 1), with successful cleanup. The focused checks include bounded
dispatch, unchanged authority deadlines, route/auth boundaries, origin/provenance,
actual overlapping HTTP retry, reconciliation, exhaustive oracle explanations and
privacy. `git diff --check` passed. No composed lifecycle, golden or fault execution
was repeated during this resumption; the fresh database tests are supporting
integration checks, not black-box acceptance evidence.

The existing 100-scenario rehearsal remains valid for product behavior: all five
runtime/configuration files are byte-identical to those it exercised. Subsequent
changes were harness-only oracle/accounting/test hardening that preserved normal
product behavior. Its different fingerprint is retained honestly. The revised
20-case real golden smoke and six-check real-lifecycle accounting fault canary
also remain separate verified supporting records; injected client-side failures
in that canary are not positive trust fixtures or formal acceptance evidence.
No new rehearsal is necessary for these changes.

### Remaining acceptance and release work

**Issue33 overall PASS is not claimed. Formal Run 2 is still required**, using a
new source-locked evidence directory and the final clean commits. It must measure
the entire 1000-scenario/five-profile matrix, every invariant, safety and duplicate
gate, its own Marketplace matrix and required fault gates. Do not assemble a
formal PASS by combining Formal Run 1 with these targeted results.

The separate grading quality KPI remains Red; the Skill Gap Superseded/Deprecated
policy mismatch is unchanged. Naturally aged-credential exclusion remains
additional coverage outside the approved fresh-cohort matrix. Concurrent-heavy-
request performance, second-machine reproduction and independent human release
approval are not proven by this serial golden run. The submitted university
Test Plan is untouched. Runtime artifacts, credentials and secrets remain local
and must not be committed.

After explicit approval only, the next command is:

```sh
python3 scripts/run-sprint5.py --mode formal --formal-approved --golden-v2-approved
```

Allow approximately 10–12 uninterrupted hours on comparable resources: the prior
formal lifecycle phase took about 5h7m, and this successful targeted golden run
took 3h8m28s (2h30m15s cohort setup, 38m13s case/reconciliation work), plus the
formal lifecycle Marketplace observations, fault window and stack overhead.
This estimate is not a measured Formal Run 2 duration. No Formal Run 2 is launched
by documenting this command.
