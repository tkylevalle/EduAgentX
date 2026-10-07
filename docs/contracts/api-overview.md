# Sprint 1 public API contracts

The API Gateway is the public lifecycle boundary. Use `/v1` routes and a Bearer RS256 token from `POST /v1/auth/tokens` with `clientId` and `clientSecret`. Generate local credentials with `node scripts/setup-dev.js`; never commit `.env` or signing keys.

| Method | Path | Access and behavior |
|---|---|---|
| GET | `/health` | Dependency and authentication readiness; 503 on failure |
| POST | `/v1/auth/tokens` | Exchange configured local client credentials |
| GET | `/v1/agent-learner/protocol` | Agent/admin; protocol discovery |
| POST | `/v1/agent-learner/registrations` | Agent; versioned provider-neutral registration envelope |
| POST | `/v1/agent-learner/interactions` | Agent; `training.session.*` types reach Training (below); other lifecycle types get the simulation acknowledgement, no grading |
| POST | `/v1/registrations` | Agent; direct registration payload for its own identity |
| GET | `/v1/registrations?agentLearnerKey=...` | Agent's own identity, or admin |
| GET | `/v1/registrations/:agentLearnerId` | Agent's own identity, or admin |
| GET | `/v1/admin/whoami` | Admin identity |
| GET | `/v1/admin/registration-traces/latest` | Admin; latest authoritative registration trace |
| GET | `/v1/admin/event-delivery` | Admin; durable pending/applied/waiting/quarantined event counts |

Sprint 2 Training routes (training-service has no host port; the Gateway is its only public entry):

| Method | Path | Access and behavior |
|---|---|---|
| POST | `/v1/agent-learner/interactions` with `training.session.start`, `training.session.continue` or `training.session.submit` | Agent; acts as the token subject. Submit takes one bounded response per delivered item. |
| GET | `/v1/admin/training-sessions?agentLearnerKey=&status=` | Admin; session list with kind, status, progress counts and `objectiveProgress` |
| GET | `/v1/admin/training-sessions/:sessionId` | Admin; one session and its append-only event history |
| GET | `/v1/admin/training-metrics` | Admin; started, completed, remediated, resumed and aborted counts, completion rate, the session IDs behind each count, and relay progress (`completionEvents`) |
| GET | `/v1/admin/training-completion-events` | Admin; the completion outbox, one `training.session.completed` envelope per completed session. The relay also publishes each one, at least once, to the Redis Stream `training.session.completed` (fields `eventId`, `envelope`) |
| POST | `/v1/admin/training-remediations` | Admin; assigns targeted remediation for named objectives and keeps the causing evidence. An unknown field gets 400 `unexpected:<field>`. See [the Issue 13 handoff](../sprint-2/handoff-issue-13.md). |

Detailed payloads and responses are in [the Registry contract](agent-registry.md) and [the External Agent Learner Protocol](external-agent-learner-protocol.md). Requests above 64 KiB are rejected. The local single-gateway limit is 600 requests per source IP per minute on `/v1/`; 429 includes `Retry-After` and correlation. Health is excluded. A multi-instance deployment needs a shared rate counter.

Errors expose a stable `error` reason code and `correlationId`, with safe `message` and `details` where relevant. Every response includes `x-correlation-id`. Protocol correlation IDs must contain printable ASCII and fit within 256 characters. Version, identity, schema and header mismatches fail before mutation.

Registration envelope idempotency keys bind the authenticated identity and normalized complete message. PostgreSQL saves the original response atomically with the registration and event outbox, so exact retries survive gateway/Registry restart. Reusing a key with changed content returns 409. `assurance.publicationStatus: queued` records durable enqueueing, not completed delivery. Read `/v1/admin/event-delivery` for progress. Delivery is at least once; the consumer's durable inbox applies each event once and holds sequence gaps. Poison events retain a reason and stream ID, never their raw content.

The Assurance Console on local port 4173 is an unauthenticated local demonstration UI with server-side read-only admin access. It is bound to loopback and must not be reverse-proxied or exposed externally. Grafana and the synthetic test adapter are also local-only tools.

Curriculum, Training, Examination, Certification, Marketplace, Skill Gap and full Monitoring APIs belong to later sprints. No `/auth/login`, `/agents`, `/certify`, credential issuance, or marketplace endpoint is implemented by this Sprint 1 contract.
