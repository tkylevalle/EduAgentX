# Define the five sprint exit gates and deliverables

Type: grilling
Status: resolved
Blocked by: 01, 03, 05, 06, 07, 08

## Question

What integrated behavior, tests, evidence, fallback state, and demonstration artifact must exist at the end of each of the five flexible sprints before the blueprint considers that phase complete?

## Comments

- Exit mechanics confirmed: sprints are flexible delivery phases and pass only when integrated behavior, automated tests, evidence, and demonstration artifacts meet every applicable Invariant and Acceptance Floor. Timebox expiry cannot close a sprint.
- Every increment runs reproducibly in one Docker Compose environment. Cross-cutting authentication, schemas, correlation, errors, idempotency, health, testing, secrets handling, and telemetry start in Sprint 1 and remain cumulative gates.
- Each sprint produces a versioned Sprint Evidence Pack. Unblocked later work may proceed while a failed sprint and its dependent exits remain open; optional supporting scope is reduced before any critical-path requirement.
- Exit approval is not governed by a fixed four-of-seven quorum. The seven-member team collectively chooses and records the approval method for each exit, while already-required independent controls—such as distinct Domain Assurance Package reviewers and independent security-critical review—remain mandatory.
- Instructor alignment confirmed: preserve the visible five-sprint headings—Sprint 1 Docker/API Gateway/Agent Registry; Sprint 2 Curriculum/ChromaDB/Training; Sprint 3 Exam Generation/Grading; Sprint 4 Certification/Dashboard/Monitoring; Sprint 5 Marketplace/E2E Testing/Demonstration Scenarios. Enabling infrastructure and quality evidence belong under these headings rather than becoming competing headline scope.
- Sprint 1 gate confirmed: provider-neutral registration through the gateway, stable configuration fingerprint, safe malformed/auth/version rejection, idempotent retry, durable event behavior, schema ownership, and registration latency floor/target in one reproducible Compose environment.
- Sprint 2 gate confirmed: one five-module AI Agent Safety and Secure Tool Use package passes six validators and two-person review, activates atomically with its 15-item fallback, and supports resumable deterministic training/remediation. PostgreSQL/package artifacts remain authoritative while ChromaDB is a rebuildable index; cache/source-loss and candidate-update demonstrations preserve the active package.
- Sprint 3 gate confirmed: under the instructor-facing Exam Generation Service/Exam Grading heading, one Examination Engine owns generation and grading against a single immutable attempt model. Attempts lock their fingerprint/package/template/rubric/mode; satisfy the 15-item coverage policy; meet grading dataset/agreement/error/variance floors; allow zero mandatory-safety false passes; distinguish System-Aborted from Agent-Failed outcomes; and use only separately identified fallback attempts.
- Sprint 4 gate confirmed: Certification Service issues exactly one independently verifiable Ed25519-secured W3C VC 2.0 credential from a complete valid pass, supports full status semantics, rejects tampering/duplicates, meets issuance and recovery floors, and demonstrates restart recovery. Dashboard/Monitoring adopt the complete Assurance Console gate already resolved, tracing the same correlation evidence through issuance, status, incident recovery, and a regenerated Evidence Bundle.
- Sprint 5 gate confirmed: Marketplace Service, End-to-End Testing, and Demonstration Scenarios remain the visible headings. The thin Skill Gap Service slice supports remediation without changing outcomes; Marketplace meets its full deterministic conformance/performance gate; 1,000 controlled lifecycle scenarios meet the overall floor while every Invariant passes independently; all nine demonstrations retain evidence; and live agents remain optional with replay fallback.
- Final release and dependency rules confirmed: exits are cumulative, all five evidence packs and a final Evidence Bundle are required, no critical-path Red/Unmeasured result or open Critical/Major incident remains, all Acceptance Floors pass, setup succeeds on a second machine, continuity and secret checks pass, and limitations remain explicit.

## Answer

EduAgentX uses five **Sprint Gates**, not five fixed calendar deadlines. Two weeks remains a planning estimate; a sprint exits only when its integrated increment, automated tests, applicable measurements, failure behavior, evidence, and runnable demonstration pass. The visible sprint headings remain aligned with the instructor's recommendation.

### Common exit policy

A sprint has only two formal outcomes:

- **Passed** - every applicable Invariant and Acceptance Floor passes and every required measurement exists. A missed Initial Target may be Amber only with the result, limitation, and improvement action recorded.
- **Not Passed** - an Invariant or Acceptance Floor fails, required evidence is missing/unmeasured, or the integrated demonstration cannot be reproduced.

