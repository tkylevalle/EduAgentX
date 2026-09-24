# Agent Registry v1 contract

The Agent Registry is the source of truth for an Agent Learner's identity and
configuration history. External callers use the API Gateway's versioned
routes; the registry's container is not published as a host port.

## Register or reconcile an Agent Learner

`POST /v1/registrations`

The caller supplies a stable, provider-neutral `agentLearnerKey` and the
configuration evidence needed to reproduce the learner. The registry owns the
authoritative UUID and computes `configurationFingerprint`; callers must not
send either `fingerprint` or `configurationFingerprint`.

```json
{
  "agentLearnerKey": "synthetic-agent-learner-dev",
  "model": {
    "provider": "synthetic",
    "version": "1.0.0"
  },
  "systemPromptHash": "sha256:system-prompt-v1",
  "approvedToolManifest": [
    {"name": "knowledge.lookup", "version": "1.0.0", "permissions": ["read"]}
  ],
  "policyConfigurationHash": "sha256:policy-v1",
  "adapterVersion": "1.0.0"
}
```

The two hash fields are opaque, non-empty digest identifiers. The registry
does not need the underlying prompt or policy to compute the configuration
fingerprint. The tool manifest is normalized as a set so its item order does
not change the fingerprint.

The canonical fingerprint input is:

```json
{
  "fingerprintVersion": "v1",
  "model": {"provider": "...", "version": "..."},
  "systemPromptHash": "...",
  "approvedToolManifest": [],
  "policyConfigurationHash": "...",
  "adapterVersion": "..."
}
```

The canonical request uses the nested `model` object shown above. For clients
that already expose flat model metadata, v1 also accepts `modelProvider` and
`modelVersion` and normalizes them to that same object; sending conflicting
nested and flat values is rejected.

The fingerprint is a SHA-256 digest prefixed with `sha256:`. It deliberately
does not include `agentLearnerKey`, so the same configuration can be compared
across learners without making the authoritative identities collide.

Successful responses include:

```json
{
  "apiVersion": "v1",
  "outcome": "registered",
  "status": "created",
  "registration": {
    "agentLearnerId": "uuid",
    "agentLearnerKey": "synthetic-agent-learner-dev",
    "configurationVersion": 1,
    "configurationFingerprint": "sha256:...",
    "status": "active"
  },
  "assurance": {
    "eventId": "uuid",
    "eventType": "agent_learner.registered",
    "correlationId": "request-correlation-id",
    "configurationVersion": 1
  },
  "correlationId": "request-correlation-id"
}
```

`outcome` is `registered` with HTTP 201 for a new identity, `unchanged` with
HTTP 200 for a repeated fingerprint, and `configuration_changed` with HTTP
200 when a new fingerprint is recorded for an existing identity. The latter
creates a new immutable configuration version and an assurance event that
contains the previous fingerprint.

Invalid input returns HTTP 400 with `error: "invalid_request"`, field-level
`details`, and the request `correlationId`. Validation happens before any
identity, configuration, or assurance event is written.

## Retrieve an authoritative identity

`GET /v1/registrations/:agentLearnerId` retrieves the current configuration and
the immutable configuration history for one authoritative UUID.

`GET /v1/registrations?agentLearnerKey=...` performs the same retrieval by the
stable caller-owned key. Both responses are versioned and include the
correlation evidence for the latest registration event.

## Assurance Console trace

`GET /v1/admin/registration-traces/latest` is an admin-only Gateway route. It
returns the latest authoritative registration outcome, configuration
fingerprint/version, assurance event, and correlation ID. The minimal
Assurance Console renders this trace as read-only evidence; it never writes to
the registry.
