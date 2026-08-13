# EduAgentX

EduAgentX is an autonomous competency-assurance platform in which software agents learn, demonstrate domain competence, and receive evidence of that competence. This glossary keeps the capstone team aligned on the lifecycle being designed.

## Language

**Agent Learner**:
The non-human software agent that registers with EduAgentX, consumes curriculum, and attempts an examination.
_Avoid_: Student, human learner, model trainee

**External Agent Learner Protocol**:
The provider-neutral, versioned contract through which any compatible agent framework or client participates in the complete EduAgentX lifecycle without bypassing platform controls.
_Avoid_: Hermes-only integration, provider-specific learner API

**Synthetic Agent Learner**:
A deterministic test implementation of the External Agent Learner Protocol whose inputs and expected lifecycle outcomes are known in advance.
_Avoid_: Live model, autonomous production agent

**Replay Agent Learner**:
A test implementation that returns a sanitized, versioned response previously captured from a live interaction and is always identified as replayed evidence.
_Avoid_: Live inference, synthetic ground truth

**Live Agent Learner**:
An external or local model-backed implementation that generates a fresh response during the current lifecycle run.
_Avoid_: Replay fixture, deterministic synthetic profile

**Curriculum Track**:
A versioned sequence of learning modules for one competency domain.
_Avoid_: Course when referring to the complete machine-consumable track

**Validated Curriculum**:
A curriculum track that has passed the agreed quality checks, has an explicit freshness state, and is approved as the reference track for demonstrating EduAgentX.
_Avoid_: Automatically trustworthy curriculum, production curriculum

**Domain Assurance Package**:
An immutable, versioned unit that pins the exact sources, objectives, modules, examination template, grading rubric, and deterministic fallback bank used to assure one competency domain. It activates atomically after validation and review.
_Avoid_: Course bundle, independently activated curriculum and exam

**Candidate Package**:
A Domain Assurance Package version awaiting the complete automated-validation and human-review gate. It cannot serve an Agent Learner lifecycle until activated.
_Avoid_: Draft active curriculum, partially approved package

**Quarantined Package**:
A previously active Domain Assurance Package made ineligible for related certification because a critical correction invalidated affected content. It remains immutable for historical evidence.
_Avoid_: Deleted curriculum, silently corrected active version

**AI Agent Safety and Secure Tool Use**:
The first reference competency domain, focused on an agent's observable ability to resist hostile instructions, constrain tool use, protect context and credentials, and stop or escalate safely. AI Safety Fundamentals supplies its conceptual foundation but is not the public-facing track name.
_Avoid_: AI Safety Fundamentals when naming the reference track

**Curriculum Refresh**:
The controlled creation and validation of a new Curriculum Track version when its knowledge sources or freshness policy indicate that an update is needed.
_Avoid_: Silently modifying an active curriculum

**Training Session**:
A sequence of curriculum and practice interactions delivered to an Agent Learner; it does not fine-tune or modify the learner's model weights.
_Avoid_: Model training, fine-tuning

**Examination**:
A controlled assessment of an Agent Learner against a versioned curriculum and predefined competency criteria.
_Avoid_: Quiz, benchmark

**System-Aborted Examination**:
An examination attempt ended by an EduAgentX or external-infrastructure failure before a valid grade exists. It issues no result and does not count as an Agent Learner failure.
_Avoid_: Failed examination, automatic fallback continuation

**Agent-Failed Examination**:
An examination attempt whose valid evidence shows an Agent Learner timeout, malformed response, insufficient score, or safety violation. It remains failure evidence and may trigger remediation.
_Avoid_: System error, discarded attempt

**Deterministic Fallback Examination**:
A pre-authored and prevalidated 15-item examination with source-linked, objectively gradable answers, used only when standard generation or grading is unavailable. Its fallback assessment mode is preserved in evidence.
_Avoid_: Outage-generated exam, unlabelled backup grading

**Certification Decision**:
The pass-or-fail determination produced from immutable examination evidence under a versioned grading policy.
_Avoid_: Certificate when referring to the decision itself

**Competency Credential**:
Cryptographically verifiable, project-issued evidence that EduAgentX made a Certification Decision for an Agent Learner in a named domain and curriculum version. Verification establishes EduAgentX authorship, integrity, and current status; it does not establish external accreditation or universal acceptance of the claim.
_Avoid_: Externally accredited certification, regulatory certificate, hash-only certificate

**Capability Request**:
A versioned, structured description of simulated work and the verified competencies an Agent Learner must hold to be considered for it.
_Avoid_: Job posting, employment contract, free-text prompt

**Marketplace Eligibility**:
The current, revocable state in which a discoverable Agent Learner's configuration and valid credentials satisfy the non-ranking requirements of a Capability Request.
_Avoid_: Second certification, permanent marketplace approval

**Marketplace Ready**:
A presentation label meaning an Agent Learner is currently eligible to be considered for at least one open Capability Request. It is not a certification level or guarantee of selection.
_Avoid_: Universally qualified, deployable agent

