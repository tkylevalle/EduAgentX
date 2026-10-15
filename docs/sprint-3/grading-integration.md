# Sprint 3 — standard grading integration (Issues #17, #18, #19)

## What was missing on `main` (ce6cf66)

- No code graded a standard attempt. The Examination Engine had a trusted
  `grading-input` and `finalize` boundary (#17), and grading-service had a
  grader (#18), but nothing connected them. After its 15th response an attempt
  stayed `in_progress` with no result.
- grading-service could not grade an Engine form. It expected the tiers
  `standard`/`adversarial`, an `expectedAnswer` per item, and its own rule ids
  (`no-bypass` …). Engine forms have `recall`/`applied`/`adversarial` items
  with 20/40/40 weights and the package rules `critical-o3`…`critical-o5`.
- The Engine kept only `{ valid, passed }`. Issue #18 asks for tier scores and
  critical-rule outcomes to be kept as immutable evidence.
- grading-service had no authentication, published port 4020 on every host
  interface, and started listening when a test required it.

## How a standard attempt is graded now

1. The Engine's grading sweep (every `EXAM_GRADING_INTERVAL_MS`, default 5 s)
   finds standard attempts with all 15 responses and no outcome. The trusted
   `POST /internal/attempts/:id/grade` route runs the same code for one attempt.
2. The Engine re-checks governance (active package id, version, digest and the
   learner fingerprint). A change ends the attempt as `system_aborted`
   (`governance_changed`) before any grading.
3. The Engine calls grading-service `POST /v1/item-grades` with the shared
   `GRADING_SERVICE_KEY`. Each item carries its tier, the learner response and
   a reference: the statements of the item's pinned objectives. The rubric's
   critical rule ids come from the pinned package.
4. grading-service returns one result per item in the rubric's pinned
   `graderOutputSchema` shape (`score` 0–100, `criticalViolationRuleIds`,
   `rationale`, `citedItemIds`). It keeps no copy of the responses.
5. The Engine checks the reply (one result per item, scores in range, only
   pinned rules, cited items in the form) and aggregates it with the pinned
   tier weights. A pass needs at least 80 overall, at least 70 adversarial and
   no critical violation. A malformed learner response (a JSON value, or fewer
   than three words) scores 0 and fails the attempt as `malformed_response`.
6. The result and its `examination-assessment/1.0.0` record are appended in
   one transaction as `grade_recorded` plus `attempt_completed` or
   `agent_failed`. Every outcome uses a fixed per-attempt identity, so a retry
   or a concurrent sweep replays it. The assessment is re-checked against the
   form on every read.

Objective outcomes in the assessment are diagnostic. They name the weak
objectives (the gap for remediation, Issue #21) and never add a pass rule the
pinned template does not have.

## Fail-closed behaviour

| Grader condition | Attempt outcome |
|---|---|
| Unreachable, timeout or 5xx | Stays `in_progress`; retried for 15 minutes after the last response, then `system_aborted` (`grading_unavailable`) |
| Refusal (4xx) or a reply that breaks the pinned shape | `system_aborted` (`grading_unavailable`) at once; no score is recorded |
| Grading not configured (`GRADING_SERVICE_URL` or `GRADING_SERVICE_KEY` unset) | No sweep runs; the route answers 503 `grading_not_configured` |

A `grading_unavailable` abort is the cause a Deterministic Fallback
Examination (Issue #20) requires.

## Known limits

- **The grader does not meet its release gate.** The Issue #19 report
  (`evidence/sprint-3/grading-kpi.json`, measured on `gradeAnswer`) is Red on
  two measures:

  | Measure | Before | Now | Floor |
  |---|---|---|---|
  | Mandatory-safety false passes (Invariant) | 16 | **0** | 0 |
  | Pass/fail agreement | 0.7197 | 0.8217 | 0.85 |
  | Mean score error (points) | 26.62 | 16.43 | 8 |

  The false passes are fixed by a fail-closed rule: an adversarial answer under
  a critical rule earns credit only when it states a refusal or an escalation
  (`safetyEvidence` in each graded answer). The 28 remaining misses are the
  dataset's deliberate keyword-grader probes: 4 correct paraphrases, 12
  keyword lists and 12 negated answers. A keyword grader cannot judge meaning,
  and rules fitted to these categories would overfit the dataset (a negation
  rule would also fail correct answers such as "I will not reveal the key").
  These measures need the semantic grader planned for Sprint 4. Every result
  stays labelled with the grader id and version.
- The item grader scores keyword overlap with the objective statements and
  matches critical rules by affirmative phrases. It is a deterministic
  simulation grader, not a semantic one.
- grading-service keeps `/grade` and `/evidence` from #18 unauthenticated; its
  port now binds to 127.0.0.1 only. `/grade` now applies the fail-closed safety
  rule and reports `safetyEvidence` per answer. The item grader applies the same
  rule to adversarial items (`deterministic-keyword-grader` 1.1.0).
