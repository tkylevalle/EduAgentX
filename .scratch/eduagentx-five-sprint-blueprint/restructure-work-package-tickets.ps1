$ErrorActionPreference = 'Stop'

$repository = 'tkylevalle/EduAgentX'
$parentIssue = 1

$packages = @(
    [ordered]@{
        Number = 2; Sprint = 1; Title = 'Docker Compose and local platform'; Blockers = @(); Points = 5
        Primary = 'Raniya Habachi'; Secondary = 'Pranav Sujith Nambiar'
        Delivers = 'A reproducible local platform that boots the narrow registration walking skeleton and gives every later work package one shared environment.'
        Criteria = @(
            'A clean checkout starts the initial API Gateway, Agent Registry, PostgreSQL, Redis Streams, and minimal Assurance Console services with one documented command.',
            'Service configuration, health checks, networks, volumes, test secrets, and reset behavior are explicit and repeatable.',
            'A smoke journey reaches the gateway and returns a correlated registration-path response without direct database setup.',
            'Setup and reset succeed on a second clean environment and leave no committed secret or reusable public password.'
        )
    },
    [ordered]@{
        Number = 3; Sprint = 1; Title = 'API Gateway, authentication, and contracts'; Blockers = @(2); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Secondary = 'Timothy Kyle R. Valle'
        Delivers = 'A versioned public boundary through which Agent Learners authenticate, negotiate protocol versions, submit valid requests, and receive stable safe failures.'
        Criteria = @(
            'The gateway enforces authentication, authorization, API/protocol version, schema, payload-size, rate, idempotency, and correlation requirements.',
            'Valid requests route only to the owning service and structured error contracts expose stable reason codes.',
            'Unsupported versions, malformed payloads, invalid authentication, and identity mismatch are rejected before domain mutation.',
            'Contract and black-box tests cover success and every fail-closed boundary.',
            'A third independent reviewer who is neither the Primary nor an author records the trust-boundary review.'
        )
    },
    [ordered]@{
        Number = 4; Sprint = 1; Title = 'Agent Registry core'; Blockers = @(2, 3); Points = 5
        Primary = 'Timothy Kyle R. Valle'; Secondary = 'Neeraj Santosh'
        Delivers = 'A provider-neutral Agent Learner can register, retrieve its authoritative identity, and bind lifecycle evidence to a stable configuration fingerprint.'
        Criteria = @(
            'Agent Registry owns the authoritative Agent Learner record and exposes registration/retrieval only through versioned public contracts.',
            'Registration binds model/provider version, system-prompt hash, approved tool manifest, policy/configuration hash, and adapter version into a stable fingerprint.',
            'Rejected requests create no partial Agent Learner or fingerprint and material fingerprint changes are recorded as new assurance-relevant state.',
            'The minimal Assurance Console trace displays the authoritative registration outcome and correlation evidence.',
            'Domain and black-box tests cover valid, invalid, repeated, and materially changed registrations.'
        )
    },
    [ordered]@{
        Number = 5; Sprint = 1; Title = 'External protocol and Synthetic Agent Learner'; Blockers = @(3, 4); Points = 5
        Primary = 'Neeraj Santosh'; Secondary = 'Djurayev Timurmalik'
        Delivers = 'The provider-neutral External Agent Learner Protocol is proven by a deterministic Synthetic Agent Learner that participates through the same public boundary as future live adapters.'
        Criteria = @(
            'The versioned protocol defines registration, lifecycle interaction, timeout, payload, authentication, correlation, and evidence-mode behavior without a provider allowlist.',
            'A deterministic Synthetic Agent Learner implements the protocol and registers through the real gateway without direct service or database access.',
            'Synthetic evidence is visibly labelled as simulation and cannot be confused with live inference.',
            'Malformed, inconsistent, timing-out, and unavailable synthetic profiles produce the specified safe public outcomes.',
            'Protocol conformance tests can be reused by Replay and future live adapters.'
        )
    },
    [ordered]@{
        Number = 6; Sprint = 1; Title = 'PostgreSQL, Redis Streams, and idempotency'; Blockers = @(2, 4); Points = 5
        Primary = 'Djurayev Timurmalik'; Secondary = 'Luis Vargas'
        Delivers = 'Registration state is authoritative, service-owned, durable, correlated, and safe under request retries and stream-consumer interruption.'
        Criteria = @(
            'PostgreSQL stores authoritative Registry data under service-owned schema/table permissions that prevent direct cross-service writes.',
            'Redis Streams consumer groups carry versioned registration lifecycle events with correlation, causation, aggregate, and sequence data.',
            'Repeating a request or event returns/preserves the original outcome and creates no duplicate lifecycle object.',
            'A controlled consumer interruption preserves pending work and recovery processes it exactly once in effect.',
            'Poison and out-of-order event behavior fails safely without blocking unrelated valid work.'
        )
    },
    [ordered]@{
        Number = 7; Sprint = 1; Title = 'Automated, security, and integration tests'; Blockers = @(3, 4, 5, 6); Points = 5
        Primary = 'Luis Vargas'; Secondary = 'Salman Akram'
        Delivers = 'A reusable automated harness verifies Sprint 1 through the confirmed black-box seam and establishes the testing conventions used by every later sprint.'
        Criteria = @(
            'The harness boots the real Compose environment and interacts through public contracts rather than direct database mutation or internal methods.',
            'Unit, contract, integration, security, idempotency, failure, and end-to-end tests cover the Sprint 1 behaviors and forbidden outcomes.',
            'Fixtures are deterministic, environment-labelled, secret-free, and reusable by later Synthetic and Replay scenarios.',
            'Test output is machine-readable, correlated to the tested build, and fails when a mandatory check is absent.',
            'The suite runs from a clean checkout with one documented command.'
        )
    },
    [ordered]@{
        Number = 8; Sprint = 1; Title = 'Telemetry, demonstration, and Sprint Evidence Pack'; Blockers = @(7); Points = 3
        Primary = 'Salman Akram'; Secondary = 'Raniya Habachi'
        Delivers = 'Sprint 1 closes with observable registration evidence, a deterministic demonstration, measured latency, and a reproducible Sprint Evidence Pack.'
        Criteria = @(
            'Health, structured telemetry, correlation, and safe redaction cover the registration path and its dependencies.',
            'One demonstration performs successful registration, safe rejection, and idempotent retry while showing no partial or duplicate Agent Learner.',
            'Registration p95 is no more than three seconds and the two-second Target is reported separately in the versioned environment.',
            'The Sprint Evidence Pack records build/contracts, setup/reset, tests, measurements, incidents, limitations, runbook, ownership, and review outcome.',
            'The Sprint 1 Gate cannot pass while an Invariant, Acceptance Floor, required measurement, or reproducibility check fails.'
        )
    },
    [ordered]@{
        Number = 9; Sprint = 2; Title = 'Source and Domain Assurance Package model'; Blockers = @(2, 3); Points = 8
        Primary = 'Salman Akram'; Secondary = 'Pranav Sujith Nambiar'
        Delivers = 'A versioned immutable Domain Assurance Package represents the complete AI Agent Safety and Secure Tool Use curriculum-and-assessment contract with exact provenance.'
        Criteria = @(
            'The package manifest pins exact source, objective, module, Curriculum Track, examination template, rubric, and fallback-bank versions.',
            'Candidate, Active, Quarantined, and Superseded states preserve immutable artifacts and append-only lifecycle evidence.',
            'The five approved modules use the version-pinned NIST, OECD, and OWASP source baseline with exact edition/snapshot, hash, and pinpoint provenance.',
            'Every learning objective is observable, linked to curriculum delivery, and classified for safety-critical coverage.',
            'Authorized users can ingest and inspect a Candidate Package without exposing it to Agent Learner traffic.'
        )
    },
    [ordered]@{
        Number = 10; Sprint = 2; Title = 'Validation, review, and activation workflow'; Blockers = @(9); Points = 8
        Primary = 'Raniya Habachi'; Secondary = 'Timothy Kyle R. Valle'
        Delivers = 'Only a complete, traceable, policy-conformant Candidate Package approved by two distinct reviewers can activate atomically.'
        Criteria = @(
            'Six independent gates validate schema/manifest, source traceability, objective coverage, examination policy, rubric policy, and fallback readiness.',
            'Every objective links to a module and two Examination slots across two tiers; safety-critical objectives also have adversarial coverage and a critical rule.',
            'Two distinct authenticated reviewers approve only after automated checks pass, with a 3.5/5 floor and 4/5 Target.',
            'Activation atomically changes the active pointer/cache and preserves the previous immutable version as Superseded.',
            'Invalid, incomplete, unauthorized, duplicate, or racing activation attempts fail closed with independent trust review.'
        )
    },
    [ordered]@{
        Number = 11; Sprint = 2; Title = 'ChromaDB index, cache, and rebuild behavior'; Blockers = @(9, 10); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Secondary = 'Neeraj Santosh'
        Delivers = 'Validated curriculum is retrievable through a rebuildable ChromaDB index while PostgreSQL and immutable package artifacts remain authoritative.'
        Criteria = @(
            'Only Active validated package content is indexed for Agent Learner retrieval.',
            'The index stores package/source/objective/module references without becoming the source of package truth.',
            'ChromaDB loss or corruption can be detected and rebuilt deterministically from authoritative package evidence.',
            'Retrieval dependency loss serves only the last validated cache with explicit freshness/mode evidence and cannot activate a Candidate Package.',
            'Rebuild, cache-hit, unavailable, and stale-index tests preserve the active package meaning.'
        )
    },
    [ordered]@{
        Number = 12; Sprint = 2; Title = 'Training delivery and session state'; Blockers = @(4, 5, 10); Points = 5
        Primary = 'Timothy Kyle R. Valle'; Secondary = 'Djurayev Timurmalik'
        Delivers = 'A registered Agent Learner can start, follow, resume, and complete an ordered Training Session against the exact Active package.'
        Criteria = @(
            'Training starts through the public gateway only for a registered fingerprint and Active eligible package.',
            'Modules are delivered in manifest order and progress records package, module, objective, mode, environment, and timestamps.',
            'Interrupted sessions resume without duplicating completed interactions or changing the governing package.',
            'Candidate or Quarantined packages cannot start or continue delivery when assurance policy blocks them.',
            'The Assurance Console exposes read-only current and historical Training Session state.'
        )
    },
    [ordered]@{
        Number = 13; Sprint = 2; Title = 'Practice, remediation, and progress'; Blockers = @(12); Points = 5
        Primary = 'Neeraj Santosh'; Secondary = 'Luis Vargas'
        Delivers = 'Training provides bounded practice and targeted remediation with durable objective-level progress and honest completion evidence.'
        Criteria = @(
            'Practice interactions are bounded, tied to module/objective identifiers, and never modify Agent Learner model weights.',
            'A structured remediation request assigns targeted content while preserving the evidence that caused the request.',
            'Completion requires the configured module/practice conditions and emits one idempotent event.',
            'Started, completed, remediated, resumed, and aborted counts plus completion rate are traceable in read-only views.',
            'The controlled dataset measures at least 90% expected completion and reports the 95% Target.'
        )
    },
    [ordered]@{
        Number = 14; Sprint = 2; Title = 'Freshness, quarantine, and fallback bank'; Blockers = @(10, 11); Points = 8
        Primary = 'Djurayev Timurmalik'; Secondary = 'Salman Akram'
        Delivers = 'Curriculum freshness changes are classified safely, critical content is quarantined, and the active package carries a prevalidated deterministic fallback bank.'
        Criteria = @(
            'Freshness checks default to 30 days and record No Change, Watch, Patch, Substantive, or Critical classifications with source evidence.',
            'A substantive change creates a separate Candidate Package while the last validated version remains active.',
            'A critical correction quarantines the smallest affected scope and blocks related training/certification until trust is restored.',
            'The fallback bank contains exactly 15 immutable source-linked items using the approved five/six/four cognitive-tier policy and deterministic scoring.',
            'No outage-generated, incomplete, or unvalidated fallback can be selected.'
        )
    },
    [ordered]@{
        Number = 15; Sprint = 2; Title = 'Integration, tests, demonstration, and evidence'; Blockers = @(8, 11, 13, 14); Points = 5
        Primary = 'Luis Vargas'; Secondary = 'Raniya Habachi'
        Delivers = 'Sprint 2 closes with an integrated curriculum/training path, quality measurements, safe dependency-loss behavior, and a reproducible Evidence Pack.'
        Criteria = @(
            'A registered Synthetic Agent Learner completes and resumes the validated five-module package through public contracts.',
            'The demonstration preserves validated cache during retrieval/source loss, creates a Candidate on substantive change, and quarantines on a critical correction.',
            'Traceability, objective coverage, reviewer quality, training completion, immutability, and failure Invariants are automatically measured.',
            'The Sprint 2 Evidence Pack records the build, packages, tests, KPIs, incidents, demonstration, limitations, runbook, ownership, and review.',
            'The Sprint 2 Gate requires Sprint 1 and every Sprint 2 Invariant and Acceptance Floor to pass.'
        )
    },
    [ordered]@{
        Number = 16; Sprint = 3; Title = 'Examination generation and template policy'; Blockers = @(10, 13, 14); Points = 8
        Primary = 'Luis Vargas'; Secondary = 'Pranav Sujith Nambiar'
        Delivers = 'A training-complete Agent Learner receives a source-bound, objective-covered Examination conforming to the Active package template.'
        Criteria = @(
            'Examination generation uses only the locked Active package template, objectives, source references, and generation policy.',
            'Each delivered form contains exactly five recall, six applied, and four adversarial items with the approved 20/40/40 weighting.',
            'Required objective, cognitive-tier, safety-critical, and source-pinpoint coverage is validated before delivery.',
            'Invalid, incomplete, duplicate, or policy-weakened generated forms are rejected and never become gradable attempts.',
            'The public Examination workflow and read-only console view expose governing identifiers without restricted answer material.'
        )
    },
    [ordered]@{
        Number = 17; Sprint = 3; Title = 'Examination attempt state and atomicity'; Blockers = @(6, 16); Points = 5
        Primary = 'Salman Akram'; Secondary = 'Timothy Kyle R. Valle'
        Delivers = 'Every Examination attempt has one authoritative immutable configuration and safe state transitions under retries, interruptions, and competing events.'
        Criteria = @(
            'Attempt creation locks Agent Learner fingerprint, package, template, rubric, assessment mode, items, deadlines, and timestamps.',
            'No field that changes the meaning of an attempt can mutate after the attempt starts.',
            'Idempotency and aggregate sequence checks prevent duplicate or out-of-order start, response, grade, or completion effects.',
            'Attempt state distinguishes in-progress, complete, System-Aborted, and Agent-Failed outcomes.',
            'Concurrency, replay, timeout, and invalid-transition tests prove atomic externally observable behavior.'
        )
    },
    [ordered]@{
        Number = 18; Sprint = 3; Title = 'Grading, rubric, and critical violations'; Blockers = @(16, 17); Points = 8
        Primary = 'Raniya Habachi'; Secondary = 'Neeraj Santosh'
        Delivers = 'Structured rubric-bound grading produces immutable competency evidence while mandatory safety violations and malformed grading fail closed.'
        Criteria = @(
            'Grading accepts only structured output conforming to the locked rubric and complete Examination evidence.',
            'A pass requires at least 80% overall, at least 70% adversarial performance, and no critical safety violation.',
            'Unavailable, malformed, incomplete, or schema-invalid grading produces no valid score, pass, Certification Decision, or credential.',
            'Valid results preserve tier scores, critical-rule outcomes, governing versions, mode, subject, and timestamps as immutable evidence.',
            'Boundary, critical-violation, prompt/input isolation, tampering, and duplicate tests pass with an independent trust reviewer.'
        )
    },
    [ordered]@{
        Number = 19; Sprint = 3; Title = 'Labelled dataset and grading KPIs'; Blockers = @(18); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Secondary = 'Djurayev Timurmalik'
        Delivers = 'A versioned labelled-response suite measures grading agreement, error, variance, and mandatory-safety behavior before a grading policy is released.'
        Criteria = @(
            'The reproducible validation dataset contains at least 100 labelled responses and reports the 150-response Target.',
            'Pass/fail agreement is at least 85% with a 90% Target.',
            'Mean score error and repeat variance are each at most eight points with five-point Targets.',
            'Any mandatory-safety false pass blocks grading-policy release.',
            'Dataset, formula, policy, environment, build, result, and independent review evidence remain versioned and inspectable.'
        )
    },
    [ordered]@{
        Number = 20; Sprint = 3; Title = 'Deterministic fallback Examination'; Blockers = @(14, 17, 18); Points = 5
        Primary = 'Timothy Kyle R. Valle'; Secondary = 'Luis Vargas'
        Delivers = 'When standard generation or grading is unavailable, EduAgentX can start a separate prevalidated fallback attempt without weakening policy or relabelling evidence.'
        Criteria = @(
            'Infrastructure-caused interruption marks the affected standard attempt System-Aborted with no grade and no learner-attempt consumption.',
            'Fallback always uses the Active package bank under a new attempt ID and explicit fallback assessment mode.',
            'Fallback applies the same overall, adversarial, and critical-safety thresholds as standard assessment.',
            'An incomplete, invalid, or quarantined fallback bank cannot be used.',
            'Public lifecycle and console evidence never represent fallback as standard or replay/live evidence.'
        )
    },
    [ordered]@{
        Number = 21; Sprint = 3; Title = 'Adversarial scenarios and remediation events'; Blockers = @(13, 18); Points = 5
        Primary = 'Neeraj Santosh'; Secondary = 'Salman Akram'
        Delivers = 'Unsafe Agent Learner behavior produces explicit Agent-Failed evidence, structured objective gaps, targeted remediation, and a new re-examination path.'
        Criteria = @(
            'Seeded hostile-instruction, authorization-boundary, secret-protection, unsafe-tool, and safe-escalation scenarios exercise observable behavior.',
            'Learner timeout, malformed response, insufficient score, or safety violation produces Agent-Failed Examination evidence rather than a system error.',
            'A valid failure emits an idempotent structured remediation event linked to exact objectives and critical rules.',
            'Training consumes remediation without changing the original result and re-examination starts as a new attempt.',
            'The Assurance Console traces failure, gap, remediation, and re-examination through one correlated narrative.'
        )
    },
    [ordered]@{
        Number = 22; Sprint = 3; Title = 'Integration, failure tests, demonstration, and evidence'; Blockers = @(15, 19, 20, 21); Points = 5
        Primary = 'Djurayev Timurmalik'; Secondary = 'Raniya Habachi'
        Delivers = 'Sprint 3 closes with integrated pass, adversarial failure, remediation, malformed-grader, and fallback behavior backed by grading evidence.'
        Criteria = @(
            'The deterministic demonstration covers a safe pass, critical adversarial failure, remediation, malformed grading, System-Aborted behavior, and a separate fallback attempt.',
            'All Examination and grading Invariants, Acceptance Floors, Targets, retry rules, and forbidden outcomes are automatically checked.',
            'The complete path runs from a clean checkout on the zero-paid-API environment and issues no credential during Sprint 3.',
            'The Sprint 3 Evidence Pack records contracts, tests, datasets, KPIs, incidents, demonstrations, limitations, ownership, runbook, and review.',
            'The Sprint 3 Gate requires Sprints 1-2 and every applicable critical-path gate to pass.'
        )
    },
    [ordered]@{
        Number = 23; Sprint = 4; Title = 'Certification Decisions and issuance'; Blockers = @(6, 18); Points = 8
        Primary = 'Djurayev Timurmalik'; Secondary = 'Pranav Sujith Nambiar'
        Delivers = 'A complete valid passing Examination produces exactly one immutable Certification Decision and project-issued Competency Credential.'
        Criteria = @(
            'Certification consumes only complete immutable passing Examination evidence through a durable idempotent contract.',
            'A failed, incomplete, malformed, duplicated, or uncertain Examination cannot create a Certification Decision or credential.',
            'Decision evidence binds subject fingerprint, package, template, rubric, mode, scores, safety result, and timestamps.',
            'Repeated commands or events return/preserve the original outcome and create exactly one credential.',
            'Credential issuance p95 is no more than eight seconds and the five-second Target is reported.'
        )
    },
    [ordered]@{
        Number = 24; Sprint = 4; Title = 'Signing, verification, status, and test keys'; Blockers = @(23); Points = 8
        Primary = 'Luis Vargas'; Secondary = 'Timothy Kyle R. Valle'
        Delivers = 'Competency Credentials are independently verifiable, tamper-evident, lifecycle-aware W3C VC 2.0 artifacts secured with Ed25519 and safe test-key handling.'
        Criteria = @(
            'Issuance produces the approved W3C VC 2.0 compact JWS profile using Ed25519 and an explicit project-only trust notice.',
            'Verification reports signature, schema, time, suspension, revocation, issuer policy, credential policy, overall state, and reason codes separately.',
            'Tampered claims, unknown keys/issuers, disallowed algorithms, and invalid status evidence fail closed; unavailable status returns INDETERMINATE_STATUS.',
            'Signed status evidence supports reversible suspension, irreversible revocation, key rotation, and historical verification without rewriting credentials.',
            'Development/test and demonstration keys are separated and private material never enters source, images, logs, tables, responses, or bundles; independent review is recorded.'
        )
    },
    [ordered]@{
        Number = 25; Sprint = 4; Title = 'Monitoring projections and signals'; Blockers = @(6, 10, 12, 18, 23); Points = 8
        Primary = 'Salman Akram'; Secondary = 'Neeraj Santosh'
        Delivers = 'Monitoring builds read-only correlated projections and independently reports Assurance Posture, Operational Health, KPI Evidence, and actionable attention.'
        Criteria = @(
            'Monitoring consumes domain events/telemetry without writing authoritative service data and reconciles projections with source records.',
            'Registration, curriculum, training, Examination, Certification, grading, operations, provider, and cost signals are present or explicitly Unmeasured/Red.',
            'Assurance Posture, Operational Health, and KPI Evidence retain separate approved vocabularies and never collapse into one health score.',
            'Operational evidence becomes UNKNOWN after 15 seconds without refresh and event-to-view latency is at most 10 seconds with a five-second Target.',
            'Deduplicated Attention Records include severity, scope, time, freshness, reason, Safe State, owner, next action, and evidence link.'
        )
    },
    [ordered]@{
        Number = 26; Sprint = 4; Title = 'Console Overview, Lifecycle, and Agent Assurance Records'; Blockers = @(25); Points = 5
        Primary = 'Raniya Habachi'; Secondary = 'Djurayev Timurmalik'
        Delivers = 'Evaluators can navigate decisions-first read-only views and follow one Agent Learner from Registration through Certification without consulting raw databases.'
        Criteria = @(
            'The console provides Overview, Lifecycle, Governance, Evidence, Operations, and supporting Marketplace navigation shells.',
            'Overview prioritizes pending assurance decisions, Critical/Major incidents, the four-stage lifecycle, KPI gates, freshness/status warnings, and compact operations.',
            'One Agent Assurance Record shows Registration, Curriculum Delivery, Examination, Certification, and downstream evidence with authoritative timestamps and versions.',
            'System-Aborted, Agent-Failed, standard, fallback, synthetic, replay, live, and simulation meanings remain visibly distinct.',
            'Search, filter, drill-down, and correlation navigation remain read-only and never authorize a domain mutation.'
        )
    },
    [ordered]@{
        Number = 27; Sprint = 4; Title = 'Governance, Demonstration Lab, and permissions'; Blockers = @(10, 21, 24, 26); Points = 8
        Primary = 'Pranav Sujith Nambiar'; Secondary = 'Luis Vargas'
        Delivers = 'Authorized users can perform bounded audited governance and isolated demonstrations without editing monitoring projections or overriding Agent Learner outcomes.'
        Criteria = @(
            'Viewer/Evaluator, Governance Operator, and Demo Operator permissions are composable and enforced; two-person review requires distinct identities.',
            'Governance commands call the owning service, recheck authoritative state, require reasons, and create append-only audit evidence.',
            'The isolated Demonstration Lab launches seeded Synthetic/Replay Agent Learners and deterministic faults through real public contracts using test data, keys, and simulated tools.',
            'The Lab exposes trigger, lifecycle evidence, Safe State, Assurance Incident, bounded recovery, and isolated reset behavior.',
            'No role can edit a score, force a pass, issue a credential manually, change immutable policy/evidence, or mutate non-test records.'
        )
    },
    [ordered]@{
        Number = 28; Sprint = 4; Title = 'Operations, Evidence Bundle, and accessibility'; Blockers = @(25, 26, 27); Points = 8
        Primary = 'Timothy Kyle R. Valle'; Secondary = 'Salman Akram'
        Delivers = 'Operational evidence, sanitized HTML/JSON Evidence Bundles, and an accessible responsive Assurance Console make the capstone behavior independently reviewable.'
        Criteria = @(
            'Evidence Bundles bind build/environment, contracts, packages, policies, datasets, KPIs, incidents, demonstrations, costs, limitations, and content digests.',
            'Telemetry and exports redact raw answers, private prompts, system instructions, protected context, tokens, credentials, signing keys, and hidden grader material.',
            'Retention follows approved raw, aggregate, and project-lifetime defaults and protects evidence under active investigation.',
            'Loading, empty, error, stale, and permission-denied states work with keyboard navigation, semantic names, visible focus, and approximately 44-pixel controls.',
            'The console has no horizontal overflow at 390 pixels and the seeded Overview loads within three seconds with a two-second Target.'
        )
    },
    [ordered]@{
        Number = 29; Sprint = 4; Title = 'Integration, recovery, security, and demonstration'; Blockers = @(22, 24, 28); Points = 8
        Primary = 'Neeraj Santosh'; Secondary = 'Raniya Habachi'
        Delivers = 'Sprint 4 closes with exactly-once Certification recovery, credential tamper/status evidence, correlated monitoring, audited control, and reproducible evaluation artifacts.'
        Criteria = @(
            'A controlled interruption after valid Examination completion enters a Safe State and recovers to exactly one credential within 120 seconds with a 60-second Target.',
            'One correlated demonstration covers issuance, verification, suspension, tamper rejection, Attention/Assurance Incident evidence, recovery, and bundle regeneration.',
            'Read-only projection, permissions, stale-to-Unknown, redaction, secret, accessibility, latency, duplicate, and security tests all pass.',
            'The Sprint 4 Evidence Pack records build, contracts, tests, KPIs, incidents, demonstrations, limitations, ownership, runbook, independent reviews, and exit outcome.',
            'The Sprint 4 Gate requires Sprints 1-3 and every applicable Invariant and Acceptance Floor to pass.'
        )
    },
    [ordered]@{
        Number = 30; Sprint = 5; Title = 'Capability Requests and Marketplace Eligibility'; Blockers = @(5, 24); Points = 8
        Primary = 'Neeraj Santosh'; Secondary = 'Pranav Sujith Nambiar'
        Delivers = 'Structured simulated Capability Requests return only discoverable Agent Learners whose current credential evidence and fingerprint satisfy every hard Marketplace Eligibility gate.'
        Criteria = @(
            'Authorized users can create, version, open, close, and inspect immutable Capability Requests in the supported reference domain.',
            'Candidates originate only from the real EduAgentX lifecycle and pass discoverability, signature/schema/status, fingerprint, environment, domain, objective, score, age, and mode gates.',
            'Tampered, expired, suspended, revoked, superseded, indeterminate, fingerprint-mismatched, cross-environment, and non-discoverable agents enter neither result lane.',
            'An event-fed projection is rechecked against authoritative status and fingerprint before every response; uncertainty excludes the candidate with a reason.',
            'Eligibility, authorization, status-race, duplicate, and failure-isolation tests pass with independent trust review.'
        )
    },
    [ordered]@{
        Number = 31; Sprint = 5; Title = 'Ranking, Near Matches, and explanations'; Blockers = @(30); Points = 8
        Primary = 'Djurayev Timurmalik'; Secondary = 'Timothy Kyle R. Valle'
        Delivers = 'MATCH-POLICY-1.0.0 produces deterministic explainable Eligible Matches and honestly separated Near Matches without weakening trust or request requirements.'
        Criteria = @(
            'Hard eligibility runs before the approved 35/35/20/10 ranking components and an ineligible candidate can never outrank an eligible one.',
            'Eligible results are ordered by score, credential recency, and stable Agent Learner ID and expose every component and tie-break reason.',
            'Near Matches appear only in a separate Not Eligible lane and are ordered by gaps, normalized shortfall, ordinary score, and approved tie-breakers.',
            'Unsupported domains produce no fabricated capability and no request threshold is silently relaxed.',
            'Match Results are immutable, point-in-time, idempotent, policy-versioned, and free of raw assessment/private content.'
        )
    },
    [ordered]@{
        Number = 32; Sprint = 5; Title = 'Skill Gap remediation contracts'; Blockers = @(13, 21, 31); Points = 5
        Primary = 'Luis Vargas'; Secondary = 'Neeraj Santosh'
        Delivers = 'Structured gaps from failed Examinations and Near Matches become versioned remediation recommendations that Training can consume without changing assurance outcomes.'
        Criteria = @(
            'Skill Gap accepts only structured, versioned, source-linked Examination or Marketplace gap evidence.',
            'Recommendations identify the exact objectives/capabilities, reason codes, evidence source, governing versions, and suggested Training scope.',
            'Training consumes a recommendation idempotently and preserves the original failure or Not Eligible result.',
            'Skill Gap cannot alter grades, Certification Decisions, credentials, Marketplace Eligibility, or request requirements.',
            'Duplicate, unsupported-domain, invalid-evidence, and complete remediation-handoff tests pass through public contracts.'
        )
    },
    [ordered]@{
        Number = 33; Sprint = 5; Title = '1,000-scenario end-to-end suite'; Blockers = @(29, 31, 32); Points = 8
        Primary = 'Salman Akram'; Secondary = 'Djurayev Timurmalik'
        Delivers = 'A deterministic formal suite measures the complete lifecycle and Marketplace over 1,000 controlled Agent Learner scenarios without allowing aggregate success to hide an Invariant failure.'
        Criteria = @(
            'The suite runs 1,000 scenarios across all five approved behavioral profiles through the public black-box seam.',
            'At least 90% produce the exact expected complete outcome and the 95% Target is reported.',
            'Every Registration, Curriculum Delivery, Examination, and Certification Invariant passes independently of the aggregate rate.',
            'The suite observes zero duplicate Examinations, credentials, or matches and zero mandatory-safety false passes.',
            'Marketplace golden coverage contains at least 100 cases, 1,000 agents, and 100 requests with deterministic explanation and latency evidence.'
        )
    },
    [ordered]@{
        Number = 34; Sprint = 5; Title = 'Hero scenarios and deterministic fault injection'; Blockers = @(27, 29, 31, 32); Points = 8
        Primary = 'Raniya Habachi'; Secondary = 'Luis Vargas'
        Delivers = 'All nine capstone demonstrations use safe deterministic scenarios or faults and retain evidence for containment, recovery, remediation, matching, cost, and continuity.'
        Criteria = @(
            'Evidence is retained for clean lifecycle/matching, adversarial remediation, Certification recovery, credential tampering, live-budget exhaustion/replay, fingerprint invalidation, Near Matches, unsupported-domain refusal, and continuity handoff.',
            'Every injected failure declares its forbidden outcome, minimum safe blast radius, Safe State, retry/fallback behavior, Assurance Incident, and recovery condition.',
            'Scenarios use isolated test Agent Learners, simulated tools, test keys, safe reset behavior, and no real external side effects.',
            'Optional live demonstrations have bounded calls/tokens/runtime/spend and verified Replay alternatives without mislabelling evidence.',
            'Automated evidence covers every remaining mandatory Invariant-risk matrix case.'
        )
    },
    [ordered]@{
        Number = 35; Sprint = 5; Title = 'Marketplace Console, demonstration, and final evidence'; Blockers = @(28, 31, 32, 33, 34); Points = 8
        Primary = 'Pranav Sujith Nambiar'; Secondary = 'Salman Akram'
        Delivers = 'Evaluators can create Capability Requests, inspect Eligible and Near Match explanations, observe lifecycle-driven changes, and regenerate the final sanitized evaluation evidence.'
        Criteria = @(
            'The Marketplace console creates/inspects supported Capability Requests and presents Eligible, Not Eligible Near Match, no-match, and unsupported-domain states honestly.',
            'A newly credentialed discoverable Agent Learner appears after refresh and suspension or fingerprint change removes it from fresh results.',
            'Explanations expose satisfied requirements, exact gaps, score components, policy version, evidence mode, checks, time, and point-in-time notice.',
            'Marketplace outage leaves Certification Decisions/credentials unchanged and presents an explicit supporting Safe State.',
            'The final Evidence Bundle incorporates all five packs, formal suites, nine demonstrations, cost, limitations, incidents, and content digests.'
        )
    },
    [ordered]@{
        Number = 36; Sprint = 5; Title = 'Release hardening, second-machine setup, and handoff drill'; Blockers = @(35); Points = 8
        Primary = 'Timothy Kyle R. Valle'; Secondary = 'Raniya Habachi'
        Delivers = 'The complete Capstone-Grade Reference Implementation passes its final gate from a second machine with a zero-paid path, active continuity coverage, and explicit limitations.'
        Criteria = @(
            'A second machine completes clean setup, tests, deterministic demonstrations, and Evidence Bundle generation through the documented zero-paid-API path.',
            'All five Sprint Gates and Evidence Packs pass in sequence with no open Critical/Major incident or Red/Unmeasured critical-path result.',
            'Every Acceptance Floor passes and frozen Targets are reported honestly as Green or Amber without relaxing an Invariant.',
            'A Capability Backup executes another member''s setup and scenario and produces the required continuity evidence.',
            'Secret/key/credential checks, optional live cost, known limitations, residual risks, ownership history, and non-accreditation positioning are recorded.'
        )
    }
)

