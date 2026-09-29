# Sprint 1 review and verification

No commit or push was created. The local branch is `sprint1-docker-platform`, with a resolved, uncommitted merge of `origin/main` and the review fixes.

- Latest branch at start: `ffe36994d5deea14873fb1ad375512bac790ca0b`.
- Requested comparison baseline: `6272a602fb4b9016df6b471d0c1065ee9a6e3071`.
- Tested source SHA-256: `a53a9c771fd53c9a08f0a82acdf552fb763d9651f15664d4652e7784d01f8a37`.
- Source stayed unchanged throughout the final run.

## Verification

| Check | Result |
|---|---|
| Component, protocol and security tests | 43 passed in 6 components (4 services, 2 packages), none failed or skipped |
| Gate fail-closed tests | 5 passed |
| Real Compose security checks | 11 passed |
| Required technical checks | 21 passed |
| New-registration p95, 20 distinct identities | 43.8 ms; 3000 ms floor and 2000 ms target met |
| Redis / PostgreSQL recovery | 0.875 s / 2.938 s |
| Consumer interruption recovery | 2.312 s, below the 120 s floor and 60 s target |
| Durable retry after process restart and later configuration changes | Passed; original response preserved |
| Outbox recovery, duplicates, poison and sequence gaps | Passed, including unrelated identity progress during a gap |
| Registry role and repeated migration | Passed; cross-service writes denied and records preserved |
| Synthetic learner and Console workflow | Passed through the real Compose environment |
| Prometheus / Grafana probes | All four implemented HTTP services healthy |
| Redaction and correlation | Passed |
| Final code review of the cleanup | No critical or high findings; 1 medium and 4 low findings fixed |
| Diff whitespace check against origin/main | Passed |
| Isolated Compose cleanup | Passed; existing project data preserved |

The strict runner exited 2 with `technical_checks: PASS` and `status: BLOCKED`. It requires owner acceptance, an independent trust-boundary reviewer who is neither Primary nor an author, second-environment reproduction and a capability backup handoff. Those are real team actions and were not fabricated. Technical CI uses an explicit mode that can pass while the release record remains BLOCKED.

The [run record](runs/eduagentx-evidence-20260929t125615z-10084/run.json) contains measurements, checks and artifact hashes. The [gate record](runs/eduagentx-evidence-20260929t125615z-10084/gate.json) lists the remaining acceptance blockers. [Review findings](../docs/sprint-1/review-findings.md) separates Standards, Spec and defect findings and describes the fixes.

Docker Desktop initially failed on stale Windows runtime sockets. Stopping Desktop and preserving its stale runtime directory recovered the engine; no factory reset or Docker data deletion was needed. Development ports now bind to loopback. The Console remains an unauthenticated local demonstration UI and must not be publicly exposed.

Earlier diagnostic runs from this review are preserved locally under ignored `artifacts/review-attempts/`; they are not accepted evidence. Historical evidence imported from main is retained as historical evidence. The final pack preserves exact bytes across checkouts so its hashes remain valid.

## Maintainability cleanup (second pass)

- Shared code moved to `packages/` (`telemetry`, `external-agent-protocol`); the duplicated telemetry copies were removed.
- All images build from the repository root with one Dockerfile pattern and one root `.dockerignore`.
- `scripts/run-sprint1.py` is split into named check steps. Components are discovered automatically by `scripts/components.js`, so new services need no script edits.
- Nine retired one-off scripts were removed. Secrets have no fallback values in code.
- Docs moved under `docs/` (contracts, environment, architecture, Sprint 1 records, blueprint). `.env` is no longer tracked.
- `.gitattributes` and `.editorconfig` fix line endings to LF.