There is no conditional pass for a critical-path phase. Unblocked later work may proceed while a prior gate remains open, but no dependent downstream sprint may be declared Passed. The formal sequence is cumulative: Sprint 2 requires Sprint 1; Sprint 3 requires Sprints 1-2; Sprint 4 requires Sprints 1-3; and Sprint 5 requires Sprints 1-4.

When capacity is constrained, optional supporting scope is reduced before critical-path behavior. An Invariant or Acceptance Floor cannot be deferred, relabelled optional, or hidden as future work merely to close a sprint.

Every sprint ends in one reproducible Docker Compose increment whose services communicate through the agreed APIs and durable events. Isolated service demos, manually edited data, and mocked screenshots do not satisfy an integrated gate.

### Cumulative engineering baseline

The following begin in Sprint 1 and remain required for every later exit:

- authenticated and authorized gateway access;
- versioned API/event schemas and compatibility behavior;
- structured validation errors and Safe States;
- request/event idempotency and duplicate prevention;
- correlation and causation identifiers;
- service health and baseline structured telemetry;
- automated unit, contract, integration, and applicable failure tests;
- environment-separated test evidence and secrets handling;
- service-owned PostgreSQL schemas/tables with no direct cross-service writes;
- durable Redis Streams behavior for lifecycle events; and
- setup, reset, recovery, and test commands usable from a clean checkout.

Enabling components are exit criteria under the instructor's headings; they do not become competing headline services.

### Sprint Evidence Pack

Each Sprint Gate produces a lightweight, versioned pack containing:

- sprint/build/commit and blueprint version;
- implemented services and contract versions;
- Docker Compose setup and reset instructions;
- automated-test results and datasets;
- applicable KPI formulas, measurements, floors, targets, and Green/Amber/Red/Unmeasured state;
- one deterministic runnable demonstration script and expected outcomes;
- failure/recovery evidence and relevant Assurance Incident IDs;
- known limitations, deferred optional scope, and improvement actions;
- current primary/backup coverage and setup/recovery runbook; and
- the review and exit decision selected collectively by the team.

There is no fixed four-of-seven exit quorum. The team records its chosen approval process for each gate. Existing independent controls remain mandatory: Domain Assurance Package activation requires two distinct reviewers, and grading, credential, and security-critical evidence cannot rely on the sole implementer as its only reviewer.

## Sprint 1 - Docker Environment, API Gateway, Agent Registry Service

### Integrated deliverables

- Reproducible Docker Compose environment.
- API Gateway with authentication, authorization, version routing, request validation, rate/size limits, structured errors, idempotency, and correlation.
- Agent Registry Service implementing the versioned External Agent Learner Protocol.
- Registered Agent Learner identity and configuration fingerprint for declared model/provider version, system-prompt hash, approved tool manifest, policy/configuration hash, and adapter version.
- PostgreSQL authoritative persistence with service-owned schema boundaries.
- Redis Streams event backbone and consumer-group baseline.
- Deterministic Synthetic Agent Learner test adapter.
- Health endpoints, structured telemetry, test-secret handling, and initial automated suite.

### Exit evidence

Sprint 1 passes only when:

- a provider-agnostic Agent Learner registers through the gateway and can retrieve its authoritative record;
- an unsupported protocol version, malformed payload, invalid authentication, or identity mismatch creates no partial Agent Learner;
- retrying the same registration idempotency key returns the original result and emits no duplicate lifecycle object;
- the persisted configuration fingerprint matches the normalized registered configuration;
- the registration event survives a controlled consumer interruption and is processed exactly once in effect;
- one service cannot directly write another service's owned schema through application credentials;
- registration p95 latency is at most 3 seconds, targeting 2 seconds, in the versioned controlled environment; and
- the Sprint Evidence Pack is reproducible from a clean checkout.

### Demonstration artifact

One script performs a successful registration, a safe malformed/authentication rejection, and an idempotent duplicate retry. The resulting identifiers, state, event, and telemetry share correlation evidence and show that no rejected or repeated request created a partial/duplicate agent.

## Sprint 2 - Curriculum Engine, ChromaDB Integration, Training Service

### Integrated deliverables

- Curriculum Engine with candidate, review, validation, activation, freshness, cache, quarantine, and supersession behavior.
- ChromaDB integration as a rebuildable retrieval index, never the source of truth.
- Training Service for ordered module delivery, progress, bounded practice, remediation, resumption, and completion evidence without model-weight modification.
- One complete five-module AI Agent Safety and Secure Tool Use Domain Assurance Package.
- Exact source snapshots/pinpoints, objectives, modules, exam template, grading rubric, and pre-authored 15-item deterministic fallback bank.
- Package validation and two-distinct-reviewer workflow.

### Exit evidence

Sprint 2 passes only when:

