# Sprint 1 public API contracts

The API Gateway is the public lifecycle boundary. Use `/v1` routes and a Bearer RS256 token from `POST /v1/auth/tokens` with `clientId` and `clientSecret`. Generate local credentials with `node scripts/setup-dev.js`; never commit `.env` or signing keys.

| Method | Path | Access and behavior |
|---|---|---|
| GET | `/health` | Dependency and authentication readiness; 503 on failure |
| POST | `/v1/auth/tokens` | Exchange configured local client credentials |
| GET | `/v1/agent-learner/protocol` | Agent/admin; protocol discovery |
| POST | `/v1/agent-learner/registrations` | Agent; versioned provider-neutral registration envelope |
| POST | `/v1/agent-learner/interactions` | Agent; simulation acknowledgement only, no training or grading |
| POST | `/v1/registrations` | Agent; direct registration payload for its own identity |
| GET | `/v1/registrations?agentLearnerKey=...` | Agent's own identity, or admin |
| GET | `/v1/registrations/:agentLearnerId` | Agent's own identity, or admin |
| GET | `/v1/admin/whoami` | Admin identity |
| GET | `/v1/admin/registration-traces/latest` | Admin; latest authoritative registration trace |
| GET | `/v1/admin/event-delivery` | Admin; durable pending/applied/waiting/quarantined event counts |

Detailed payloads and responses are in [the Registry contract](agent-registry.md) and [the External Agent Learner Protocol](external-agent-learner-protocol.md). Requests above 64 KiB are rejected. The local single-gateway limit is 600 requests per source IP per minute on `/v1/`; 429 includes `Retry-After` and correlation. Health is excluded. A multi-instance deployment needs a shared rate counter.

Errors expose a stable `error` reason code and `correlationId`, with safe `message` and `details` where relevant. Every response includes `x-correlation-id`. Protocol correlation IDs must contain printable ASCII and fit within 256 characters. Version, identity, schema and header mismatches fail before mutation.

Registration envelope idempotency keys bind the authenticated identity and normalized complete message. PostgreSQL saves the original response atomically with the registration and event outbox, so exact retries survive gateway/Registry restart. Reusing a key with changed content returns 409. `assurance.publicationStatus: queued` records durable enqueueing, not completed delivery. Read `/v1/admin/event-delivery` for progress. Delivery is at least once; the consumer's durable inbox applies each event once and holds sequence gaps. Poison events retain a reason and stream ID, never their raw content.

The Assurance Console on local port 4173 is an unauthenticated local demonstration UI with server-side read-only admin access. It is bound to loopback and must not be reverse-proxied or exposed externally. Grafana and the synthetic test adapter are also local-only tools.

Curriculum, Training, Examination, Certification, Marketplace, Skill Gap and full Monitoring APIs belong to later sprints. No `/auth/login`, `/agents`, `/certify`, credential issuance, or marketplace endpoint is implemented by this Sprint 1 contract.
