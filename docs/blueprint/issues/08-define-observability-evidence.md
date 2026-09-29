# Define monitoring and dashboard evidence

Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

Which operational, learning-quality, examination, credential, freshness, cost, and recovery signals must be measured and presented so evaluators can verify EduAgentX's behavior without turning the dashboard into a second product?

## Comments

- Audience and authority confirmed: the dashboard is an Assurance Console for the team, evaluators, and authorized governance operators; Agent Learners use APIs. Domain services remain authoritative and Monitoring owns read projections only.
- Evidence lenses confirmed: Assurance Posture, Operational Health, and Evaluation Evidence remain visibly distinct so uptime or aggregate KPIs cannot imply trust validity.
- Interaction boundary confirmed with expansion: the console is evidence-first and cannot directly edit domain state, scores, rubrics, or pass/fail outcomes. It may submit authenticated, confirmed, append-only governance commands to owning services, and it should provide more demonstrable interaction through a separate isolated Demonstration Lab.
- Structure and interaction confirmed: six primary areas (Overview, Lifecycle, Governance, Evidence, Operations, Marketplace); decisions-first home hierarchy; one Agent Assurance Record timeline; an isolated real-API Demonstration Lab; and safe search, provenance, validation, verification, matching, bounded-retry, KPI-comparison, and sanitized-export interactions.
- Documentation constraint confirmed in principle: preserve a defensible read-only claim by treating monitoring projections and evidence views as read-only, while identifying Governance and Demonstration commands as separate, explicit, audited interactions rather than dashboard data edits.
- Read-only wording confirmed: Monitoring Views are read-only projections; Governance and Demonstration actions are separate authenticated command workflows hosted in the same Assurance Console.
- Evidence contract confirmed: correlate requests, events, metrics, traces, incidents, and lifecycle records with relevant IDs, timestamps, service, environment, and evidence mode after redacting sensitive content.
- Mandatory signals confirmed across registration, curriculum, training, examination, certification, grading quality, marketplace, operations, providers, and cost.
- Status and attention semantics confirmed: Operational Health, Assurance Posture, and KPI Evidence use independent vocabularies; each deduplicated Attention Record carries severity, scope, time, evidence freshness, reason, Safe State, owner, next action, and evidence link.
- Freshness and access confirmed: projection latency is at most 10 seconds targeting 5, operational evidence becomes stale/Unknown after 15 seconds without refresh, KPI runs remain immutable snapshots, and Viewer/Evaluator, Governance Operator, and Demo Operator permissions are composable while two-person review requires distinct identities.
- Export, retention, and UI quality confirmed: immutable sanitized HTML/JSON Evidence Bundles; size-capped seven-day raw telemetry, 30-day aggregated metrics, and project-lifetime assurance/evaluation evidence; responsive, keyboard-accessible states and seeded Overview load at most three seconds targeting two.
- Alert delivery confirmed: the capstone requires an in-app Attention Queue and persistent Critical banner. External paging and messaging integrations remain future extensions and cannot be relied upon for a Safe State.

## Answer

EduAgentX provides an **Assurance Console** for the seven-member team, capstone evaluators, and authorized governance operators. Agent Learners use the provider-neutral APIs rather than a human dashboard. The console exists to make autonomous execution, controlling policy, locked evidence, exceptions, recovery, and human governance understandable and verifiable.

### Read-only architecture and authority

The defensible system statement is:

> **Monitoring Views are read-only projections. Governance and Demonstration actions are separate, authenticated command workflows hosted in the same Assurance Console.**

The Monitoring Service consumes domain events, telemetry, KPI results, and Assurance Incidents to build read projections. Agent Registry, Curriculum, Training, Examination, Certification, Marketplace, and the other owning services remain authoritative for their data. A Monitoring View cannot edit its projection, repair domain state, or write another service's database.

Search, filtering, drill-down, comparison, and export are read-only interactions. When a user enters a Governance or Demonstration workflow, the interface makes that boundary explicit. Every command calls the authenticated API of the owning service, which rechecks current authoritative state and policy before acting. A stale projection can never authorize a command.

### Users and permissions

Permissions are composable and reassignable rather than bound to assumed member specialties:

| Role | Permitted behavior |
|---|---|
| Viewer/Evaluator | Read Monitoring Views, inspect sanitized evidence, compare KPI runs, and generate permitted Evidence Bundles. |
| Governance Operator | Perform authorized review, incident, quarantine, recovery, and credential-lifecycle commands. |
| Demo Operator | Launch and control only isolated Demonstration Lab scenarios and test data. |

One person may hold multiple roles as availability changes. Two-person Domain Assurance Package review still requires two distinct authenticated identities. Permission-denied states are visible and testable.

### Three independent evidence lenses

The console never collapses all system state into one health score:

1. **Assurance Posture** - curriculum validity and freshness, examination and grading integrity, blocked Certification Decisions, credential status, quarantines, and governance exceptions.
2. **Operational Health** - service and dependency availability, request performance, event processing, provider availability, retry/recovery, and cost ceilings.
3. **Evaluation Evidence** - versioned KPI runs, Acceptance Floors, Targets, datasets, automated tests, hero demonstrations, and known limitations.

Operational Health uses `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, and `UNKNOWN`. Assurance Posture uses `VALID`, `ATTENTION_REQUIRED`, `BLOCKED`, `QUARANTINED`, and `INDETERMINATE`. KPI Evidence uses `GREEN`, `AMBER`, `RED`, and `UNMEASURED` under the approved success policy. “Services healthy” never implies that assurance is valid, and strong aggregate evidence never hides a Red critical-path capability.

### Information architecture

The Assurance Console has six plain-language primary areas:

1. **Overview**
2. **Lifecycle** - Registration, Curriculum, Examination, and Certification tabs
3. **Governance** - reviews, quarantines, and Assurance Incidents
4. **Evidence** - KPI runs, automated tests, demonstrations, and exports
5. **Operations** - services, data dependencies, streams, providers, and costs
6. **Marketplace** - a clearly labelled supporting-service view

The default Overview is ordered by decision importance:

1. Assurance decisions awaiting the operator;
2. open Critical/Major incidents and quarantines;
3. the four-stage lifecycle with current counts and blocked Agent Learners;
4. Green/Amber/Red/Unmeasured KPI gates by capability;
5. curriculum freshness and credential-status warnings;
6. compact Operational Health; and
7. secondary Marketplace information.

Decorative topology, constellation, and fleet visualizations are optional drill-downs and never outrank critical actions or evidence.

### Agent Assurance Record

Every Agent Learner has one correlated evidence timeline:

**Registration -> Curriculum Delivery -> Examination -> Certification -> Marketplace Eligibility**

Each stage presents status, authoritative timestamp, evidence mode/environment, controlling Domain Assurance Package or policy version, automated action, Safe State or exception, relevant correlation IDs, and links to immutable evidence. It explicitly distinguishes System-Aborted and Agent-Failed Examinations and standard versus fallback assessment. Marketplace is shown downstream and cannot modify the four-stage assurance result.

### Mandatory signal catalogue

| Area | Required signals |
|---|---|
| Registration | Accepted/rejected counts, structured rejection reasons, current lifecycle state, and p95 latency. |
| Curriculum | Active/candidate/quarantined package versions; all six validation checks; objective coverage; reviewer count/mean; source status, last check, next check, and freshness classification. |
| Training | Sessions started, completed, remediated, aborted, and completion rate; module/objective progress and evidence mode. |
| Examination | Attempts started/completed; System-Aborted/Agent-Failed/pass/fail/fallback counts; total/adversarial score distributions; critical violations; template/rubric/package versions. |
| Certification | Decisions passed/blocked, credentials issued, p95 issuance latency, and valid/suspended/revoked/expired/indeterminate credential states. |
| Grading quality | Dataset and policy versions, labelled-response count, pass/fail agreement, mean score error, repeat variance, and mandatory-safety false passes. |
| Marketplace | Eligible/Near/no-match/unsupported-domain results, exclusion/gap reasons, duplicate prevention, and p95 latency. |
| Operations | Per-service availability, request/error rate, p95 latency, PostgreSQL availability, Redis stream lag/pending entries/poison events, retry budget usage, backlog, and recovery duration. |
| Provider and cost | Synthetic/replay/live/fallback mode, calls, input/output tokens, runtime, configured ceilings, consumed budget, and estimated/actual spend where available. |

No required but unmeasured KPI is displayed as healthy. The console preserves the Acceptance Floor and Initial Target beside each measured value and links to its versioned dataset, formula, environment, and run.

### Correlation, privacy, and audit

Every applicable lifecycle request, domain event, metric, trace, audit record, and Assurance Incident carries correlation identifiers for request, trace, causation, Agent Learner, Training Session, Examination attempt, Domain Assurance Package, credential, and match, plus service, timestamp, environment, and evidence mode.

Monitoring ingestion redacts raw examination answers, private prompts, system instructions, provider credentials/tokens, protected context, personal data, signing keys, and other secrets. Sanitized IDs and evidence summaries remain sufficient to trace a Certification Decision without disclosing restricted content.

Every Governance or Demonstration command records authenticated actor/role, owning service, command and target, required reason, correlation ID, request time, outcome, and before/after evidence references. The audit record is append-only; it does not embed private payloads. A human cannot edit a score, change fail to pass, issue a credential manually, alter a rubric, or directly modify a domain record.

### Attention and alert behavior

Every **Attention Record** displays severity, affected scope, detection time, evidence source and freshness, reason code, current Safe State, owner, required next action, and supporting evidence. Signals with the same correlation and affected scope update one record rather than flooding the queue.

The capstone requires an in-app Attention Queue and a persistent Critical banner across console routes. Critical/Major/Supporting semantics follow the approved risk matrix. Email, SMS, Slack/Teams, and production paging integrations are deferred. Failure to deliver a notification never weakens the automated Safe State.

### Governance and operational interactions

The approved bounded governance commands are:

- approve or reject a Candidate Package as one participant in two-person review;
- acknowledge or assign an Assurance Incident;
- approve release from quarantine only after recovery evidence passes;
- suspend or revoke a credential with a required reason;
- initiate a source-freshness check or package-validation run;
- verify credential signature and status;
- create or close a simulated Capability Request and request a fresh match; and
- request a bounded retry of a contained incident through its owning service.

The console may also search/filter agents, attempts, credentials and incidents; inspect provenance/audit timelines; compare KPI runs; and export sanitized evidence. Commands never bypass the service's schema, idempotency, authorization, current-state, or policy checks.

### Demonstration Lab

The isolated, conspicuously test-labelled Demonstration Lab lets an evaluator or Demo Operator:

- launch a seeded synthetic or replay Agent Learner through the real public APIs;
- optionally launch a budget-limited live adapter;
- select one of the approved hero failure scenarios;
- inject its deterministic test fault;
- watch lifecycle events, Safe State, Assurance Incident, bounded recovery, and resulting evidence;
- verify and deliberately tamper with a test credential;
- run and refresh a Capability Request match; and
- reset only isolated demonstration data.

The Lab uses test Agent Learners, test issuer keys, explicit evidence-mode labels, and safe simulated tools. It cannot directly set a grade, force a pass, fabricate a Certification Decision, create a credential, or mutate non-test records. Reset behavior removes or reinitializes only the explicitly selected test run under the approved test-data policy; immutable demonstration manifests and incident evidence remain available for evaluation.

### Freshness and staleness

In the controlled evaluation environment, authoritative event-to-Monitoring-View projection latency has an Acceptance Floor of at most 10 seconds and an Initial Target of at most 5 seconds. Operations may poll or stream updates, but each datum always exposes source and `observedAt`.

Operational evidence without a successful refresh for 15 seconds becomes stale and reports `UNKNOWN`; the console cannot continue showing the last known state as healthy. Historical KPI, conformance, and demonstration results are immutable timestamped runs and never represented as live status. Manual refresh is always available.

### Evidence Bundles

The Evidence area generates immutable, sanitized **Evidence Bundles** as human-readable HTML plus machine-readable JSON. A bundle records:

- bundle, build/commit, blueprint, and schema versions;
- environment and bounded time range;
- dataset, Domain Assurance Package, examination template, rubric, grading, match, and KPI-policy versions;
- formulas, Acceptance Floors, Targets, measurements, and Green/Amber/Red/Unmeasured results;
- automated-test and hero-scenario run IDs;
- linked Assurance Incidents and recovery outcomes;
- credential-verification summaries;
- evidence mode, provider call/token/runtime/cost totals, and configured ceilings;
- limitations and accepted out-of-scope residual risks; and
- a manifest of included files and content digests.

Evidence Bundles do not claim external accreditation or contain private prompts, raw answers, secrets, tokens, signing keys, or hidden grading rationale. Content digests prove bundle-file consistency, not an external authority's endorsement.

### Retention and budget control

Defaults are configurable but preserve grading evidence:

- raw structured logs and traces: seven days or a configurable rolling size cap;
- aggregated operational metrics: 30 days; and
- sanitized audit records, Assurance Incidents, KPI runs, demonstration manifests, and Evidence Bundles: project lifetime.

Rotation cannot delete evidence referenced by an active investigation or required Evidence Bundle. These local, bounded defaults support a zero-paid-monitoring path.

### Acceptance and quality gates

Sprint 4 cannot exit unless:

- every mandatory signal family is present or explicitly `UNMEASURED`/Red;
- seeded lifecycle counts and states reconcile with authoritative records;
- every hero scenario is traceable by correlation ID from trigger through Safe State and recovery evidence;
- stale or unavailable monitoring data becomes `UNKNOWN`, never healthy;
- event-to-view projection latency is at most 10 seconds, targeting 5;
- seeded Overview load completes within three seconds, targeting two;
- Monitoring Views remain read-only under permission and mutation tests;
- all command workflows call owning-service APIs and generate audit evidence;
- loading, empty, error, stale, and permission-denied states are tested;
- navigation and controls are keyboard-operable with semantic landmarks, accessible names, and visible focus;
- touch targets are approximately 44 px and the console has no horizontal overflow at a 390 px viewport;
- no reusable public demo password or fixed historical date is presented as current; and
- at least one valid HTML/JSON Evidence Bundle is regenerated from a complete controlled run.

The dashboard is successful when an evaluator can start from an Attention Record or Agent Learner, follow identifiers through the four-stage lifecycle, inspect the governing package/rubric/policy and evidence mode, distinguish automated execution from human governance, verify the final credential state, and reproduce the associated KPI or demonstration result without consulting raw databases.