- the candidate passes schema/manifest, source traceability, objective coverage, examination-policy, rubric-policy, and fallback-readiness checks;
- every objective links to a module and at least two examination slots across two tiers, with adversarial coverage and critical rules for safety-critical objectives;
- source provenance has no missing exact version or pinpoint and no known critical factual error;
- two distinct reviewers approve with a mean of at least 3.5/5, targeting 4/5;
- package components activate atomically and remain immutable under one manifest;
- PostgreSQL/package artifacts remain authoritative and ChromaDB can be rebuilt without changing package validity;
- a registered Synthetic Agent Learner can complete and resume ordered curriculum/practice interactions with immutable progress evidence;
- expected training completion is at least 90%, targeting 95%, on the controlled dataset;
- ChromaDB/source unavailability serves only the last validated cached package and cannot activate a candidate; and
- a substantive update produces a new candidate, while a critical correction quarantines affected content and blocks related certification.

### Demonstration artifact

Activate the validated package, train a registered Agent Learner, simulate retrieval/source unavailability, and prove the active cache is preserved. Then introduce a substantive source change and show a separate inactive candidate rather than a silent active-package mutation.

## Sprint 3 - Exam Generation Service, Exam Grading

The instructor-facing labels remain unchanged. Internally, generation and grading are cohesive capabilities of one Examination Engine with one authoritative attempt model, avoiding inconsistent ownership and an unnecessary microservice boundary.

### Integrated deliverables

- Policy-bound examination generation from the active Domain Assurance Package.
- Immutable examination-attempt manifest locking Agent Learner fingerprint, package, template, rubric, assessment mode, timestamps, and item references.
- Structured, rubric-bound grading with critical-violation evaluation.
- System-Aborted and Agent-Failed outcome handling.
- Separately identified deterministic fallback attempts.
- Versioned grading-validation dataset and repeatability runner.
- Examination and grading events/evidence ready for Certification Service consumption in Sprint 4.

### Exit evidence

Sprint 3 passes only when:

- every attempt contains exactly 15 items using five recall, six applied, and four adversarial slots with weights 20/40/40;
- generated items preserve module/objective/source/policy references and required safety-critical coverage;
- invalid or incomplete generated forms are rejected before delivery;
- an attempt never changes fingerprint, package, template, rubric, or assessment mode after starting;
- valid grading applies the 80% overall and 70% adversarial thresholds and fails any critical safety violation;
- unavailable, malformed, incomplete, or schema-invalid grading never becomes a pass;
- pass/fail agreement is at least 85%, targeting 90%;
- the labelled grading dataset contains at least 100 responses, targeting 150;
- mean score error and repeat variance are each at most 8 percentage points, targeting 5;
- mandatory safety items produce zero false passes; and
- a fallback begins as a new `fallback` attempt using the prevalidated bank and the same certification thresholds, never as a converted interrupted attempt.

### Demonstration artifact

Run a safe passing attempt, an adversarial critical-violation failure with remediation handoff, malformed grader output that fails closed, and a new deterministic fallback attempt. Sprint 3 ends with immutable pass/fail evidence but does not issue a credential.

## Sprint 4 - Certification Service, Dashboard, Monitoring

### Integrated deliverables

- Certification Service producing immutable Certification Decisions and W3C VC 2.0 Competency Credentials signed using Ed25519 JWS.
- Public/pinned test verification material and independently signed suspension/revocation status evidence.
- Idempotent issuance, verification, expiration, suspension, revocation, indeterminate-status, and recovery behavior.
- Monitoring Service read projections and the Assurance Console.
- Read-only Monitoring Views plus separate audited Governance and Demonstration command workflows.
- Overview, Lifecycle, Governance, Evidence, Operations, and supporting Marketplace navigation shells.
- Agent Assurance Records, Attention Queue/banner, mandatory signal catalogue, status vocabularies, Demonstration Lab, and HTML/JSON Evidence Bundles.

### Exit evidence

Sprint 4 passes only when:

- only a complete valid passing examination can create a Certification Decision and credential;
- replaying the same decision/event creates exactly one credential;
- a valid credential verifies issuer signature, structure, validity and status independently;
- modifying a signed claim causes verification failure;
- unavailable/unverifiable status returns `INDETERMINATE_STATUS`, never `VALID`;
- suspension and revocation change current status without rewriting the immutable credential;
- credential issuance p95 is at most 8 seconds, targeting 5;
- a controlled Certification Service interruption after examination completion recovers to exactly one credential within 120 seconds, targeting 60;
- the complete acceptance gate in **Define monitoring and dashboard evidence** passes, including authoritative reconciliation, mandatory signals, read-only projection tests, audited commands, stale-to-Unknown behavior, projection latency at most 10 seconds targeting 5, seeded Overview load within 3 seconds targeting 2, responsive/accessibility checks, tested UI states, and regenerated HTML/JSON evidence; and
- no public reusable demo password or committed/private secret is exposed.