**Match Policy**:
A versioned, deterministic rule that filters eligible Agent Learners and orders them for a Capability Request using declared evidence fields and explicit tie-breakers.
_Avoid_: Opaque recommendation model, subjective recruiter judgment

**Marketplace Match**:
A non-binding, point-in-time recommendation that explains how a currently eligible Agent Learner satisfied a Capability Request under a named Match Policy.
_Avoid_: Job placement, authorization to deploy, new Certification Decision

**Near Match**:
A clearly ineligible but potentially remediable Agent Learner whose valid credential evidence falls short of one or more request-specific requirements. It exposes capability gaps without weakening Marketplace Eligibility.
_Avoid_: Partial match, eligible candidate, automatically relaxed match

**Capstone-Grade Reference Implementation**:
A coherent, tested implementation that demonstrates the depth and future potential of EduAgentX without claiming production or regulatory readiness.
_Avoid_: Disposable proof of concept, production certification authority

**Zero-Human-Loop Agent Lifecycle**:
The live path from Agent Learner registration through curriculum delivery, examination, Certification Decision, and credential issuance without case-by-case human intervention. Humans may govern sources, templates, rubrics, policies, and validation before they enter that lifecycle.
_Avoid_: No human governance, unreviewed autonomous certification

**Assurance Console**:
The authorized human client for observing lifecycle evidence, performing bounded governance commands, and running isolated capstone demonstrations. It is not an Agent Learner interface or a source of domain truth.
_Avoid_: Student dashboard, direct database admin, autonomous-agent control plane

**Assurance Posture**:
The current trust state of curriculum, examinations, Certification Decisions, credentials, quarantines, and governance exceptions, considered separately from whether services are technically healthy.
_Avoid_: System uptime, aggregate health score

**Demonstration Lab**:
An isolated test-only surface that launches seeded Agent Learner workflows and controlled failure scenarios through real public contracts while preserving their evidence mode and test environment.
_Avoid_: Manual result editor, production fault console

**Monitoring View**:
A read-only projection of correlated domain evidence that cannot mutate its projection or any authoritative domain record. It may link to a separate authenticated governance or demonstration command workflow.
_Avoid_: Editable dashboard, source of domain truth

**Operational Health**:
The availability and performance state of EduAgentX services and dependencies, reported independently from Assurance Posture.
_Avoid_: Certification validity, overall trust score

**Attention Record**:
A deduplicated, actionable presentation of an assurance or operational condition with its scope, severity, Safe State, owner, evidence freshness, and required next action.
_Avoid_: Raw alert flood, context-free notification

**Evidence Bundle**:
An immutable, sanitized export that binds a build and environment to the versioned datasets, policies, KPI results, incidents, demonstration runs, costs, limitations, and content digests used to evaluate EduAgentX.
_Avoid_: Screenshot collection, raw log archive, accreditation report

**Sprint Gate**:
The cumulative evidence boundary a delivery phase must pass through integrated behavior, automated tests, applicable Acceptance Floors, and a reproducible demonstration. Elapsed calendar time does not close it.
_Avoid_: Timebox deadline, feature checklist, conditional pass

**Sprint Evidence Pack**:
A lightweight, versioned record tying one Sprint Gate to its build, contracts, tests, measurements, demonstration, limitations, runbook, and documented review outcome.
_Avoid_: Status presentation, screenshot folder, final Evidence Bundle

**Capability Primary**:
The member accountable for coordinating a work package to its Sprint Gate; the role does not grant exclusive control over its tasks or code.
_Avoid_: Sole implementer, permanent specialist, code owner

**Capability Backup**:
An active second member who can review, run, explain, recover, and assume coordination of a work package. Other team members may still contribute freely.
_Avoid_: Passive name on a spreadsheet, assistant-only role

## Success Evidence

**Safe State**:
The declared condition reached after a failure in which every applicable EduAgentX Invariant remains preserved, even if the affected capability is blocked, quarantined, degraded, or indeterminate.
_Avoid_: Generic error state, assumed recovery

**Controlled Degradation**:
An explicitly labelled operating mode that uses only previously validated fallback behavior and preserves the evidence of how the result was produced.
_Avoid_: Silent fallback, best-effort certification

**Assurance Incident**:
An append-only record proving that a mandatory failure was detected, contained in a Safe State, and either recovered or remained blocked.
_Avoid_: Disposable log message, hidden exception

**Invariant**:
A correctness, safety, or trust rule that EduAgentX must never relax to satisfy a schedule or demonstration.
_Avoid_: Aspirational KPI, waivable target

**Acceptance Floor**:
The minimum measured evidence required to call a capability complete while preserving the Invariants.
_Avoid_: Stretch goal, ideal result

**Target**:
A desired measured result above the Acceptance Floor that may be recalibrated through the approved evidence process.
_Avoid_: Hard guarantee, hidden pass condition
