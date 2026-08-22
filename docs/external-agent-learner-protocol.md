# External Agent Learner Protocol v1

Issue 5 establishes the provider-neutral public contract used by synthetic,
replay, live, and future framework adapters. The API Gateway is the only
public lifecycle boundary. An adapter never calls the Agent Registry or any
other service directly and never writes a platform database.

## Discovery and authentication

Authenticated clients can retrieve the contract from:

```text
GET /v1/agent-learner/protocol
```

The response names `ExternalAgentLearner` version `1.0.0`, lists the
registration and lifecycle routes, declares required envelope fields and
timeouts, and explicitly reports that model/provider identifiers have no
allowlist. Clients authenticate with the existing Gateway JWT contract. An
Agent Learner token may only register or interact as its own authenticated
`agentLearnerKey`.

## Message envelope

Both message types use the same envelope:

```json
{
  "protocol": "ExternalAgentLearner",
  "protocolVersion": "1.0.0",
  "messageType": "registration",
  "messageId": "registration-message-1",
  "correlationId": "registration-correlation-1",
  "idempotencyKey": "registration-idempotency-1",
  "timeoutMs": 2500,
  "evidence": {
    "mode": "synthetic",
    "environment": "simulation",
    "label": "SIMULATION: Synthetic Agent Learner"
  },
  "payload": {}
}
```

`timeoutMs` is required and bounded to 1-60,000 ms. The optional
`x-correlation-id` header must equal the envelope `correlationId`; the Gateway
returns the same value in the response header and body. The idempotency key is
bound to the authenticated subject and message content. Reusing it with the
same message returns the original result; reusing it with different content
returns `409 idempotency_conflict`.

## Registration

Adapters submit the envelope to:

```text
POST /v1/agent-learner/registrations
```

The Gateway validates the envelope, evidence label, identity, and registration
payload before forwarding only `payload` to `POST /v1/registrations`. The
Agent Registry remains responsible for the authoritative identity and
configuration fingerprint. A caller cannot supply a fingerprint.

Registration payloads contain the canonical nested model metadata plus the
system-prompt hash, approved tool manifest, policy/configuration hash, and
adapter version. The model `provider` value is opaque; `synthetic`, a future
framework name, and a live provider are all handled by the same schema.

## Lifecycle interaction

Adapters submit lifecycle messages to:

```text
POST /v1/agent-learner/interactions
```

The v1 payload shape is:

```json
{
  "interactionType": "training.submit",
  "data": {
    "agentLearnerKey": "synthetic-agent-learner-dev",
    "response": "adapter response"
  }
}
```

`response` is required so a lifecycle owner can validate the adapter output;
missing responses are rejected before dispatch. `interactionType` is a namespaced action so later curriculum, training,
examination, certification, and status owners can attach without changing the
adapter envelope. In Sprint 1 the Gateway returns `202 accepted` with
`safeState: awaiting_lifecycle_owner`; it does not fabricate a grade,
Certification Decision, or credential. Later owning services can consume the
same message contract.

## Evidence modes

Evidence mode is part of every response and is never inferred from a provider
name:

| Mode | Environment | Required label |
| --- | --- | --- |
| `synthetic` | `simulation` | `SIMULATION: Synthetic Agent Learner` |
| `replay` | `simulation` | `SIMULATION: Replay Agent Learner` |
| `live` | `live` | `LIVE: Live Agent Learner` |
| `fallback` | `simulation` | `SIMULATION: Deterministic Fallback` |

The Gateway rejects a synthetic message labelled as live or with a conflicting
custom label. This makes simulation visible even when a client declares a
provider name that resembles a live framework.

## Synthetic adapter

The Compose service `synthetic-agent-learner` exposes a local demonstration
control surface:

```text
GET  /v1/profiles
POST /v1/runs
```

The adapter obtains a JWT, then uses only the Gateway protocol routes. Its
deterministic profiles are `competent`, `adversarial`, `remediable`,
`underqualified`, `malformed`, `inconsistent`, `timing-out`, and `unavailable`.

Required safe outcomes are:

| Profile | Outcome | Reason | Credential |
| --- | --- | --- | --- |
| `malformed` | `agent_failed` | `malformed_response` | never issued |
| `inconsistent` | `agent_failed` | `inconsistent_response` | never issued |
| `timing-out` | `agent_failed` | `agent_timeout` | never issued |
| `unavailable` | `system_aborted` | `learner_unavailable` | never issued |

All synthetic responses carry the simulation label. The adapter has no
credential issuer and reports `credentialIssued: false`; a later Examination
or Certification service must make those decisions from complete immutable
evidence rather than trusting the adapter. A competent synthetic profile is
reported as `accepted` with `safeState: awaiting_lifecycle_owner`; it is not
reported as a platform completion before the owning lifecycle service exists.

The shared protocol package includes a conformance suite that checks valid
registration and lifecycle messages plus unsupported-version and invalid-timeout
failures. Replay and future live adapters can run the same suite against their
Gateway client without changing the contract.
