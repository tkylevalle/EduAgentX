# Define the mandatory failure and recovery scenario matrix

Type: grilling
Status: resolved
Blocked by: 01, 03, 04, 05

## Question

Which technical, AI-quality, security, cost, integration, and team-availability risks must the reference implementation prevent, detect, recover from, and visibly demonstrate, and what is the expected safe state for each scenario?

## Comments

- Foundation confirmed: three evidence tiers; a common scenario contract; fail-closed trust decisions; prevalidated and labelled Controlled Degradation; deterministic automatic recovery with human governance; append-only Assurance Incidents; and team unavailability handled as project continuity without weakening gates.
- Mandatory scenario families confirmed: technical reliability, AI quality, security and credential integrity, cost and external-provider control, provider-neutral Agent Learner integration, and team continuity. Each family has one visible hero demonstration; additional invariant-relevant cases require automated evidence.
- Containment and recovery confirmed: Critical/Major/Supporting severity with minimum safe blast radius; three-attempt shared retry budget for transient faults only; immutable examination-attempt configuration with separate System-Aborted and Agent-Failed outcomes; signing-key suspension/rotation/revocation behavior; invariant-based recovery closure; deterministic fault injection; and no residual acceptance for unresolved Invariant risks.

## Answer

EduAgentX maintains one mandatory failure-and-recovery matrix spanning technical reliability, AI quality, security and credential integrity, cost and provider control, Agent Learner integration, and team continuity. A scenario is complete only when the system prevents or contains the forbidden outcome, enters its declared **Safe State**, produces durable evidence, and proves the required recovery behavior.

### Evidence tiers

1. **Visible Demonstration** - six short hero scenarios, one per risk family, executed through deterministic fault injection or a seeded Agent Learner.
2. **Automated Evidence** - repeatable tests for every other mandatory case and for every case capable of breaching an Invariant.
3. **Documented Residual Risk** - only supporting or explicitly out-of-scope risks that cannot be reproduced responsibly. Each records an owner, rationale, mitigation, review date, and visible limitation.

An unresolved risk capable of breaching an Invariant is Red and blocks the relevant sprint exit. It cannot be moved into residual risk or waived by a team vote.

### Common scenario contract

Every implemented matrix row records:

- scenario ID, category, affected lifecycle stage, and severity;
- trigger and deterministic fault-injection method where applicable;
- preventive controls and detection signal;
- explicitly forbidden outcome;
- expected Safe State and containment blast radius;
- automatic recovery, human-governance action, and retry behavior;
- recovery target or trust-restoration condition;
- generated Assurance Incident and test or demonstration evidence; and
- capability owner and backup. Named members are assigned later by the team-coverage plan.

Every runtime failure produces an append-only **Assurance Incident** containing a correlation ID, severity, affected agent/package/attempt/credential IDs, cause code, detection time, Safe State, retry/fallback actions, recovery result, and timestamps. It excludes secrets, raw examination answers, private prompts, and signing material.

### Severity and containment

| Severity | Meaning | Required containment |
|---|---|---|
| Critical | Actual or credible Invariant breach | Quarantine the smallest demonstrably safe scope. Block the affected trust decision; block domain-wide or global credential issuance when narrower isolation cannot be proven. |
| Major | Critical-path availability failure without evidence corruption | Block the affected operation while unaffected capabilities continue. Preserve authoritative evidence for deterministic recovery. |
| Supporting | Marketplace, dashboard, or project-continuity failure | Permit explicitly labelled Controlled Degradation without weakening a critical-path gate. |

Containment always uses the smallest blast radius that can be proven safe. Uncertain curriculum validity, examination integrity, grading completeness, credential issuance, or credential status resolves to `BLOCKED`, `QUARANTINED`, or `INDETERMINATE`, never an assumed pass or valid state.

### Technical reliability matrix

