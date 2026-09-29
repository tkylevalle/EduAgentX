# Sprint 1 integration review

Requested baseline: `origin/main` at `6272a602fb4b9016df6b471d0c1065ee9a6e3071`.
Latest remote work: `sprint1-docker-platform` at `ffe36994d5deea14873fb1ad375512bac790ca0b`.
The branches have multiple merge bases. Both tips and the combined working tree were inspected. The local integration is intentionally uncommitted pending the user's review.

## Standards

The parallel Standards review identified four documented-standard findings: unit-only CI presented as a complete gate, stale success evidence after a failed rerun, incomplete failure/recovery checks, and a configurable acceptance floor. The integration uses a single isolated, source-bound runner with separate strict and technical-only exit behavior; every run has fresh artifacts and a current failure result. Recovery and registration measurements are mandatory and their floors are fixed. CI uploads the actual run directory.

The reviewer also noted possible duplicated environment parsing in two legacy standalone benchmark scripts. These do not determine the sprint gate; the authoritative runner supplies a single isolated environment. This heuristic was not treated as a correctness defect.

## Spec

The parallel Spec review identified eight initial findings: missing integration of core implementations, absent durable delivery/consumer recovery, unrestricted database ownership, an incomplete gate, misleading API/signoff documents, broken monitoring, a reusable Grafana password, and unvalidated course material presented as accepted curriculum.

The integration restores main's Registry/protocol/telemetry work, adds durable registration replay and a transactional outbox, and applies Redis consumer-group messages through a durable ordered inbox. Malformed events are quarantined, send/processing attempts are bounded, and exhausted events remain blocked for operator investigation. PostgreSQL uses a Registry-only role with an existing-volume migration. Monitoring probes the implemented HTTP health routes through a blackbox exporter; Grafana reports stale observations as UNKNOWN. New local credentials are generated, existing credentials are preserved, and published development ports bind to loopback. Contracts and checklist match the implemented Sprint 1 scope. Historical reasoning exercises remain explicitly unvalidated drafts; their incorrect Pareto answer and ambiguous anomaly baseline were corrected.

## Defect review

The defect-first review confirmed the integration, CI and monitoring blockers, plus the incorrect Pareto answer. It also reproduced a gateway process crash from a control character in a JSON correlation ID, identified public exposure of the local Console's administrative trace, and demonstrated cached-conflict poisoning of a legitimate durable request key. The fixes validate all header-bound protocol identifiers, restrict development ports to loopback, and avoid caching conflicts or transient upstream failures. The Console remains an unauthenticated local demonstration UI and must not be published externally.

Follow-up reviews prompted real Synthetic/Console Compose checks, a non-destructive database upgrade path, polling for Redis acknowledgment instead of racing SQL commit, and an explicit independent trust-review attestation.

## Acceptance still requires people

Automated technical success does not close the Sprint 1 gate. The team must supply source-matched owner acceptance, independent reproduction in a second environment, a capability backup handoff, and a trust-boundary review by a third person who is neither Primary nor an implementation author. No such approval was invented by this review. Missing records keep `gate.json` BLOCKED.

Run `python3 scripts/run-sprint1.py` for the strict gate. CI uses `--technical-only`, which can pass technical checks while retaining BLOCKED release status. Inspect the matching `evidence/runs/*/run.json` and `gate.json`; earlier runs are historical and do not prove this source version. Final local verification notes are in `evidence/review-summary.md` when available.

Dependency audit follow-up removed unused uuid dependencies and updated the affected Express/qs dependency tree within supported ranges. Service lock files and npm ci now fix the tested package set. Container builds and CI use Node 24 LTS because [Node 20 is end of life](https://nodejs.org/en/about/previous-releases).
