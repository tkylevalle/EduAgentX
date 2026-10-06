# Issue 12 handoff: Training delivery and session state

## What was delivered

- `services/training-service` (port 4004, internal only) delivers an ordered Training Session to a registered Agent Learner against one pinned Domain Assurance Package. It never grades, certifies or changes model weights.
- Session state is derived from append-only events. `training_service.sessions` is written once per session; `training_service.session_events` records every step with package, module, objectives, evidence mode, environment and timestamps. Both tables reject UPDATE and DELETE with a trigger.
- A session pins the validation service's `packageId` + `digest` at start (`pinGoverningPackage` / `pinMismatch` in `session.js`). Start needs an Active package. Every start, continue and submit re-checks the package state and digest and the learner's `configurationFingerprint`.
- Writes take a PostgreSQL advisory lock per Agent Learner and append in one transaction; a unique-constraint collision is re-read and decided once more. Replays with the same idempotency key return the stored response; a different body with the same key returns 409.
- Real HTTP clients for validation-activation (`GET /packages/active`, `GET /packages/:id`) and the Agent Registry (`GET /v1/registrations?agentLearnerKey=`), each with one mapping function that fails closed on a missing field (`clients.js`).
- The API Gateway forwards `training.session.start`, `training.session.continue` and `training.session.submit` to Training as the token's subject, and adds read-only admin routes `GET /v1/admin/training-sessions` and `GET /v1/admin/training-sessions/:sessionId`.
- The Assurance Console shows a read-only Training Sessions section (current and history) and serves `/api/training-sessions` and `/api/training-sessions/:sessionId`.
- Infrastructure: role `training_owner` (`db/init/004_training_role.sh`), `TRAINING_DB_PASSWORD` and `TRAINING_INTERNAL_KEY` in `.env.example`, `scripts/setup-dev.js` and `scripts/run-sprint1.py`, a Compose service, a `wait-for-healthy.sh` entry, a Prometheus health target, and smoke step 14.
- `services/training-service/dev/stub-package-service.js`: a demo fixture used for the end-to-end check below. It is not validation-activation.

Implementation commits: `4c29bb6`, `a3acc44`, `3fdec72`, `c031a6b`, `fb5d998`, `df0016e`, `74a58f7`, `27e9dc0`, `5091032`, `0b32538`.

### Session model (for #13)

| Item | Detail |
|---|---|
| Internal routes | `POST /internal/sessions/start`, `POST /internal/sessions/:id/continue`, `POST /internal/sessions/:id/submit`, `GET /internal/sessions?agentLearnerKey=&status=`, `GET /internal/sessions/:id`. All need `x-internal-service-key` and `x-actor-subject`. |
| Event types | `session_started`, `item_delivered`, `item_completed`, `session_completed`, `session_blocked` |
| Derived status | `open` (started, no completion or block), `completed`, `blocked` (with `blockReason`) |
| Delivery order | Modules by ascending `sequence`, then each module's `deliveryItems` in array order |
| Block reasons | `package_state:<State>`, `package_digest_changed`, `package_identity_changed`, `registration_missing`, `configuration_changed` |
| Pure logic | `session.js`: `deriveSessionState`, `nextItem`, `decideStart`, `decideContinue`, `decideSubmit` (no HTTP, database or clock) |

## Run locally

Use Git Bash from the repository root with Docker Desktop running. These are the Makefile `up` steps run by hand. `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the container path `/docker-entrypoint-initdb.d/...` into a Windows path:

```bash
node scripts/setup-dev.js
docker compose up -d --wait postgres redis
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/002_registry_role.sh
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/003_curriculum_role.sh
MSYS_NO_PATHCONV=1 docker compose exec -T postgres sh /docker-entrypoint-initdb.d/004_training_role.sh
docker compose up --build -d
./scripts/wait-for-healthy.sh
```

Training has no host port; reach it through the Gateway at `http://localhost:8080`. The Console is at `http://localhost:4173`.

## Test

