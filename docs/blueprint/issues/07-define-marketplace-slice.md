# Define the capstone-sized marketplace matching slice

Type: grilling
Status: resolved
Blocked by: 01

## Question

What deterministic matching inputs, ranking behavior, explanation evidence, latency target, and exclusions are sufficient to demonstrate the matcher without allowing it to compete with the four-stage critical path?

## Comments

- Purpose and boundary confirmed: Marketplace produces non-binding recommendations for versioned simulated Capability Requests after certification; it never hires, deploys, pays, contacts, authorizes, or changes Certification Decisions.
- Eligibility confirmed: discoverability, matching agent fingerprint, every required currently verifiable credential, validity window, and accepted evidence environment/mode are hard gates. Test credentials remain confined to a labelled simulation marketplace.
- Operation confirmed: eligibility follows credential/fingerprint lifecycle events; ranking is requested on demand and rechecks current status. The first slice uses seeded requests within AI Agent Safety and Secure Tool Use and excludes broad marketplace features.
- Extensibility confirmed: contracts and service boundaries should permit later domains and marketplace capabilities if the project succeeds, but payments, bidding, messaging, contracts, reviews, reputation, real employers, deployment, semantic matching, and external job integrations are not five-sprint deliverables.
- Matching semantics confirmed: objective coverage means the credential's pinned package assessed the objective, not that an unrecorded objective-level score exists. Self-declared skills cannot satisfy verified requirements or influence the first ranking policy.
- `MATCH-POLICY-1.0.0` applies hard eligibility filters before ranking, then scores total examination performance (35), adversarial performance (35), preferred-objective coverage (20), and credential recency (10). It returns at most five candidates; ties resolve by newer credential and then stable Agent Learner ID.
- Scoring mechanics confirmed: components use normalized total/adversarial scores, proportional preferred-objective coverage, and linear recency within the request's maximum age; the sum is rounded once to two decimals and labelled Match Score rather than certification confidence.
- Evidence and freshness confirmed: immutable results record request/policy versions, score breakdown, satisfied requirements, credential/fingerprint/status checks, evidence mode, exclusions, time, and idempotency key without private assessment content. The event-fed index is only a projection; authoritative status and fingerprint are rechecked before response, and uncertain status excludes the candidate.
- Acceptance confirmed: 100% hard-gate, repeat-order, tie-break, and explanation conformance across at least 100 golden cases; zero invalid-status/fingerprint inclusions; p95 at most 30 seconds targeting 10 seconds with 1,000 synthetic agents and 100 requests.
- Upgrade seam confirmed: evolve versioned Capability Request, Match Policy, and Match Result contracts and domain-independent credential references; do not build a generic plugin/rules framework during the capstone.
- No-match nuance confirmed: results may separately show Near Matches with exact request-specific gaps, but invalid-status, tampered, indeterminate, or fingerprint-mismatched agents appear in neither lane and no threshold is silently relaxed.
- Candidate provenance confirmed: every displayed candidate must be a real registered Agent Learner with a credential issued through the complete EduAgentX lifecycle. The reliable demo pool uses about 12 pre-run synthetic/replay learners; at least one learner completes the lifecycle and appears during the demonstration, while live-framework participation remains optional.
- Near-match and demonstration behavior confirmed: return at most three same-domain Near Matches ordered by fewest gaps, normalized shortfall, ordinary Match Score, and stable tie-breakers; label them Not Eligible and emit only a structured gap handoff. Sprint 5 must prove lifecycle entry, deterministic explanation, status/fingerprint removal, near matches, unsupported-domain refusal, and Marketplace independence from certification.

## Answer

EduAgentX Marketplace is a thin, post-certification supporting service. It uses verified credential evidence to produce deterministic, explainable, non-binding recommendations for simulated **Capability Requests**. It does not hire, deploy, pay, contact, authorize, or grant tools to an Agent Learner, and it cannot issue, alter, override, suspend, or revoke a Certification Decision or Competency Credential.

Marketplace failure may degrade matching but cannot invalidate a completed Certification Decision. **Marketplace Ready** means only that an Agent Learner is currently eligible for at least one open Capability Request; it is not a second certification level.

### First-slice scope