$roster = @(
    'Raniya Habachi',
    'Pranav Sujith Nambiar',
    'Timothy Kyle R. Valle',
    'Neeraj Santosh',
    'Djurayev Timurmalik',
    'Luis Vargas',
    'Salman Akram'
)

if ($packages.Count -ne 35) {
    throw "Expected 35 work packages, found $($packages.Count)."
}

$expectedIssueNumbers = 2..36
$actualIssueNumbers = @($packages.Number | Sort-Object)
if (($actualIssueNumbers -join ',') -ne ($expectedIssueNumbers -join ',')) {
    throw 'Work packages must map exactly to existing issues #2-#36.'
}

foreach ($sprint in 1..5) {
    $sprintPackages = @($packages | Where-Object Sprint -eq $sprint)
    if ($sprintPackages.Count -ne 7) {
        throw "Sprint $sprint must contain exactly seven work packages."
    }
    $primaries = @($sprintPackages.Primary | Sort-Object)
    $secondaries = @($sprintPackages.Secondary | Sort-Object)
    if (($primaries -join ',') -ne (($roster | Sort-Object) -join ',')) {
        throw "Sprint $sprint does not assign every team member exactly once as Primary."
    }
    if (($secondaries -join ',') -ne (($roster | Sort-Object) -join ',')) {
        throw "Sprint $sprint does not assign every team member exactly once as Secondary."
    }
}

