# Issue 14 handoff: Freshness, quarantine, and deterministic fallback

## Delivered in this increment

- `services/curriculum-engine/fallback.js` defines the immutable 15-item AI Safety fallback bank and scoring policy. The bank has 5 recall, 6 applied, and 4 adversarial items; every item pins an objective and official-source pinpoint. Scoring is exact and deterministic, with tier weights 20/40/40, an 80 overall threshold, a 70 adversarial threshold, and a critical-safety failure rule.
- The curriculum-engine candidate validator and validation-activation fallback gate reject missing, extra, duplicated, unlinked, mis-tiered, unpinned, malformed, or non-deterministically-scored fallback items.
- Validation activation records source-check evidence against the immutable package version. The default check interval is 30 days. Same-content SHA-256 evidence maps to `No Change`; changed evidence must use the restricted impact values `watch`, `editorial`, `material`, or `critical`, which map to `Watch`, `Patch`, `Substantive`, and `Critical`.
- `Patch`, `Substantive`, and `Critical` checks create a separate Candidate Package with a distinct package ID, a predecessor reference, updated source evidence, and recalculated artifact pins. The current Active package remains unchanged.
- A critical check records an append-only quarantine event at one exact source, module, objective, or delivery-item scope. Training receives these scopes from validation-activation and refuses plans that touch them. The package read routes also report `certificationBlocked` for downstream certification consumers.
- A quarantine can be cleared only after a different package is Active and the restoration request records a reason and evidence reference.
- Fallback selection requires an Active package, a passing validation event that includes the fallback-readiness gate, a matching manifest hash pin, an explicit standard-generation or standard-grading outage reason, and no quarantine affecting any bank item. The selection response omits expected answers. Partial scoring requests are refused; accepted scoring is deterministic and recorded as immutable evidence.
- Curriculum-index removes quarantined module content when rebuilding. Every query rechecks the current Active package and quarantine scopes in Postgres; live ChromaDB results and cached-stale results are filtered against that state. If Postgres cannot verify the current trust state, retrieval fails closed instead of serving a potentially quarantined snapshot.

## Service contracts

| Route | Behavior |
|---|---|
| `GET /packages/:id/freshness?intervalDays=30` | Lists each source's latest check and whether it is due. The parameter defaults to 30 days and accepts 1–3650. |
| `POST /packages/:id/freshness-checks` | Requires the internal service key and actor. Body: `{ "sourceId", "evidence": { "observedAt", "evidenceUrl", "snapshotReference", "contentSha256", "changeKind", "summary", "edition?" }, "scope?" }`. `Critical` requires one exact existing scope. |
| `POST /packages/:id/quarantines/restore` | Requires an exact scope, reason, evidence reference, and a distinct Active replacement package. |
| `POST /fallback/select` | Requires `{ "package_id", "reason": "standard_generation_unavailable" | "standard_grading_unavailable" }` and internal actor headers. Returns the 15 questions without keys plus a new `attemptId`. |
| `POST /fallback/score` | Requires `{ "package_id", "attemptId", "responses": [{ "itemId", "answer" }] }`. A response set must contain all 15 items exactly once. Each attempt can be scored once. |

## Verification

Passed 10 focused tests across curriculum-engine, curriculum-index, validation-activation, and training-service. The existing validation-activation activation test also passed. Tests cover the exact bank size and tiers, source pins, scoring and critical failure, freshness classification and 30-day due behavior, Candidate isolation, scope validation, quarantine-aware Training decisions, quarantine-aware index rebuild/query, stale-cache filtering, and fail-closed database loss.

The complete repository test runner could not be used as a release gate in this environment: npm dependencies were not available offline, network access to npm was blocked, and the runner emitted no usable TAP summaries. `services/validation-activation/test/issue14-routes.test.js` is included for route-level integration coverage, but it could not run here because the sandbox disallows opening local listening sockets; the route layer was syntax-checked instead.

## Remaining dependency boundary

Issue #10's existing validation-activation gates still expect the older snake-case package contract, while the current curriculum-engine emits the pinned camel-case contract. The archived Issue 12 handoff also records that the five non-fallback gates and review workflow do not yet activate a real package. Therefore this work can create and quarantine refresh candidates and can select a fully validated bank, but an end-to-end activation of this real candidate remains blocked until Issue #10 reconciles those contracts and proves the review/activation path. A changed official source hash must also be independently reviewed and added to the controlled source baseline before the Candidate can pass validation.

The check endpoint records an authenticated operator's hash and impact assessment; it does not download publisher pages on a schedule or infer semantic impact from document text. `GET .../freshness` exposes which sources are due so an approved checker can collect the official snapshot and submit the evidence.
