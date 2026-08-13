# Balance seven-member workload and continuity coverage

Type: grilling
Status: resolved
Blocked by: 09

## Question

How should the blueprint distribute primary ownership, backup coverage, cross-review, integration, documentation, and testing across seven members so the starting load is equitable but can be rebalanced without leaving a critical capability uncovered?

## Comments

- Roster confirmed from the submitted feasibility, requirements, and software-design cover sheets: Raniya Habachi, Pranav Sujith Nambiar, Timothy Kyle R. Valle, Neeraj Santosh, Djurayev Timurmalik, Luis Vargas, and Salman Akram. Names may be used directly; assignments remain reassignable.
- Fairness confirmed: balance weighted contribution across the project, counting implementation, tests, fixtures, integration, curriculum/evidence, review, documentation/runbooks, demonstration preparation, and active backup/handoff work—not raw ticket count or lines of code.
- Sizing confirmed in principle: implementation tickets use explained 1/2/3/5/8 contribution points and anything larger than 8 is split. Points are relative planning estimates, not grades or productivity scores.
- Continuity confirmed: every critical capability has an active Primary and Backup; assignments are defaults rather than locks; reassignment preserves handoff evidence and independent review.
- Lightweight Integration Steward confirmed: rotate/assign the responsibility each sprint, but treat it as a small checklist/evidence coordination duty that may be finalized from sprint summaries rather than a major share of contribution.
- Review and capacity confirmed: security/trust-critical work cannot rely on its implementer as sole reviewer; begin from equal load and adjust for declared availability without treating temporary unavailability as poor performance.
- Practical weighting confirmed: 1/2/3/5/8 points will be explained and may be included for planning visibility, but they are advisory rather than a completion gate. Working integrated scope and all Sprint Gate evidence outrank perfect numerical balance; delivery should proceed as quickly as the team can plan safely.
- Code-first workflow confirmed with a boundary: per-ticket prose documentation may be highly recommended and consolidated later, but required tests, contract notes, setup/recovery instructions, review evidence, and the Sprint Evidence Pack must exist before the corresponding Sprint Gate passes.
- Name-based tracking confirmed: parent work packages and later tickets use the seven member names until everyone has joined the repository; GitHub usernames are mapped later without changing historical ownership.
- Ownership semantics confirmed: Primary and Backup are accountable continuity roles, not exclusive work boundaries. Any team member may implement, test, review, debug, or document any package; the Primary makes sure it reaches its gate and the Backup can take over.
- Baseline rotation confirmed: seven named packages per sprint, one Primary and one active Backup assignment per member per sprint, with independent third-person review added to trust-critical work. The integration/evidence package Primary is the default lightweight Integration Steward.
- Reassignment confirmed: Backup becomes acting Primary, evidence/blockers are handed over, a new Backup is chosen from practical available capacity, review conflicts are corrected, and optional scope pauses before critical gates weaken.

## Answer

EduAgentX begins with an equal, neutral seven-member allocation and treats every assignment as an editable default. The blueprint does not infer ability from earlier placeholder specialties, and it does not create permanent frontend, backend, AI, DevOps, testing, or documentation lanes.

The roster, taken consistently from the submitted project documents, is:

1. Raniya Habachi
2. Pranav Sujith Nambiar
3. Timothy Kyle R. Valle
4. Neeraj Santosh
5. Djurayev Timurmalik
6. Luis Vargas
7. Salman Akram

Assignments use names until every member joins the repository. Later ticketing maps names to GitHub usernames without rewriting historical ownership.

### Accountable, non-exclusive ownership

A **Capability Primary** coordinates a work package and makes sure its implementation, tests, integration, minimum completion record, handoff, and Sprint Gate evidence are complete. The Primary may delegate subtasks and is not expected to write every line.

A **Capability Backup** actively understands the same package, reviews or runs it, can explain its evidence and recovery, and can assume coordination if needed. Listing a Backup without participation does not satisfy continuity.

These roles answer “who makes sure this is completed?” and “who can take over?” They never mean that only those two people may contribute. Any of the seven members may implement a subtask, review a change, fix integration, build tests, improve the interface, or help prepare evidence in any package.

### Practical contribution model

Fairness is judged across the complete project and includes code, tests, fixtures, integration, curriculum/evidence work, review, runbooks, demonstration preparation, and active backup/handoff work. Ticket count, lines of code, or nominal ownership alone do not establish an equal contribution.

Later implementation tickets may use advisory contribution points:

| Points | Planning meaning |
|---:|---|
| 1 | Very small isolated change, review, or coordination duty |
| 2 | Small bounded change with verification |
| 3 | Normal feature, test, integration, or evidence task |
| 5 | Complex multi-component task with meaningful uncertainty |
| 8 | Largest acceptable ticket with substantial integration risk |

Anything estimated above 8 is split. Backup/review tasks normally receive their own 1-3 point estimate when they require real work. Points are transparent planning aids, not hours, grades, ability ratings, contribution proof, or a completion gate. Working integrated scope and all required Sprint Gate evidence outrank perfect numerical symmetry.

Each sprint should start roughly balanced among available members, using approximately 20% of the available-member average as a planning warning rather than a hard constraint. Short-term imbalance is acceptable when availability or actual complexity demands it and is balanced later where practical. The team proceeds as quickly as it can plan and integrate safely.

### Code-first completion boundary

The workflow may be code-first and full prose documentation may be consolidated later. Each completed work package must still leave a minimal five-part summary:

1. completed behavior;
2. tests and evidence location;
3. known limitation or blocker;
4. setup/recovery command; and
5. current Primary and Backup readiness.