foreach ($package in $packages) {
    foreach ($blocker in $package.Blockers) {
        if ($blocker -notin $expectedIssueNumbers -or $blocker -ge $package.Number) {
            throw "Issue #$($package.Number) has invalid blocking edge #$blocker."
        }
    }
}

$sprintLabelSpecs = @(
    [pscustomobject]@{ Name = 'sprint: 1'; Color = 'BFDADC'; Description = 'Sprint 1 work package' },
    [pscustomobject]@{ Name = 'sprint: 2'; Color = '0E8A16'; Description = 'Sprint 2 work package' },
    [pscustomobject]@{ Name = 'sprint: 3'; Color = 'FBCA04'; Description = 'Sprint 3 work package' },
    [pscustomobject]@{ Name = 'sprint: 4'; Color = '5319E7'; Description = 'Sprint 4 work package' },
    [pscustomobject]@{ Name = 'sprint: 5'; Color = 'B60205'; Description = 'Sprint 5 work package' }
)

foreach ($spec in $sprintLabelSpecs) {
    gh label create $spec.Name --repo $repository --color $spec.Color --description $spec.Description --force
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to create or update $($spec.Name)."
    }
}

foreach ($package in $packages) {
    $acceptanceLines = ($package.Criteria | ForEach-Object { "- [ ] $_" }) -join "`n"
    if ($package.Blockers.Count -eq 0) {
        $blockedBy = 'None - can start immediately.'
    }
    else {
        $blockedBy = ($package.Blockers | ForEach-Object { "- #$_" }) -join "`n"
    }

    $body = @"
## Parent

- #$parentIssue

## What to build

$($package.Delivers)

## Acceptance criteria

$acceptanceLines

## Blocked by

$blockedBy

## Initial coverage

- **Capability Primary:** $($package.Primary)
- **Capability Secondary:** $($package.Secondary)
- **Advisory contribution points:** $($package.Points)

This work package is a starting accountability assignment, not a hard lock or exclusive work boundary. Any team member may contribute. If availability changes, the Secondary may become acting Primary, the team assigns a new active Secondary, and the handoff is recorded without weakening an Invariant or Acceptance Floor.
"@

    $title = "Sprint $($package.Sprint): $($package.Title)"
    $labels = @(
        'ready-for-agent',
        "sprint: $($package.Sprint)",
        "primary: $($package.Primary)",
        "secondary: $($package.Secondary)"
    )
    $payload = [ordered]@{ title = $title; body = $body; labels = $labels }
    $json = $payload | ConvertTo-Json -Depth 6 -Compress
    $json | gh api --method PATCH "repos/$repository/issues/$($package.Number)" --input - --silent
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to restructure issue #$($package.Number): $title"
    }
    Write-Output "UPDATED #$($package.Number) $title | Primary=$($package.Primary) | Secondary=$($package.Secondary)"
}
