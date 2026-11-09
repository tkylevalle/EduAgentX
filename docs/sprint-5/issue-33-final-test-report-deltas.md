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