The capstone supports seeded, fictional Capability Requests within the validated **AI Agent Safety and Secure Tool Use** domain. Representative requests emphasize secure tool authorization, prompt-injection resistance, protected-context handling, and safe refusal/escalation. An administrator may create another structured request through the same API or a small form.

The following remain outside the five-sprint slice: payments, bidding, messaging, contracts, reviews, reputation scores, real employers, autonomous deployment, free-text semantic matching, external job boards, and production integrations. Future versions may add them through versioned contracts and new service capabilities if the reference implementation succeeds.

### Capability Request contract

Every immutable request version records:

- request ID and version;
- title and bounded description;
- required competency domain;
- required objective IDs or capability tags;
- minimum total and adversarial examination scores;
- maximum credential age;
- accepted assessment modes and evidence environment;
- optional preferred objective IDs;
- creation, opening, closing, and supersession timestamps; and
- schema version.

Score thresholds must be within 0-100, maximum credential age must be positive, accepted modes/environments cannot be empty, and only identifiers from a validated domain contract may be used. For the first slice, objective coverage means that the credential's pinned Domain Assurance Package assessed the objective. It does not imply an objective-level score that the credential does not contain. Self-declared skills may be displayed separately in an agent profile but cannot satisfy a verified requirement or influence `MATCH-POLICY-1.0.0`.

### Candidate and evidence boundary

Marketplace candidates cannot be inserted directly. Every candidate must originate from a registered Agent Learner that completed the standard EduAgentX lifecycle and received an EduAgentX-issued credential.

To appear in either result lane, an agent must pass the non-negotiable trust gates:

- it is explicitly discoverable;
- its credential signature, schema, validity basis, and issuer policy verify;
- credential status is currently verifiable and is not suspended, revoked, or superseded;
- its current registered configuration fingerprint matches the credential subject; and
- its evidence belongs to the appropriate marketplace environment. Simulation/test credentials remain confined to a visibly labelled simulation marketplace.

Tampered, expired-as-a-credential, suspended, revoked, superseded, indeterminate, fingerprint-mismatched, cross-environment, or non-discoverable agents appear in neither Eligible Matches nor Near Matches.

Marketplace consumes credential-issued, suspended, revoked, superseded, and fingerprint-changed events to maintain a fast eligibility projection. That projection is never authoritative: current credential status and fingerprint are rechecked before returning results. If either cannot be established, the candidate is excluded with a reason such as `STATUS_INDETERMINATE`.

### Eligible Matches

After passing the trust gates, an Agent Learner is eligible for a request only when:

1. the credential covers the required supported domain and every required objective;
2. total and adversarial scores meet the request thresholds;
3. credential age is within the request maximum; and
4. assessment mode is accepted by the request.

These are hard eligibility conditions. An ineligible candidate can never outrank an eligible one.

For each eligible candidate, versioned `MATCH-POLICY-1.0.0` calculates a 0-100 **Match Score**:

- `35 × totalScore / 100`;
- `35 × adversarialScore / 100`;
- `20 × coveredPreferredObjectives / requestedPreferredObjectives`, or 20 for every eligible candidate when no preferences are supplied; and
- `10 × max(0, 1 - credentialAge / maximumCredentialAge)`.

The sum is rounded once to two decimal places. It is a request-specific ranking value, not a new competency score, certification confidence, or probability of successful deployment. Provider, model vendor, agent framework, popularity, self-declared capability, and human ratings contribute zero weight.

Return at most five Eligible Matches and the total eligible count, ordered by Match Score descending. Exact ties resolve by newer credential issuance time and then stable Agent Learner ID ascending.

### Near Matches

A **Near Match** passes every non-negotiable trust gate and holds a valid credential in the requested supported domain, but fails at least one request-specific eligibility condition: objective coverage, score threshold, credential-age requirement, or accepted assessment mode.

Near Matches are always displayed in a separate **Not Eligible** section and never count toward the eligible total or Marketplace Ready state. Return at most three, ordered by:

1. fewest failed request-specific requirements;
2. smallest combined normalized shortfall;
3. higher ordinary Match Score; and
4. the standard credential-recency and stable-ID tie-breakers.