```bash
node scripts/install-dependencies.js
node scripts/generate-test-keys.js
node scripts/run-unit-tests.js
./scripts/smoke.sh
```

`run-unit-tests.js` passed 104/104 at handoff: training-service 34 (pure logic, routes with fakes, HTTP clients against stub servers), api-gateway 19 (6 new in `test/training.test.js`), assurance-console 3 (2 new in `test/training-sessions.test.js`). Smoke step 14 checks that `GET /v1/admin/training-sessions` returns 403 for an agent and 200 for an admin.

## End-to-end check against the stub package source

validation-activation cannot activate any real package yet, so Training was verified end to end against `services/training-service/dev/stub-package-service.js`, a demo fixture with placeholder lessons.

Why the real path is blocked: the curriculum-engine example (`services/curriculum-engine/examples/ai-safety-candidate.js`) is rejected by `POST /packages` because it has no top-level `id`. With `id` and `version` copied from its manifest, `POST /validate` fails all six gates:

| Gate | Error | Cause |
|---|---|---|
| `schema_manifest` | Missing fields: examination_template, fallback_bank | Naming: the package uses `examTemplate` and `fallbackBank` |
| `source_traceability` | 5 module(s) missing approved source or hash | Shape: gate wants `module.source` and `module.source_hash`; the package cites `claims[].sourceId` and pins `sources[].contentSha256` |
| `objective_coverage` | 5 objective(s) fail coverage requirements | Shape: gate wants `module_id`, `examination_slots`, `safety_critical`, `adversarial_coverage`, `critical_rule` |
| `examination_policy` | Examination template missing pass threshold, question count, or tiers | Unfinished content: no pass threshold |
| `rubric_policy` | Rubric missing score floor (3.5), target (4.0), or criteria | Unfinished content: rubric criteria pending |
| `fallback_readiness` | Fallback bank missing items (min 5) or version | Unfinished content: fallback items pending #14 |

The gates also do not check `sequence` or `deliveryItems`, which Training needs, so a package that passes them may still be undeliverable.

To re-run the stub check (this does not edit `docker-compose.yml`):

```bash
docker compose stop validation-activation
MSYS_NO_PATHCONV=1 docker run -d --name eduagentx-stub-package-service \
  --network eduagentx_eduagentx-net --network-alias validation-activation \
  -v "$(pwd -W)/services/training-service/dev:/fixture:ro" -w /fixture \
  eduagentx-training-service:latest node /fixture/stub-package-service.js
```

Change the stub's package state (`Active`, `Quarantined`, `Candidate`, `Superseded`) or digest through its stub-only control route:

```bash
docker exec eduagentx-stub-package-service node -e "fetch('http://127.0.0.1:4010/__control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:'Quarantined'})}).then(r=>r.text()).then(console.log)"
```

Then send protocol messages to `POST /v1/agent-learner/interactions` with an agent token, for example:

```json
{
  "protocol": "ExternalAgentLearner", "protocolVersion": "1.0.0", "messageType": "lifecycle",
  "messageId": "m-1", "correlationId": "c-1", "idempotencyKey": "k-1", "timeoutMs": 5000,
  "evidence": { "mode": "synthetic" },
  "payload": { "interactionType": "training.session.start",
    "data": { "agentLearnerKey": "synthetic-agent-learner-dev", "response": "ack" } }
}
```

Continue adds `data.sessionId`; submit adds `data.sessionId`, `data.deliveryItemId` and the answer in `data.response`. Restore the real service afterwards:

```bash
docker rm -f eduagentx-stub-package-service
docker compose start validation-activation
```

Results of the check (real HTTP through the Gateway; the driver script was a one-off and is not in the repository):