| ID | Mandatory scenario | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| T1 | Duplicate or out-of-order lifecycle event | Idempotency keys, unique constraints, aggregate sequence/version checks; detect duplicate or invalid transition | Original outcome preserved; no duplicate examination, credential, or match | Acknowledge an exact duplicate or defer/reject an invalid order; prove single authoritative objects and incident/metric evidence. Automated. |
| T2 | Certification Service stops after valid examination completion but before issuance | Durable stream, transactional state transition, deterministic credential ID; detect unfinished consumed event | Examination evidence remains valid; zero partial or duplicate credentials | Restart and replay to exactly one credential within the operational recovery floor. **Visible technical hero plus automated test.** |
| T3 | Redis Streams consumer stops | Consumer groups, durable pending entries, health/lag monitoring | Events remain queued; no lifecycle state is fabricated or lost | Restart consumer, claim pending work, drain backlog, and reconcile counts. Automated. |
| T4 | Poison event repeatedly fails | Schema validation, bounded delivery attempts, per-event isolation; detect three failed deliveries | Poison event quarantined; its trust decision blocked; unrelated events continue | Investigate or correct through governed replay; prove dead-letter/quarantine evidence and unaffected throughput. Automated. |
| T5 | ChromaDB or an external curriculum source is unavailable | Active-package cache, package hash/version pinning, freshness monitoring | Last validated package remains active and labelled; no candidate silently activates | Restore dependency and revalidate freshness. Critical correction signals still quarantine affected content rather than relying on cache. Automated. |
| T6 | PostgreSQL is unavailable | Health checks and authoritative-write boundary | New authoritative writes are blocked; no service accepts partial lifecycle state | Reconnect, replay durable work, reconcile authoritative records and duplicates. Automated. |

### AI-quality matrix

| ID | Mandatory scenario | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| A1 | Candidate content lacks schema validity, provenance, objective coverage, rubric conformity, exam-policy conformity, or fallback readiness | Six mandatory activation validators | Candidate remains inactive; active package is unchanged | Correct and version a new candidate, rerun all gates, then obtain two-person review. Automated. |
| A2 | Untrusted source text attempts to influence generation policy or validation | Treat sources as data, isolate system policy, validate generated artifacts against pinned manifest | Generated artifact rejected; no policy or active package changes | Regenerate from sanitized/bounded content and revalidate. Preserve injection detection evidence. Automated. |
| A3 | Generated examination violates pinned objective or cognitive-tier coverage | Deterministic template validator before attempt activation | No invalid attempt is delivered or graded | Reject and regenerate within a bounded budget; if still invalid, block examination. Automated. |
| A4 | Grader is unavailable or returns malformed/incomplete output | Structured schema, completeness checks, critical-rule enforcement | No score, pass, Certification Decision, or credential is produced | Mark standard attempt System-Aborted where infrastructure caused the failure; start a separately identified prevalidated fallback attempt when permitted. Automated. |
| A5 | Grading validation falls below its Acceptance Floor or produces a mandatory-safety false pass | Versioned labelled dataset and release gate | Grading-policy release blocked; last validated grader remains selected | Diagnose, recalibrate or correct under change control and rerun the entire validation dataset. Automated. |
| A6 | Agent Learner obeys hostile instructions or performs unsafe tool use | Restricted sandbox, adversarial items, explicit critical-violation rules | Agent-Failed Examination; no credential; evidence preserved | Deliver targeted remediation and require a new examination. **Visible AI-quality hero plus automated test.** |

### Security and credential-integrity matrix

