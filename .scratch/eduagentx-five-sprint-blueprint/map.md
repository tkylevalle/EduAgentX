# EduAgentX Five-Sprint Blueprint

Label: `wayfinder:map`

## Destination

A decision-complete, capstone-grade blueprint for implementing and demonstrating EduAgentX across five flexible, gate-based sprints. The blueprint must define scope, architecture, success evidence, quality controls, risk behavior, and balanced team coverage clearly enough to hand off to specification and implementation-ticket creation.

## Notes

- This Wayfinder effort is planning only. Application code and GitHub implementation issues are out of scope until the map is clear and handed to `to-spec` and `to-tickets`.
- EduAgentX is a **Capstone-Grade Reference Implementation**, positioned as **Zero-Human-Loop Execution, Human-Governed Assurance**.
- The critical path is Agent Registration -> Curriculum Delivery -> Examination -> Certification.
- The canonical system contains eight domain services: Agent Registry, Curriculum Engine, Training Service, Examination Engine, Certification Engine, Marketplace Service, Skill Gap Service, and Monitoring Service.
- API Gateway/Auth is shared infrastructure; the dashboard is a client; adaptive difficulty belongs to Training; re-certification belongs to Certification.
- Training means prompt/module delivery and practice interaction, not fine-tuning or modification of model weights.
- AI Agent Safety and Secure Tool Use is the first fully validated curriculum. It applies AI Safety Fundamentals to observable agent behavior such as resisting prompt injection, enforcing authorization boundaries, protecting credentials and context, handling untrusted tool output, and stopping or escalating safely. Additional domains follow only after its method and quality gates are established.
- The five sprints are delivery phases with exit gates. Two weeks is an estimate, not a fixed commitment.
- Team allocations must begin evenly, use primary and backup coverage, and remain reassignable for availability or compliance needs.
- Budget is not hard-locked. Prefer a zero-paid-API repeatable path and track optional live usage toward an indicative 100-300 AED range.
- Curriculum quality targets: full factual source traceability, at least 90% learning-objective coverage, zero critical factual errors, reviewer mean at least 4/5, and structural/duplication validation.
- Curriculum freshness is configurable with a proposed 30-day default. A candidate version becomes active only after validation; the last validated version remains cached.
- Examination policy: 15 questions across recall (20%), applied reasoning (40%), and adversarial reasoning (40%); overall score at least 80%, adversarial score at least 70%, and no critical safety violation.
- Grading validation targets: at least 90% pass/fail agreement on at least 100 labelled responses, mean score error at most five points, zero false passes on mandatory safety items, and repeat variance at most five points.
- A deterministic, versioned fallback exam is used when LLM grading is unavailable; the assessment mode is preserved in credential evidence.
- Curriculum patch changes do not require re-certification; minor/major changes do, with a proposed 30-day grace period; critical safety corrections suspend affected credentials immediately.
- Credentials are immutable evidence. Later state is represented through append-only lifecycle events.
- Redis Streams with consumer groups replaces Redis Pub/Sub for durable lifecycle processing. PostgreSQL is authoritative.
- One PostgreSQL container may be shared for affordability, but services own schemas/tables and may not directly write another service's data.
- KPI values begin as evidence-based targets and may be calibrated deliberately; safety and credential-integrity invariants are not relaxed merely to make a demonstration pass.
- Required supporting skills: `grilling` and `domain-modeling`; use `research` for primary-source investigations and `prototype` where a concrete template is needed for human review.

## Decisions so far

<!-- Resolutions will be indexed here as decision tickets close. -->

- [Calibrate mandatory gates and adjustable KPI targets](issues/01-calibrate-kpi-gates.md) — Separate non-waivable trust Invariants from measurable Acceptance Floors and adjustable Targets, with evidence-based change control and independent gates for every critical-path capability.
- [Establish the authoritative AI Agent Safety and Secure Tool Use source and freshness baseline](issues/02-research-ai-safety-sources.md) — Ground five focused modules in a five-document NIST/OECD/OWASP core, exact provenance, 30-day checks, classified change signals, and validation-before-activation.
- [Select a verifiable competency-credential evidence model](issues/04-research-credential-evidence.md) — Use a project-scoped W3C VC 2.0 credential signed with Ed25519 JWS, signed suspension/revocation status evidence, and structured verification rather than a bare SHA-256 authenticity claim.
- [Decide the synthetic and live Agent Learner demonstration boundary](issues/03-decide-demo-agent-boundary.md) — Use deterministic synthetic runs for formal KPIs, versioned replays for offline reproducibility, and optional budget-limited live agents through one provider-neutral protocol, with Hermes as the first non-required reference adapter.

- [Define the canonical curriculum and examination template contract](issues/05-prototype-curriculum-exam-contract.md) — Activate one immutable, manifest-pinned Domain Assurance Package only after six automated gates and two-person review, with prevalidated deterministic fallback and critical-correction quarantine.

- [Define the mandatory failure and recovery scenario matrix](issues/06-define-risk-scenarios.md) — Require fail-closed Safe States, six visible hero failures, automated Invariant-risk evidence, bounded deterministic recovery, durable Assurance Incidents, and continuity coverage without weakening gates.

- [Define the capstone-sized marketplace matching slice](issues/07-define-marketplace-slice.md) — Match only lifecycle-issued, currently valid credentials to structured simulated requests using strict eligibility, deterministic explained rankings, honest Near Matches, and versioned contracts that preserve a future upgrade path.

- [Define monitoring and dashboard evidence](issues/08-define-observability-evidence.md) — Use read-only Monitoring Views, separate audited governance/demo commands, decisions-first lifecycle evidence, distinct trust/health/KPI states, correlated Attention Records, and exportable Evidence Bundles.

- [Define the five sprint exit gates and deliverables](issues/09-define-sprint-exit-gates.md) — Preserve the instructor's five headings while requiring cumulative integrated increments, measurable phase-specific gates, reproducible Sprint Evidence Packs, nine end-to-end demonstrations, and a second-machine final release check.

- [Balance seven-member workload and continuity coverage](issues/10-balance-team-coverage.md) — Use a neutral named rotation with one accountable but non-exclusive Primary and active Backup per member per sprint, advisory contribution points, independent trust review, lightweight integration stewardship, and explicit reassignment/handoff rules.

## Not yet specified

- None. The five-sprint planning route is decision-complete and ready for specification and implementation-ticket handoff.

## Out of scope

- Writing application code during Wayfinder planning.
- Creating the exact implementation backlog, estimates, GitHub issues, username mapping, and final assignments before this blueprint is handed to the ticketing stage.
- Fine-tuning or modifying Agent Learner model weights.
- Claiming regulatory accreditation or production certification-authority status.
- Payments, real hiring decisions, production agent deployment, blockchain, multi-region infrastructure, and broad curriculum expansion.
- Additional curriculum domains and their domain-specific validation until AI Agent Safety and Secure Tool Use succeeds.
- Fixed calendar dates and execution-time availability adjustments; the five phases are gate-based and the team rebalances during implementation.
- Production-oriented deployment, external credential authorities, or real marketplace integrations unless a later effort deliberately expands the reference implementation.
