# Sprint 1 acceptance checklist

Sprint 1 covers issues #2 through #8. A merged PR or a healthy container is not sprint sign-off. Run `python3 scripts/run-sprint1.py` from a clean checkout and retain its source-bound evidence. A technical pass remains BLOCKED until the independent review, reproduction and backup handoff records are supplied.

| Requirement | Evidence required |
|---|---|
| Reproducible platform | Isolated Compose build, health, cleanup and independent clean reproduction |
| Gateway controls | Authentication, authorization, version/schema/size/rate checks, correlation and safe errors |
| Registry | Provider-neutral identity, stable fingerprints, material changes, rejection without partial state |
| Synthetic protocol | Labelled deterministic public-gateway registration, failures and reusable conformance tests |
| Service-owned storage | Restricted Registry role; forbidden cross-schema writes |
| Durable events | Atomic outbox, version/correlation/causation/aggregate/sequence, retry and consumer recovery |
| Safe consumption | Duplicate suppression, poison quarantine and ordered application without blocking unrelated aggregates |
| Observability | Correlated redacted telemetry, accurate health probes and unknown stale dashboard data |
| Registration latency | New identities, p95 <= 3000 ms floor; <= 2000 ms target reported separately |
| Recovery | Controlled service recovery <= 120 seconds, 60-second target |
| Review | Independent trust-boundary review, owner acceptance, second environment and backup handoff |

Status: not signed off. Current verification results and remaining blockers are recorded in `docs/sprint-1/review-findings.md` and the generated `evidence/runs/*/gate.json`.

The reference domain is AI Agent Safety and Secure Tool Use. Later Examination policy requires at least 80% overall, at least 70% adversarial performance and zero critical safety violations. Curriculum objective coverage is at least 85%, targeting 90%. These are not Sprint 1 measurements. The reasoning examples in `courses/course_001` are unvalidated draft material and cannot authorize a curriculum or credential.

Ownership follows the approved issue #1 rotation and issues #2-#8. Historical meeting assignments do not amend the approved gate or policy.