| ID | Mandatory scenario | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| S1 | Invalid authentication or agent-identity mismatch | Gateway authentication, authorization, identity/fingerprint binding | Request rejected before lifecycle mutation; no partial agent or attempt | Correct credentials/identity and submit a new request; audit denial. Automated. |
| S2 | Agent input attempts to alter system instructions, examination questions, or grading rubric | Role separation, immutable package references, input isolation and output validation | Input is treated only as learner content; controlling artifacts remain unchanged | Reject/flag malicious content and continue only under unchanged policy. Automated. |
| S3 | Agent requests an unauthorized sandbox tool action | Capability allowlist, authorization checks, side-effect simulation | Tool action denied; no real side effect; applicable critical violation recorded | Preserve evidence, fail the attempt where policy requires, and route to remediation. Automated. |
| S4 | Credential payload is modified after issuance | Ed25519 signature verification and canonical credential validation | Tampered credential reports invalid; original credential and status remain independently verifiable | No repair of tampered evidence; obtain the authentic credential from the issuer. **Visible security hero plus automated test.** |
| S5 | Credential-status evidence is unavailable or unverifiable | Separately signed status list, cached response bounded by status policy | Verifier returns `INDETERMINATE_STATUS`, never `VALID` | Restore and verify signed status evidence before reporting a current valid state. Automated. |
| S6 | Signing-key compromise is suspected or confirmed | Key separation, key IDs, issuance monitoring and test-key rotation procedure | Issuance stops immediately; credentials in the uncertainty window are suspended | Rotate key; if compromise is confirmed, mark historical key compromised, revoke affected credentials, reverify original evidence, and reissue where justified. Automated with test keys. |

### Cost and external-provider matrix

| ID | Mandatory scenario | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| C1 | Live run starts without bounded calls, tokens, runtime, and optional spend | Configuration validation at live-run admission | Live run cannot start | Supply valid ceilings; record configured and consumed budget. Automated. |
| C2 | Live run exhausts a configured ceiling | Per-run metering and hard cancellation | Run ends without fabricated response, grade, or pass | Start a separately labelled replay demonstration or new bounded live run. **Visible cost hero plus automated test.** |
| C3 | Automatic retries threaten runaway cost | One logical-operation retry budget shared across services | At most three total transient attempts; no retry for validation, authorization, malformed-schema, or safety failures | Block or select a prevalidated alternative after budget exhaustion; report retries and cost. Automated. |
| C4 | Provider rate limit, timeout, or outage | Timeouts, circuit state, replay fixtures, prevalidated fallback examination | Affected live/standard run is blocked or System-Aborted; no silent mode switch | After bounded retries, start a distinct run labelled replay or fallback. Automated. |
| C5 | Paid provider is unavailable for formal evaluation or presentation | Synthetic harness, versioned replays, cached packages | Complete formal KPI suite and repeatable demo remain operable with zero paid calls | Report paid usage separately; validate offline path before presentation. Automated. |

### Agent Learner integration matrix

| ID | Mandatory scenario | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| I1 | Unsupported protocol version or malformed registration | Version negotiation and schema validation before persistence | Request rejected; no partial Agent Learner exists | Client corrects request/version and registers anew. Automated. |
| I2 | External Agent Learner times out or returns malformed/schema-invalid examination output | Attempt deadlines and response validation | Learner-caused case becomes Agent-Failed Examination; no pass or credential | Preserve failure evidence and allow remediation/new attempt according to policy. Automated. |
| I3 | Material model, system-prompt, tool-manifest, policy, or adapter fingerprint changes | Credential subject binds the registered configuration fingerprint | Existing credential does not certify the changed configuration; matching is blocked for it | Register new fingerprint and require re-examination. **Visible integration hero plus automated test.** |
| I4 | Optional Hermes adapter fails | Provider-neutral External Agent Learner Protocol and adapter isolation | Hermes path unavailable; core lifecycle and other compatible clients remain usable | Use synthetic, replay, or another adapter without bypassing gateway/policy. Automated. |
| I5 | Client repeats a request with the same idempotency key | Request-result ledger and unique constraints | Original result is returned; no duplicate lifecycle objects | Reconcile the client with the original correlation ID. Automated. |

### Team-continuity matrix