| Check | Status | Output |
|---|---|---|
| Start while Candidate / Quarantined | 409 / 409 | `package_not_active` |
| Start on Active | 201 | pinned `demo-ai-safety 1.0.0`, digest `demo-digest-1` |
| Continue replayed with the same key | 200 | `outcome replay`, same item |
| Submit replayed with the same key and body | 200 | `outcome replay` |
| Same key, different answer | 409 | `idempotency_conflict` |
| Restart only training-service, then start | 200 | `resumed=true`, same session and digest |
| Continue after restart | 200 | same open item, `item_delivered` count 2 → 2 |
| Delivery order | 200 | `m1-lesson-1 → m2-lesson-1 → m2-lesson-2 → m3 → m4 → m5`, session `completed` |
| Superseded during a session: submit, continue | 200 / 200 | session continues |
| Digest changed mid-session | 409 | `training_blocked: package_digest_changed` |
| Superseded: new start | 409 | `package_not_active` |
| Quarantined / Candidate mid-session | 409 / 409 | `package_state:Quarantined` / `package_state:Candidate` |
| Learner re-registered with a new configuration | 409 | `configuration_changed` |
| Gateway admin list (admin / agent) | 200 / 403 | 5 sessions with status and block reason / `forbidden` |
| Completed session history | 200 | 14 events: 6 `item_delivered`, 6 `item_completed`, `synthetic/simulation` |
| Console page | 200 | 5 session rows with completed and blocked states |
| Prometheus target `training-service:4004/health` | — | `health=up`, `probe_success = 1` |

Side effects of that run: the five demo sessions remain in `training_service` (append-only, pinned to `demo-ai-safety`, labelled `synthetic/simulation`) and appear in the Console; the Registry gained configuration versions v5–v7 for `synthetic-agent-learner-dev`.

## Known limits and deviations

