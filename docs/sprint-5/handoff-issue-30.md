# Issue 30 handoff: Capability Requests and Marketplace Eligibility

## What was delivered

- `services/marketplace-service` (port 4012, no host port) holds structured, simulated Capability Requests in the reference domain (`ai-agent-safety-secure-tool-use` only) and decides which Agent Learners are eligible. It does not score, rank, explain or produce Near Matches (#31) or Skill Gap output (#32). The contract is in [docs/contracts/marketplace.md](../contracts/marketplace.md).
- **Request validation:** `capability-request.js` does pure validation, a canonical `sha256:` digest and derived state (`draft`, `open`, `closed`; closed wins).
- **Eligibility gates:** `eligibility.js` has the pure gate function `checkEligibility(requestVersion, candidate, authoritative, now)`. It runs 14 gates in a fixed order and collects every failure as `{ code, gate, tag }`. Any missing or unknown input gives `<GATE>_UNCHECKABLE` (tag `trust`).
- **Projection:** `projection.js` folds credential events into a rebuildable projection record. Older events are ignored and revoked is final.
- **Storage:** `schema.sql` creates schema `marketplace_service`. Every table except `credential_projection` rejects UPDATE and DELETE with a trigger. `store.js` has a PostgreSQL store (advisory lock plus one transaction, one retry on a unique violation) and an in-memory store with the same interface for tests.
- **Routes:** `index.js` has the internal routes behind `x-internal-service-key` and `x-actor-subject`, idempotent replay with 409 on a changed body, and the eligibility check in three phases: read, ask the sources with no lock held, then one short transaction that rechecks the request is still open. `/health` returns 503 while config is missing or the schema is not applied.
- **Source clients:** `clients.js` has HTTP clients for the Agent Registry, validation-activation and credential-verification, one mapping function per source. A missing or unexpected field maps to null. The lifecycle-origin source always reports `source_not_available`. It also has a mapper from the credential certification-service issues to the candidate the gates read.
- **Event feed:** `stream-consumer.js` is a Redis Streams consumer (`certification.credentials`, group `marketplace-projection-v1`). It is at-least-once, removes duplicates through `projection_inbox`, quarantines poison entries after 3 attempts, and keeps running while Redis is down.
- **Gateway** (`services/api-gateway/index.js`):
  - Listing interactions `marketplace.listing.publish` and `marketplace.listing.withdraw`, acting as the token subject.
  - Request and check routes for `admin` and `demo_operator`; read routes for those plus `viewer`, `evaluator` and `governance_operator`.
  - Unknown body fields are refused before forwarding, and every route returns 503 when the Marketplace URL or key is missing.
- **Infrastructure:**
  - Role `marketplace_owner` (`db/init/007_marketplace_role.sh`), and `MARKETPLACE_DB_PASSWORD` and `MARKETPLACE_INTERNAL_KEY` in `.env.example`, `scripts/setup-dev.js` and `scripts/run-sprint1.py`.
  - In Compose, `marketplace-db-init` and `marketplace-service`, and the two Marketplace variables for `api-gateway`.
  - A `Dockerfile`, a `wait-for-healthy.sh` entry, a Prometheus health target, the Makefile `up` line and smoke step 16.
- **Docs:** `docs/contracts/marketplace.md`, plus Marketplace sections in `api-overview.md`, `external-agent-learner-protocol.md` and `architecture.md`.

Implementation commits: `dea2202`, `f2100b5`, `f631544`, `da6bcfc`, `18f7844`, `f4afd59`.

### Design decisions

| | Decision |
|---|---|
| A | Discoverability lives in Marketplace. An Agent Learner publishes or withdraws its own listing through the Gateway with its agent token; the listing is append-only events. The Agent Registry is not changed. |
| B | Domain and objectives come from the package pinned in the credential (package id, version and digest), read from validation-activation. A digest that differs from the pinned one makes both gates uncheckable, so the candidate is excluded. |
| C | Credentials do not record evidence environment or evidence mode yet. The environment gate returns `ENVIRONMENT_UNCHECKABLE` until certification-service adds the field; the mode gate uses the recorded assessment mode (`standard` or `fallback`). |
| D | Signature and status come from a verification source. Marketplace never re-implements credential cryptography. `INDETERMINATE` or unavailable means excluded with a reason. |
| E | Roles: create, version, open, close and run checks for `admin` and `demo_operator`. Inspect for those plus `viewer`, `evaluator` and `governance_operator`. `agent` may only publish or withdraw its own listing. Port 4012, no host port. Reason codes are tagged `trust` or `request`. No scoring, ranking or Near Match lists here (#31). |

Every external source is an injected interface with a fake in tests. A source without real data behind it answers "uncheckable", never "valid".

### Model (for #31)

| Item | Detail |
|---|---|
| Result lanes | `eligible` (no reasons) and `excluded` (one or more reasons). #31 must never place a candidate with any `trust` reason in either of its lanes; only candidates whose every reason is `request` can be Near Matches. |
| Order | `agentLearnerKey`, then `credentialId`, for stable evidence only. Not a ranking. |
| Evidence | `eligibility_checks` and `eligibility_check_results` are immutable; each result keeps its reasons and which sources answered. |
| Pure logic | `eligibility.js` (`checkEligibility`, `GATES`), `capability-request.js` (`validateRequestVersion`, `deriveRequestState`), `projection.js` (`applyCredentialEvent`). No HTTP, database or clock. |

## Run locally

Use Git Bash from the repository root with Docker Desktop running. These are the Makefile `up` steps run by hand. `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the container path `/docker-entrypoint-initdb.d/...` into a Windows path:

```bash
node scripts/setup-dev.js
docker compose up -d --wait postgres redis
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/002_registry_role.sh
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/003_curriculum_role.sh
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/004_training_role.sh
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/007_marketplace_role.sh
docker compose up --build -d
./scripts/wait-for-healthy.sh
```

marketplace-service has no host port; reach it through the Gateway at `http://localhost:8080`. For an existing Postgres volume the role also comes from the `marketplace-db-init` Compose service.

## Test

```bash
node scripts/install-dependencies.js
node scripts/generate-test-keys.js
node scripts/run-unit-tests.js
./scripts/smoke.sh
```

`run-unit-tests.js` passed 519/523 at handoff:

- marketplace-service: 74/74. That is pure gates, request validation, projection, routes with the in-memory store and fake sources, HTTP clients against stub servers, and the stream consumer with a fake Redis.
- api-gateway: 48/48, with 8 new in `test/marketplace.test.js`.
- The 4 failures are the existing assurance-console training-sessions tests (19–22), which also fail on `main`.

The PostgreSQL integration test uses the real pg store. It is skipped unless `MARKETPLACE_TEST_DATABASE_URL` is set. Point it only at a throwaway database: the tables are append-only, so test rows cannot be removed.

```bash
docker run --rm -d --name mkt-integration -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=marketplace_it -p 127.0.0.1:55433:5432 postgres:16
MARKETPLACE_TEST_DATABASE_URL=postgres://postgres:throwaway@127.0.0.1:55433/marketplace_it node --test services/marketplace-service/integration/postgres.test.js
docker rm -f mkt-integration
```

It passed 4/4 against `postgres:16`. Use the file path: `node --test <directory>` does not work on Node 24.

## Live check through the Gateway

Real tokens from `POST /v1/auth/tokens` (admin and agent clients), real Docker stack, Gateway only. The driver was a one-off script and is not in the repository.

| Check | Status | Output |
|---|---|---|
| Health: marketplace-service / Gateway | 200 / 200 | `eventFeed: running`; Gateway dependencies all `ok` |
| Agent creates a Capability Request | 403 | `forbidden` |
| Admin creates a request | 201 | `draft`, marketplace `simulation`, version 1 |
| Admin adds version 2 | 201 | versions 1 (min overall 85) and 2 (min overall 88), different digests |
| Admin opens version 2, reads it back | 200 / 200 | `open`, `openVersion: 2`; events `[opened v2]` |
| Agent `marketplace.listing.publish` | 201 | `published`, `discoverable: true`, label `SIMULATION: Synthetic Agent Learner` |
| Admin reads the listing | 200 | `discoverable: true`, one `published` event whose actor is the learner |
| First eligibility check | 201 | 0 candidates (no credential events exist) |
| One labelled local test event via `redis-cli XADD` | — | inbox outcome `applied`, nothing quarantined |
| Second eligibility check | 201 | 1 candidate, **0 eligible, 1 excluded** (reasons below) |
| First check read back | 200 | unchanged (same content; `jsonb` reorders keys only) |
| Close, then check | 200 / 409 | `closed` / `request_not_open` |
| marketplace-service stopped: Gateway route / Gateway `/health` | 502 / 200 | `upstream_unavailable` / `ok` |
| marketplace-service restarted, read the request | 200 | `closed`, events `[opened, closed]` |
| Smoke step 16 (run on its own; see Known limits) | 403 / 200 | agent refused; admin lists requests |

Exclusion reasons for the injected candidate, all tagged `trust`:

- `LIFECYCLE_ORIGIN_UNCHECKABLE`
- `SIGNATURE_UNCHECKABLE`, `SCHEMA_UNCHECKABLE`, `STATUS_UNCHECKABLE`
- `FINGERPRINT_MISMATCH`
- `ENVIRONMENT_UNCHECKABLE`
- `PACKAGE_UNCHECKABLE` (domain and objectives)

Sources: verification `source_unavailable`, lifecycle `source_not_available`, registry and package `answered`.

The test event (`local-smoke-20261018T000604Z`) used a non-project issuer under `local-smoke.invalid` and an unsigned `alg: none` jws.

Side effects of that run, which stay in `marketplace_service` (append-only):

- one projected local-smoke credential, which appears as excluded in every later check, and its inbox row;
- one closed request with two versions;
- two checks;
- one listing event for the synthetic learner.

`credential_projection` is the only table that may be rebuilt.

## Known limits and deviations

Upstream blockers (not changed here):

1. **certification-service** has no route to list credentials and publishes no credential events, so nothing feeds the projection. Its credentials carry no evidence environment and no evidence mode (synthetic, replay, live). The stream envelope in the contract is a proposal. Owner: Timurmalik.
2. **credential-verification** cannot verify real credentials:
   - It requires `issuanceDate` and the type `CompetencyCredential`, while certification-service issues `validFrom`/`validUntil` and `EduAgentXCompetencyCredential`.
   - It reads `expirationDate`, so it never detects expiry.
   - It trusts a different issuer.
   - Its public key is not mounted in Compose, so `/verify` returns 503.
   - Status is kept in memory and lost on restart, and `POST /verify` registers any `credentialId` it is given as `active`.
   - Its suspend, reinstate and revoke routes have no authentication, and it publishes port 4030 on all interfaces.

   Marketplace therefore calls `/verify` with the jws only, and reads status from the read-only `GET /status/:credentialId`. Owner: Luis.
3. **Lifecycle origin** has no route Marketplace may call to confirm a credential came from a real Certification Decision, so `LIFECYCLE_ORIGIN_UNCHECKABLE` excludes every candidate. Owner: Timurmalik.

Because of 1–3, no real Agent Learner can be eligible today. That is the intended fail-closed outcome, not a defect.

Marketplace:

- **Out-of-order events:** a status event that arrives before its credential's `credential.issued` event is ignored as `unknown_credential`, and events with the same timestamp apply in arrival order. The recheck against the status owner keeps this safe, but the projection can lag.
- **Check size:** a check asks every source for every projected credential at once (no paging or concurrency limit) and stores every result.
- **Stored checks:** `GET /v1/marketplace/eligibility-checks/:checkId` returns stored point-in-time evidence; it does not recheck.
- **Status lookup key:** status is looked up by the certification `credentialId`. Credential-verification has no agreed status key, so this has not been confirmed against real status data.
- **validation-activation:** in PostgreSQL mode it does not return the top-level `domain`, so the client reads `manifest.domain`. A wrong curriculum key gives 403, which Marketplace treats as unavailable.
- **Listings:** publishing when already published appends another event.
- **Not covered by the integration test:** the stream-attempt and quarantine store methods.

Pre-existing, not changed here:

- `./scripts/smoke.sh` fails at step 12 because the Assurance Console UI redesign (Issue #28, commit `6154c20`) no longer renders the text "Latest Agent Registry trace". The script therefore stops before step 16, which passed when its own lines were run on their own.
- The 4 assurance-console training-sessions unit tests fail on `main`.

Verification scope:

- `demo_operator`, `viewer`, `evaluator` and `governance_operator` were exercised only in Gateway tests with a stub, not live.
- Only one client at a time went through the live Gateway. The Prometheus scrape of `marketplace-service:4012/health` was not checked.

## Acceptance criteria review

**1. Authorized users can create, version, open, close and inspect immutable Capability Requests in the supported reference domain only. — Met (proven with fakes and proven live).**
Proof:
- `services/marketplace-service/capability-request.js` and `index.js`; the immutability triggers in `schema.sql`.
- `test/capability-request.test.js`: "an unsupported domain is rejected as domain_unsupported", "each bad field is rejected and named", "the digest is stable regardless of key order and set order".
- `test/app.test.js`: "create, version, open, close and inspect a Capability Request", "a new version never changes an older one", "create replays with the same key and body, and a changed body gets 409".
- `services/api-gateway/test/marketplace.test.js`: "admin and demo_operator may create, version, open, close and check; the actor is the token subject", "agent, viewer, evaluator, governance_operator and reviewer cannot write".
- Real database: `integration/postgres.test.js`, "create, version, open, close and inspect" and "evidence tables refuse UPDATE and DELETE; only the projection can change".
- Live: the create, version, open, read, close and agent-403 rows above.

Gap: only `admin` was used live; `demo_operator` is proven with a stub only.

**2. Candidates originate only from the real EduAgentX lifecycle and pass every gate. — Partly met (gate logic proven with fakes; not achievable live).**
Proof:
- `eligibility.js`; `test/eligibility.test.js`: "a fully valid candidate is eligible with no reasons", "gates run in the fixed order", "each gate fails alone with exactly its code, gate and tag", "scores exactly at the minimum pass and just below fail", "credential age exactly at the maximum passes and one millisecond older fails".
- `test/clients.test.js`: "toCandidate maps a credential exactly as certification-service issues it".
- Live: the injected candidate was excluded.

Gaps: lifecycle origin has no source (blocker 3) and environment is not in credentials (decision C), so no candidate can pass every gate. Nothing emits credential events (blocker 1), so candidates do not yet come from the real lifecycle at all.

**3. Tampered, expired, suspended, revoked, superseded, indeterminate, fingerprint-mismatched, cross-environment and non-discoverable agents enter neither result lane. — Partly met (all proven with fakes; partly proven live).**
Proof:
- `test/eligibility.test.js`: "each gate fails alone with exactly its code, gate and tag" covers `SIGNATURE_INVALID`, `EXPIRED`, `STATUS_SUSPENDED`, `STATUS_REVOKED`, `STATUS_SUPERSEDED`, `STATUS_INDETERMINATE`, `FINGERPRINT_MISMATCH`, `ENVIRONMENT_MISMATCH` and `NOT_DISCOVERABLE`, all tagged `trust`.
- `test/app.test.js`: "a non-discoverable agent is excluded with NOT_DISCOVERABLE", "a status change between two checks changes the result and leaves the old check unchanged", "a revoked credential never returns to active".
- `test/clients.test.js`: "verification: suspended and revoked map through; 404, unknown, other credential, error and timeout are indeterminate".
- Live: fingerprint mismatch and unverifiable signature, schema and status excluded the injected candidate.

Gaps:
- A real tampered credential was never tested, because credential-verification cannot verify any real credential (blocker 2).
- Expired, suspended, revoked, superseded and non-discoverable were not exercised live.
- "Neither lane" relies on #31 honouring the `trust` tag; the Near Match lane does not exist yet.

**4. An event-fed projection is rechecked against authoritative status and fingerprint before every response; uncertainty excludes the candidate with a reason. — Met for check results (proven with fakes; exclusion on uncertainty proven live).**
Proof:
- `stream-consumer.js`, `projection.js`, and the three-phase check in `index.js`.
- `test/stream-consumer.test.js`: "an issued event from the real credential shape is projected and acknowledged", "the same event delivered twice is applied once, and both deliveries are acknowledged", "an entry that keeps failing is quarantined after three attempts".
- `test/app.test.js`: "a source that throws or hangs excludes only that candidate as UNCHECKABLE", "a status change between two checks changes the result and leaves the old check unchanged".
- `test/eligibility.test.js`: "every authoritative field missing, null or "unknown" makes the candidate ineligible as UNCHECKABLE".
- Live: the injected event was consumed, and the check excluded it with `STATUS_UNCHECKABLE` and `FINGERPRINT_MISMATCH` after asking the owners.

Gaps:
- Reading a stored check returns point-in-time evidence without a recheck, by design.
- The live status read never returned a real status (blocker 2).
- The feed has no real producer (blocker 1).

**5. Eligibility, authorization, status-race, duplicate and failure-isolation tests pass with independent trust review. — Partly met (tests proven with fakes and against PostgreSQL; review not done).**
Proof, all passing at handoff:
- Eligibility: `test/eligibility.test.js`.
- Authorization: `services/api-gateway/test/marketplace.test.js`; `test/app.test.js` "the internal routes refuse a missing or wrong key and a missing actor with 401".
- Status race: `test/app.test.js` "a close while sources are being called makes the check fail with 409 and stores nothing", "a new open version while sources are being called makes the check fail with 409", "a withdrawal while sources are being called is seen by the stored result", "a status change between two checks changes the result and leaves the old check unchanged".
- Duplicates: "a duplicate projection event changes nothing", "a unique-key collision is retried once and then succeeds", and the stream consumer duplicate test.
- Failure isolation: "a source that throws or hangs excludes only that candidate as UNCHECKABLE", "a malformed entry is quarantined at once and does not block the next entry", "the consumer keeps running while Redis is down or failing".

Gap: no independent trust review has happened yet. This stays Partly met until a reviewer outside this work reviews the pull request.