| ID | Mandatory scenario/control | Prevention and detection | Safe State | Recovery and evidence |
|---|---|---|---|---|
| P1 | Critical capability lacks available ownership | Primary and backup assigned to every capability | Capability work does not proceed without accountable coverage | Reassign through the team plan; record ownership history. |
| P2 | Backup cannot reproduce setup, tests, evidence, or recovery | Short maintained handoff/runbook per capability | Sprint exit remains blocked rather than relying on undocumented knowledge | Update runbook and repeat handoff until backup succeeds. |
| P3 | Member becomes unavailable | Availability check and task-state visibility | Freeze non-essential scope; preserve completed evidence and critical-path gates | Backup assumes work or supporting scope is reduced; do not lower Invariants or Acceptance Floors. |
| P4 | Reassignment removes independent review | Reviewer-role separation for curriculum, grading, and credential changes | Affected change waits; no self-approval | Assign a different available reviewer before approval. |
| P5 | Schedule pressure motivates lowering a gate | KPI change-control and sprint-exit policy | Invariant/Acceptance Floor remains unchanged; affected exit is Red if unmet | Reduce supporting scope, improve capability, or formally reopen the blueprint decision. |
| P6 | Pre-demonstration continuity drill | Backup follows another member's documented setup and hero scenario | Failure to complete blocks readiness sign-off, not product correctness | Repair documentation/permissions and repeat successfully. **Visible continuity hero with a brief presentation result.** |

Actual member pairings remain deliberately deferred to **Balance seven-member workload and continuity coverage**; this ticket fixes the required coverage and evidence, not personal assignments.

### Attempt atomicity and fallback behavior

At examination start, the Agent Learner fingerprint, Domain Assurance Package, examination template, grading rubric, and assessment mode are locked for that attempt. A mode never changes mid-attempt.

- An infrastructure-caused interruption becomes a **System-Aborted Examination**: no grade, no credential, and no consumption of the learner's allowed attempt.
- A learner-caused timeout, malformed response, insufficient score, or safety violation becomes an **Agent-Failed Examination** and remains valid failure evidence.
- Any deterministic fallback requires a new attempt ID and explicitly records `assessmentMode = fallback`.
- Cached curriculum, fallback examination, replay evidence, and stale-labelled read-only monitoring are permitted only when previously validated. Marketplace degradation may not block an already valid Certification Decision.

### Retry and recovery policy

- A transient logical operation receives at most three total automatic attempts using backoff, even when it crosses services.
- Validation failures, authorization denials, critical safety violations, and malformed schemas receive no automatic retry.
- A stream event still failing after three deliveries is quarantined while unrelated events continue.
- Automatic recovery is limited to deterministic actions: bounded retries, idempotent replay, backlog recovery, and selection of already-approved alternatives.
- Humans govern policy changes, source/content correction, key rotation, and release from quarantine. A human may not override an individual Agent Learner from fail to pass.

The controlled operational recovery target is at most 60 seconds and the Acceptance Floor is at most 120 seconds for service restarts, stream-consumer outages, provider timeouts, and comparable injected availability faults. Security, credential, curriculum, or grading quarantines have no clock-forced release; they remain blocked until trust is re-established.

An Assurance Incident closes as recovered only after the fault is removed, applicable Invariants are rechecked, durable backlogs are drained, duplicate-object checks pass, expected Safe State and final state are recorded, and any quarantined trust decision receives required governance approval. Service health by itself is insufficient.

### Visible demonstration set

1. Restart Certification after examination completion and prove exactly-one credential issuance.
2. Show adversarial unsafe-tool failure, targeted remediation, and successful re-examination.
3. Tamper with a credential and show rejection while the original verifies.
4. Exhaust a small live-run budget and switch to a distinct labelled replay run.
5. Change an Agent Learner fingerprint and show that its prior credential no longer applies.
6. Have a backup member execute another member's documented scenario successfully.

All product hero failures use controlled test switches or seeded scenarios, isolated test agents and test issuer keys, safe reset behavior, and retained Assurance Incident evidence. No demonstration depends on a genuine outage or exposes real external side effects.