Each missing objective counts as one failed requirement; total-score threshold, adversarial threshold, maximum age, and mode acceptance each count separately. Normalized shortfall is the mean of applicable values: missing-objective fraction; `max(0, requiredTotal - actualTotal) / requiredTotal`; `max(0, requiredAdversarial - actualAdversarial) / requiredAdversarial`; credential-age excess divided by maximum age and capped at 1; and 1 for an unaccepted mode. Arithmetic and reason codes are preserved in the result.

An unsupported domain returns `UNSUPPORTED_DOMAIN` with neither eligible nor near matches. Marketplace never compares unrelated credentials or automatically lowers a requirement. A Near Match may emit a structured capability-gap record for the Skill Gap Service, but Marketplace does not enroll, remediate, re-examine, or contact the Agent Learner.

### Match Result and explanations

Every immutable Match Result records:

- result ID, request ID/version, and `MATCH-POLICY-1.0.0`;
- generation timestamp, correlation ID, and idempotency key;
- eligible and near-match candidate IDs, ranks, and credential IDs;
- satisfied requirements and exact gap reason codes;
- all score components, normalized shortfalls, final values, and tie-break reason;
- credential status, agent fingerprint, assessment mode, environment, and check time;
- aggregate exclusion counts by reason; and
- a point-in-time, non-binding recommendation notice.

It excludes raw examination answers, private prompts, system instructions, grader rationale, signing material, and secrets. A repeated request with the same idempotency key returns the original immutable result rather than creating duplicate matches.

A stored result remains historical evidence and is never silently rewritten after a status change. When reopened, the client displays any current-status divergence and offers a fresh match operation. A result is not authorization for a later action; any future action-capable integration would have to reverify eligibility under its own policy.

### Success evidence

Because the first matcher is deterministic, quality is measured as contract conformance rather than subjective AI accuracy:

| Measure | Required result |
|---|---:|
| Hard-gate inclusion/exclusion over golden cases | 100% correct |
| Invalid-status, indeterminate, cross-environment, or fingerprint-mismatched inclusion | 0 |
| Repeated ranking and tie-break order | 100% identical |
| Displayed explanation versus calculated evidence | 100% agreement |
| Golden conformance dataset | At least 100 cases |
| Performance dataset | 1,000 synthetic Agent Learners and 100 Capability Requests |
| Matching p95 latency Acceptance Floor | At most 30 seconds |
| Matching p95 latency Initial Target | At most 10 seconds |

Every required but unmeasured condition is Red. Duplicate events cannot create duplicate results, and suspended, revoked, superseded, indeterminate, or fingerprint-mismatched credentials cannot participate in either result lane.

### Demonstration and real Agent Learners

The understandable presentation pool contains approximately 12 deterministic synthetic or replay Agent Learners and four seeded Capability Requests. These are not manually inserted marketplace rows: every learner registers and proceeds through curriculum, examination, certification, and credential issuance using the real application APIs before matching.

During the Sprint 5 demonstration, at least one Agent Learner completes the lifecycle and appears in a refreshed marketplace result. A successful live Hermes or other provider-backed learner enters through exactly the same provider-neutral APIs and may appear in the pool, but live availability is not required for Marketplace acceptance. The 1,000-agent dataset is a separate automated load and conformance suite.

The visible gate proves:

1. a newly credentialed discoverable Agent Learner enters a refreshed result;
2. eligible candidates receive reproducible ranks and score explanations;
3. suspension or a material fingerprint change removes a candidate;
4. a strict request with no eligible result returns honestly labelled Near Matches and exact gaps;
5. an unsupported domain returns no fabricated capability; and
6. Marketplace unavailability leaves existing credentials and Certification Decisions unchanged.

### Upgrade path and ownership

Extensibility comes from versioned Capability Request, Match Policy, and Match Result contracts plus domain-independent credential references. New domains and policy versions can be added without changing what historical results meant. The capstone does not build a generic plugin framework or rules engine in anticipation of uncertain future requirements.

Marketplace owns Capability Requests, matching projections, and immutable Match Results. It references Agent Registry and Certification evidence through APIs/events and never writes their data directly. Later services may consume structured match or capability-gap events without broadening this five-sprint slice.