validation-activation (owned by #10/#14; not changed here):

- Packages are stored in memory, so a restart loses every package and the Active pointer.
- It has no authentication, publishes port 4010 on all interfaces (`0.0.0.0`), and `POST /packages` lets the caller set `state`.
- It has no Quarantine route yet (#14).
- Its digest is computed only at ingest, so a stored package edited without re-ingest keeps its digest and Training cannot detect the change. Training trusts this digest and does not compute its own.

Protocol and Gateway:

- The interaction types are `training.session.start`, `training.session.continue` and `training.session.submit`. `training.submit` was already a Sprint 1 placeholder that the conformance suite (`packages/external-agent-protocol/conformance.js`), the Synthetic Agent Learner, `scripts/security-integration.js` and the Sprint gate send and expect `202` from, so it still returns `202 awaiting_lifecycle_owner`. Those callers must migrate before `training.submit` can be retired.
- The protocol requires `data.response` on every lifecycle message. On start and continue it is only an acknowledgement string (for example `"ack"`), accepted and not forwarded. On submit it is the answer; Training stores only its SHA-256.
- The Gateway skips its in-memory idempotency cache for training replies, so every retry reaches Training and is re-checked against the package state.
- Idempotency keys are unique per session only (`UNIQUE (session_id, idempotency_key)`).
- Training's GET routes do not check roles; the Gateway enforces the admin role.
- The protocol contract (`docs/contracts/external-agent-learner-protocol.md`), `docs/contracts/api-overview.md`, the Gateway's `GET /v1/agent-learner/protocol` advertisement and the Gateway's `/health` do not yet mention Training.

Training:

- A pinned package that validation-activation no longer knows (404) returns `503 governing_package_unavailable` and writes no block, so a restart of the in-memory service does not permanently block running sessions.
- One open session per Agent Learner across all packages; there is no per-domain separation yet.
- No events are published to the Redis Stream and there is no outbox table. Progress lives only in `training_service.session_events`. An outbox can be added if #13 needs to consume events rather than query Training over HTTP.
- The `dev/` stub folder is copied into the training-service Docker image because `.dockerignore` does not exclude it. It is never started there.
- Node.js/Express is used instead of FastAPI, matching every other service in this repository.

Console and monitoring:

- The Console loads the session list plus the event history of the 20 most recent sessions, so a page load can make up to 21 Gateway calls. It shows only the latest module, item, mode and environment for each session.
- There is no Grafana panel for Training.
- curriculum-engine is not listed in `scripts/wait-for-healthy.sh` or `monitoring/prometheus.yml`; training-service is.

Verification scope:

- Only the `synthetic` evidence mode was exercised end to end. Concurrency was tested directly against the PostgreSQL store (8 parallel continues, one delivery), but only one client at a time went through the Gateway.
- No end-to-end check used a real Active package from validation-activation.

## Acceptance criteria review

**1. Training starts through the public Gateway only, for a registered fingerprint and an Active, eligible package. — Met against the stub; not met with a real package.**
Proof: `services/api-gateway/index.js` (`forwardTrainingInteraction`, actor from `req.auth.subject`) and `test/training.test.js` ("training.session interactions reach Training as the authenticated Agent Learner"; "unauthenticated, cross-identity and incomplete training interactions fail closed before Training"). training-service publishes no host port (`docker-compose.yml`), and its internal routes require the internal key (`services/training-service/test/app.test.js`, "internal routes require the internal key and an actor subject"). `decideStart` refuses an unregistered learner, a non-Active package, a missing digest or undeliverable modules (`test/session.test.js`, "start is refused without a registration, an Active package, a digest, or deliverable modules"). End-to-end checks "Start while Candidate / Quarantined" and "Start on Active".
Gaps: no real package can become Active, so "eligible" is only proven with the stub. The Registry lookup has no internal key because the Registry does not support one.

**2. Modules are delivered in manifest order; progress records package, module, objective, mode, environment and timestamps. — Met.**
Proof: `deliveryPlan` in `services/training-service/session.js`; `test/session.test.js` ("nextItem orders modules by sequence, then deliveryItems order, and links objectives"; "a full Training Session delivers every item once, in order, with complete progress evidence"); the `session_events` columns in `schema.sql`; end-to-end "Delivery order" and "Completed session history".
Gaps: "manifest order" is implemented as `module.sequence`, then `deliveryItems` order. curriculum-engine's `curriculumTrack.moduleIds` order is not used, so the two could disagree. When no objective lists an item, the module's `objectiveIds` are recorded.

**3. Interrupted sessions resume without duplicating completed interactions or changing the governing package. — Met.**
Proof: `decideContinue` re-sends the pending item; `decideSubmit` rejects an out-of-sequence item; the unique constraints and advisory lock in `store.js` and `schema.sql`. Tests: `test/session.test.js` ("resume after interruption keeps the governing package and never duplicates a completion"), `test/app.test.js` ("a retried request with the same idempotency key replays the stored response and appends nothing"; "a unique-constraint collision is re-read and decided once more"). End-to-end "Restart only training-service, then start" and "Continue after restart".
Gaps: only a training-service restart was exercised; the Gateway keeps no Training state, so it was not restarted. Idempotency is per session.

**4. Candidate or Quarantined packages cannot start or continue delivery. — Met against the stub.**
Proof: `blockReason` and `CONTINUE_STATES` in `session.js`; `test/session.test.js` ("a Candidate package cannot start or continue delivery", "a Quarantined package…", "a Superseded package keeps a running session going but cannot start a new one"); `test/app.test.js` ("a Quarantined package blocks continue once and the session reads back as blocked"); `services/api-gateway/test/training.test.js` ("a Quarantined-package block from Training comes back through the Gateway and is never cached"); end-to-end Candidate, Quarantined and Superseded checks.
Gaps: validation-activation has no Quarantine route, so a real Quarantine has never happened. A pinned package that disappears returns 503 rather than a block.

**5. The Assurance Console exposes read-only current and historical Training Session state. — Met.**
Proof: `services/assurance-console/index.js` (`/api/training-sessions`, `renderTrainingSessions`); `test/training-sessions.test.js` ("console shows current and historical Training Sessions read-only through the Gateway admin routes"; "console fails closed when the admin token or Training is unavailable"); the Gateway admin routes in `services/api-gateway/test/training.test.js`; end-to-end "Gateway admin list" and "Console page".
Gaps: only the 20 most recent sessions are expanded, only the latest mode and environment are shown, and the page was checked by its HTML, not visually.
