# Issue 33 Phase 1: deterministic public lifecycle evaluation

Primary: Salman Akram. Base: `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0`.
Branch: `salman/issue-33-e2e-suite`. Phase 1 was committed and pushed as
`02e7dd7cc2ac9726d0c8f79d63d133d0cb929926`. Phase 2 changes remain uncommitted;
see [the Phase 2 handoff](handoff-issue-33-phase2.md).

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

The PostgreSQL verifier creates one new disposable container, four separate
databases and temporary random credentials. Its fixtures test storage contracts,
not lifecycle provenance. It removes only that named container/test data.
Alternatively the focused JS verifier runs the four integration suites when
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