Per-ticket narrative documentation remains highly recommended rather than a universal blocking requirement. Required tests, contract notes, setup/recovery instructions, independent review evidence, and the approved Sprint Evidence Pack remain mandatory before the relevant Sprint Gate passes; otherwise later aggregation and second-machine reproduction would be impossible.

### Named baseline rotation

Each sprint begins with seven work packages. Each member holds one Primary and one Backup responsibility per sprint. The rotation is deliberately mechanical rather than based on assumed specialties.

| Sprint | Work package | Primary | Backup |
|---:|---|---|---|
| 1 | Docker Compose and local platform | Raniya | Pranav |
| 1 | API Gateway, authentication, and contracts | Pranav | Timothy |
| 1 | Agent Registry core | Timothy | Neeraj |
| 1 | External protocol and Synthetic Agent Learner | Neeraj | Timurmalik |
| 1 | PostgreSQL, Redis Streams, and idempotency | Timurmalik | Luis |
| 1 | Automated, security, and integration tests | Luis | Salman |
| 1 | Telemetry, demonstration, and Sprint Evidence Pack | Salman | Raniya |
| 2 | Source and Domain Assurance Package model | Salman | Pranav |
| 2 | Validation, review, and activation workflow | Raniya | Timothy |
| 2 | ChromaDB index, cache, and rebuild behavior | Pranav | Neeraj |
| 2 | Training delivery and session state | Timothy | Timurmalik |
| 2 | Practice, remediation, and progress | Neeraj | Luis |
| 2 | Freshness, quarantine, and fallback bank | Timurmalik | Salman |
| 2 | Integration, tests, demonstration, and evidence | Luis | Raniya |
| 3 | Examination generation and template policy | Luis | Pranav |
| 3 | Examination attempt state and atomicity | Salman | Timothy |
| 3 | Grading, rubric, and critical violations | Raniya | Neeraj |
| 3 | Labelled dataset and grading KPIs | Pranav | Timurmalik |
| 3 | Deterministic fallback examination | Timothy | Luis |
| 3 | Adversarial scenarios and remediation events | Neeraj | Salman |
| 3 | Integration, failure tests, demonstration, and evidence | Timurmalik | Raniya |
| 4 | Certification Decisions and issuance | Timurmalik | Pranav |
| 4 | Signing, verification, status, and test keys | Luis | Timothy |
| 4 | Monitoring projections and signals | Salman | Neeraj |
| 4 | Console Overview, Lifecycle, and Agent Assurance Records | Raniya | Timurmalik |
| 4 | Governance, Demonstration Lab, and permissions | Pranav | Luis |
| 4 | Operations, Evidence Bundle, and accessibility | Timothy | Salman |
| 4 | Integration, recovery, security, and demonstration | Neeraj | Raniya |
| 5 | Capability Requests and Marketplace Eligibility | Neeraj | Pranav |
| 5 | Ranking, Near Matches, and explanations | Timurmalik | Timothy |
| 5 | Skill Gap remediation contracts | Luis | Neeraj |
| 5 | 1,000-scenario end-to-end suite | Salman | Timurmalik |
| 5 | Hero scenarios and deterministic fault injection | Raniya | Luis |
| 5 | Marketplace Console, demonstration, and final evidence | Pranav | Salman |
| 5 | Release hardening, second-machine setup, and handoff drill | Timothy | Raniya |

This table establishes accountability and initial load only. Later implementation tickets may divide every package among several members, and any member may contribute anywhere.

### Independent review

During sprint planning, every trust-critical package receives a third named reviewer who is neither its Primary nor an author of the relevant change. This applies at minimum to:

- authentication and authorization;
- Domain Assurance Package validation and activation;
- examination/grading policy and validation;
- credential signing, verification, and status;
- trust-gate, quarantine, and security-critical behavior.

The reviewer may change with availability, but independent evidence may not disappear. Package activation still requires its two distinct content reviewers under the curriculum contract.

### Integration Steward

The Primary of the final integration/evidence package is the default lightweight Integration Steward:

- Sprint 1 - Salman
- Sprint 2 - Luis
- Sprint 3 - Timurmalik
- Sprint 4 - Neeraj
- Sprint 5 - Timothy

This is normally a one-point coordination duty: confirm Compose health, reconcile contract/dependency versions, collect the minimal package summaries, and assemble the Sprint Evidence Pack. It is not intended to become a permanent project-manager role or a large portion of contribution. The team may reassign it or fill it from sprint summaries before exit; if the real effort grows, its estimate is increased honestly.

### Availability and reassignment

Members declare expected availability, not private reasons, during planning and whenever it materially changes. Temporary unavailability is not treated as poor performance. When a Primary becomes unavailable or a capability risks its gate:

1. the Backup becomes acting Primary;
2. completed evidence, remaining work, blockers, branches, commands, and relevant decisions are handed over;
3. a new Backup is selected from practical available capacity;
4. independent-review conflicts are identified and corrected;
5. assignments and contribution estimates are updated by name; and
6. optional supporting work is paused before any Invariant or Acceptance Floor is weakened.

If the Backup is also unavailable, any available member may become acting Primary after the same handoff. No capability may remain dependent on inaccessible single-person knowledge.

### Continuity and final verification

Every critical capability must have a Primary, active Backup, minimum completion summary, setup/recovery path, and independent review where required. Before final release, a Backup completes another member's documented scenario on the second machine and produces the continuity evidence required by the approved failure matrix.

When implementation tickets are created, each work package becomes a parent issue or tracked grouping with name-based sub-issue assignments and an advisory point summary. GitHub usernames are attached only after the members join. Actual contributors, reviews, reassignments, and Evidence Packs—not this initial table alone—form the final contribution record.