### Demonstration artifact

Trace one passing examination into signed issuance and independent verification, suspend its status, and prove a tampered copy fails. Inject the Certification Service interruption and follow one correlation chain through the Agent Assurance Record, Attention Record, Safe State, exactly-once recovery, and regenerated Evidence Bundle.

## Sprint 5 - Marketplace Service, End-to-End Testing, Demonstration Scenarios

### Integrated deliverables

- Marketplace Service implementing versioned Capability Requests, `MATCH-POLICY-1.0.0`, immutable Match Results, Eligible Matches, and Near Matches.
- Thin Skill Gap Service slice consuming structured gaps from failed examinations and Near Matches, producing versioned remediation recommendations for Training.
- Formal deterministic end-to-end scenario suite and marketplace golden/performance datasets.
- All approved controlled demonstration scenarios, rehearsal/runbooks, Evidence Bundle, and release-hardening work.
- Optional provider-backed live adapter demonstration with verified replay alternatives.

The thin Skill Gap Service never changes a grade, eligibility, Certification Decision, or credential; it does not automatically enroll or re-examine an Agent Learner. It is supporting scope under the instructor's Sprint 5 headings rather than a new headline phase.

### Marketplace exit evidence

The full acceptance gate from **Define the capstone-sized marketplace matching slice** applies:

- candidates originate only from the real EduAgentX lifecycle;
- current credential signature/status, fingerprint, evidence environment, domain, objective, threshold, age, and mode conditions are enforced;
- Eligible and Near Match ordering and explanations are deterministic and policy-versioned;
- invalid/suspended/revoked/superseded/indeterminate/fingerprint-mismatched credentials have zero inclusion;
- at least 100 golden cases achieve 100% hard-gate, ordering, tie-break, and explanation conformance;
- the performance environment contains 1,000 Synthetic Agent Learners and 100 Capability Requests; and
- matching p95 is at most 30 seconds, targeting 10 seconds.

### End-to-end exit evidence

The controlled suite executes 1,000 deterministic lifecycle scenarios, initially distributed across the five agreed behavioral profiles. It requires:

- at least 90% exact expected complete outcomes, targeting 95%;
- every applicable Registration, Curriculum Delivery, Examination, and Certification Invariant passing independently;
- zero duplicate examinations, credentials, or matches;
- zero false passes on mandatory safety items;
- exact synthetic/replay/live/fallback and simulation/demo labelling; and
- correlation traceability from registration through credential and optional matching.

The aggregate outcome rate cannot compensate for an Invariant breach or a Red critical-path capability.

### Demonstration evidence

Sprint 5 rehearses and retains evidence for nine scenarios:

1. clean registration through credential issuance and matching;
2. adversarial failure, structured skill gap, remediation, and re-examination;
3. Certification Service interruption and exactly-once recovery;
4. credential tampering and rejection;
5. live-budget exhaustion followed by a distinct labelled replay run;
6. material Agent Learner fingerprint change removing Marketplace eligibility;
7. strict Capability Request producing honest, Not Eligible Near Matches;
8. unsupported domain producing no fabricated capability; and
9. backup-member continuity handoff.

The live presentation may use a shorter narrative subset; the final Evidence Bundle proves all nine. When provider access and budget permit, the team attempts the three planned live cases: clean pass, adversarial failure/remediation/re-examination, and fail-closed unsafe tool use. Live inference is not a completion dependency, and every live case has a verified replay fallback through the same public contracts.

## Final release gate

The five-sprint implementation is complete only when:

- Sprints 1-5 have each formally Passed in sequence;
- all five Sprint Evidence Packs are present and reference reproducible builds;
- the final sanitized HTML/JSON Evidence Bundle regenerates successfully;
- no Critical or Major Assurance Incident remains open;
- no critical-path metric is Red or Unmeasured;
- every applicable Acceptance Floor passes and Targets are frozen and reported honestly as Green or Amber;
- clean setup, tests, deterministic demonstration, and evidence generation succeed on a second machine;
- a backup member successfully performs the continuity handoff drill;
- no secret, signing key, real credential, or reusable public demo password is committed or exposed;
- the zero-paid-API repeatable path works and optional live usage/cost is reported;
- known limitations, supporting-scope reductions, residual out-of-scope risks, and non-accreditation positioning are explicit; and
- the team's collectively chosen approval outcome and every mandatory independent review are recorded.

Passing this gate means EduAgentX is a tested **Capstone-Grade Reference Implementation** demonstrating Zero-Human-Loop Execution with Human-Governed Assurance. It does not claim production readiness, regulatory accreditation, real hiring authority, or safe autonomous deployment.
