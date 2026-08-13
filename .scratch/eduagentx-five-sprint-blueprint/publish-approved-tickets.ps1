$ErrorActionPreference = 'Stop'

$repository = 'tkylevalle/EduAgentX'
$parentIssue = 1
$tickets = @(
    [ordered]@{
        Key = 'T01'; Sprint = 1; Title = 'Deliver the registration walking skeleton'; Blockers = @(); Points = 8
        Primary = 'Raniya Habachi'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'A Compose-hosted Agent Learner registers through the API Gateway, persists in Agent Registry, emits a durable event, and appears in a minimal Assurance Console trace.'
        Criteria = @(
            'A clean checkout starts the required gateway, Agent Registry, PostgreSQL, Redis Streams, and minimal Assurance Console in one documented Compose environment.',
            'A provider-neutral Agent Learner can register through the public gateway and retrieve its authoritative registration record.',
            'Successful registration persists one Agent Learner, emits one durable lifecycle event, and exposes the correlated outcome in the console trace.',
            'A black-box test proves the complete public registration path without direct database mutation or internal service calls.'
        )
    },
    [ordered]@{
        Key = 'T02'; Sprint = 1; Title = 'Enforce the registration trust boundary'; Blockers = @('T01'); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'Authentication, authorization, protocol-version, schema, payload-limit, and identity failures reject safely without partial state.'
        Criteria = @(
            'The gateway enforces authentication, authorization, protocol version, payload size, rate, and schema rules before Agent Registry mutation.',
            'Unsupported versions, malformed input, invalid authentication, and identity mismatch return stable structured reason codes.',
            'Rejected requests create no partial Agent Learner, fingerprint, or lifecycle event.',
            'Black-box and contract tests cover every rejection class and an independent trust reviewer records approval.'
        )
    },
    [ordered]@{
        Key = 'T03'; Sprint = 1; Title = 'Bind fingerprints and make registration replay-safe'; Blockers = @('T01'); Points = 5
        Primary = 'Djurayev Timurmalik'; Backup = 'Luis Vargas'
        Delivers = 'Stable configuration fingerprints, idempotent retries, duplicate prevention, correlation, and Redis consumer recovery.'
        Criteria = @(
            'Registration derives a stable fingerprint from the declared model/provider, system-prompt hash, tool manifest, policy/configuration hash, and adapter version.',
            'Repeating a request with the same idempotency key returns the original result and creates no duplicate record or event effect.',
            'Requests, events, records, and console evidence share correlation and causation identifiers.',
            'A controlled consumer interruption preserves the event and recovery processes it exactly once in effect.'
        )
    },
    [ordered]@{
        Key = 'T04'; Sprint = 1; Title = 'Pass the Sprint 1 Gate'; Blockers = @('T02', 'T03'); Points = 3
        Primary = 'Salman Akram'; Backup = 'Raniya Habachi'
        Delivers = 'Registration latency evidence, storage-isolation checks, clean-checkout demonstration, and the first Sprint Evidence Pack.'
        Criteria = @(
            'The successful, rejected, and idempotent registration scenarios run from one deterministic demonstration command.',
            'Application credentials cannot write another service-owned schema and the evidence records the attempted isolation check.',
            'Registration p95 is measured in the versioned environment and is no more than three seconds, with the two-second Target reported separately.',
            'The Sprint Evidence Pack records the build, contracts, setup/reset commands, tests, measurements, demonstration, limitations, ownership, and review outcome.'
        )
    },
    [ordered]@{
        Key = 'T05'; Sprint = 2; Title = 'Ingest and inspect a source-grounded Candidate Package'; Blockers = @('T01'); Points = 5
        Primary = 'Salman Akram'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'Immutable candidate ingestion, manifest/schema validation, exact source provenance, and visible validation results.'
        Criteria = @(
            'An authorized governance request ingests a versioned Candidate Package without making it active.',
            'The manifest pins the source, objective, module, Curriculum Track, examination template, rubric, and fallback-bank artifact versions.',
            'Schema and source-traceability checks expose pass/fail results and exact missing-source or pinpoint reasons in a read-only console view.',
            'Candidate payloads and validation results remain immutable and black-box tests prove invalid candidates cannot serve Agent Learner traffic.'
        )
    },
    [ordered]@{
        Key = 'T06'; Sprint = 2; Title = 'Validate the complete reference package contract'; Blockers = @('T05'); Points = 8
        Primary = 'Raniya Habachi'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'The five-module AI Agent Safety and Secure Tool Use package with objective, examination, rubric, and fallback validation.'
        Criteria = @(
            'The package contains all five approved AI Agent Safety and Secure Tool Use modules grounded in the version-pinned source baseline.',
            'Every objective links to a module and two examination slots across two tiers; safety-critical objectives also link adversarial coverage and a critical rule.',
            'All six automated gates report independently: schema/manifest, source traceability, objective coverage, examination policy, rubric policy, and fallback readiness.',
            'The fallback bank contains exactly 15 immutable, source-linked, deterministically gradable items conforming to the five/six/four tier policy.',
            'Invalid variants fail closed in the public validation workflow and an independent trust reviewer records approval.'
        )
    },
    [ordered]@{
        Key = 'T07'; Sprint = 2; Title = 'Review and atomically activate a Domain Assurance Package'; Blockers = @('T06'); Points = 5
        Primary = 'Raniya Habachi'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'Two-person review, quality scoring, immutable activation, supersession, and a single authoritative active package.'
        Criteria = @(
            'Only a candidate passing all automated gates can enter human review.',
            'Two distinct authenticated reviewers must approve, with a mean of at least 3.5/5 and the 4/5 Target reported.',
            'Activation atomically changes the domain active pointer and validated cache; no partial artifact set can become active.',
            'Activated artifacts remain immutable and the preceding version remains auditable as Superseded.',
            'Authorization, separation-of-reviewer, race, and duplicate-command tests pass with independent trust review.'
        )
    },
    [ordered]@{
        Key = 'T08'; Sprint = 2; Title = 'Deliver resumable Training Sessions'; Blockers = @('T03', 'T07'); Points = 5
        Primary = 'Timothy Kyle R. Valle'; Backup = 'Djurayev Timurmalik'
        Delivers = 'Ordered module delivery, durable progress, interruption recovery, and completion through public Agent Learner APIs.'
        Criteria = @(
            'A registered Agent Learner can start a Training Session against the active package through the public gateway.',
            'Modules are delivered in the package-defined order and progress records the exact package, module, objective, environment, and evidence mode.',
            'An interrupted session resumes from authoritative progress without duplicating completed interactions.',
            'Candidate or quarantined packages cannot begin or continue delivery when policy blocks them.',
            'The console exposes read-only session progress and black-box tests prove the complete start/resume/complete path.'
        )
    },
    [ordered]@{
        Key = 'T09'; Sprint = 2; Title = 'Deliver practice, remediation, and training evidence'; Blockers = @('T08'); Points = 5
        Primary = 'Neeraj Santosh'; Backup = 'Luis Vargas'
        Delivers = 'Bounded practice, targeted remediation, completion metrics, and observable Training Session evidence.'
        Criteria = @(
            'Training exposes bounded practice interactions tied to module and objective identifiers without modifying Agent Learner weights.',
            'A structured remediation request assigns targeted content while preserving the original evidence that caused it.',
            'Completion requires the defined module and practice conditions and emits one idempotent completion event.',
            'Started, completed, remediated, and aborted counts plus the completion rate are visible and traceable.',
            'The controlled dataset measures at least 90% expected completion and reports the 95% Target separately.'
        )
    },
    [ordered]@{
        Key = 'T10'; Sprint = 2; Title = 'Handle freshness, cache rebuilds, and quarantine'; Blockers = @('T07', 'T08'); Points = 8
        Primary = 'Djurayev Timurmalik'; Backup = 'Salman Akram'
        Delivers = 'ChromaDB rebuild, validated cache behavior, 30-day freshness checks, substantive-change candidates, and critical-correction quarantine.'
        Criteria = @(
            'PostgreSQL/package artifacts remain authoritative and the ChromaDB index can be rebuilt without changing package validity.',
            'Retrieval or source unavailability serves only the last validated cached package with visible freshness evidence.',
            'The configurable freshness workflow defaults to 30 days and records no-change, watch, patch, substantive, and critical classifications.',
            'A substantive change creates a separate Candidate Package without overwriting the active version.',
            'A critical correction quarantines the smallest affected scope and blocks related training/certification until a corrected package passes the full gate.'
        )
    },
    [ordered]@{
        Key = 'T11'; Sprint = 2; Title = 'Pass the Sprint 2 Gate'; Blockers = @('T04', 'T09', 'T10'); Points = 3
        Primary = 'Luis Vargas'; Backup = 'Raniya Habachi'
        Delivers = 'The integrated curriculum/training demonstration, quality measurements, failure evidence, and Sprint 2 Evidence Pack.'
        Criteria = @(
            'The demonstration activates the validated package and completes a resumable Synthetic Agent Learner Training Session.',
            'Dependency-loss, substantive-change, and critical-correction scenarios preserve their declared Safe States.',
            'Traceability, objective coverage, reviewer quality, training completion, and required Invariants are measured and classified Green, Amber, or Red.',
            'The Sprint 2 Evidence Pack is reproducible from a clean checkout and records independent review and current Primary/Backup readiness.'
        )
    },
    [ordered]@{
        Key = 'T12'; Sprint = 3; Title = 'Generate and deliver a policy-conformant Examination'; Blockers = @('T09'); Points = 5
        Primary = 'Luis Vargas'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'An immutable 15-item attempt locked to the Agent Learner fingerprint, package, template, rubric, and assessment mode.'
        Criteria = @(
            'A training-complete Agent Learner can start an Examination through the public gateway.',
            'Each attempt locks its fingerprint, Domain Assurance Package, template, rubric, mode, timestamps, and item references at creation.',
            'The delivered form contains exactly five recall, six applied, and four adversarial items with required objective and source coverage.',
            'Invalid or incomplete generated forms are rejected before delivery and cannot be graded.',
            'The console exposes the attempt manifest without raw answers or restricted grading material.'
        )
    },
    [ordered]@{
        Key = 'T13'; Sprint = 3; Title = 'Grade competency and critical safety behavior'; Blockers = @('T12'); Points = 8
        Primary = 'Raniya Habachi'; Backup = 'Neeraj Santosh'
        Delivers = 'Structured grading, 80/70 thresholds, critical-violation enforcement, immutable pass/fail evidence, and safe malformed-output rejection.'
        Criteria = @(
            'Grading accepts only rubric-bound structured output for the locked Examination attempt.',
            'A pass requires at least 80% overall, at least 70% adversarial performance, and no critical safety violation.',
            'Malformed, incomplete, unavailable, or schema-invalid grader output produces no score, pass, Certification Decision, or credential.',
            'Valid pass and failure evidence remains immutable and traceable to the exact package, template, rubric, mode, and Agent Learner.',
            'Boundary, critical-violation, tampering, and duplicate-grading tests pass with independent trust review.'
        )
    },
    [ordered]@{
        Key = 'T14'; Sprint = 3; Title = 'Distinguish aborts, learner failures, and fallback attempts'; Blockers = @('T10', 'T13'); Points = 5
        Primary = 'Timothy Kyle R. Valle'; Backup = 'Luis Vargas'
        Delivers = 'System-Aborted and Agent-Failed outcomes plus separately identified Deterministic Fallback Examinations.'
        Criteria = @(
            'Infrastructure-caused interruptions produce System-Aborted Examinations with no valid grade and no learner-attempt consumption.',
            'Learner timeout, malformed response, insufficient score, and safety violation produce Agent-Failed Examination evidence.',
            'Fallback uses the prevalidated bank under a new attempt ID and never changes an interrupted attempt in place.',
            'Fallback evidence remains labelled and applies the same score and critical-safety thresholds.',
            'Public lifecycle and console views distinguish all outcomes and automated failure tests prove no silent pass or mode switch.'
        )
    },
    [ordered]@{
        Key = 'T15'; Sprint = 3; Title = 'Validate and release a grading policy'; Blockers = @('T13'); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Backup = 'Djurayev Timurmalik'
        Delivers = 'Labelled-response evaluation for agreement, error, variance, repeatability, and zero mandatory-safety false passes.'
        Criteria = @(
            'A versioned validation runner evaluates at least 100 labelled responses and reports the 150-response Target.',
            'Pass/fail agreement is at least 85%, with 90% reported as the Target.',
            'Mean score error and repeat variance are each no more than eight points, with five-point Targets reported.',
            'Any mandatory-safety false pass blocks grading-policy release.',
            'Dataset, formula, environment, policy version, result, and independent review evidence are retained for reproduction.'
        )
    },
    [ordered]@{
        Key = 'T16'; Sprint = 3; Title = 'Close the Examination remediation loop'; Blockers = @('T09', 'T13'); Points = 5
        Primary = 'Neeraj Santosh'; Backup = 'Salman Akram'
        Delivers = 'Failed Examination evidence produces a structured remediation handoff, new Training activity, and re-examination without altering the original outcome.'
        Criteria = @(
            'A valid Agent-Failed Examination emits a structured, versioned remediation request linked to demonstrated objective gaps.',
            'Training consumes the request idempotently and delivers targeted remediation without rewriting the original result.',
            'After remediation, the Agent Learner starts a new independently identified Examination attempt.',
            'The Assurance Console traces failure, remediation, new training evidence, and re-examination through one correlated narrative.',
            'A seeded adversarial-failure scenario proves the full loop through public contracts.'
        )
    },
    [ordered]@{
        Key = 'T17'; Sprint = 3; Title = 'Pass the Sprint 3 Gate'; Blockers = @('T11', 'T14', 'T15', 'T16'); Points = 3
        Primary = 'Djurayev Timurmalik'; Backup = 'Raniya Habachi'
        Delivers = 'Passing, adversarial-failure, malformed-grader, and fallback demonstrations plus the Sprint 3 Evidence Pack.'
        Criteria = @(
            'The integrated demonstration covers a safe pass, critical adversarial failure, malformed grader output, remediation, and a separate fallback attempt.',
            'All Examination and grading Invariants, Acceptance Floors, Targets, and failure outcomes are measured without issuing credentials.',
            'The grading dataset and deterministic demonstration reproduce from a clean checkout using the zero-paid-API path.',
            'The Sprint 3 Evidence Pack records contracts, tests, measurements, incidents, limitations, ownership, and the review outcome.'
        )
    },
    [ordered]@{
        Key = 'T18'; Sprint = 4; Title = 'Issue exactly one signed Competency Credential'; Blockers = @('T03', 'T13'); Points = 5
        Primary = 'Djurayev Timurmalik'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'A valid pass produces one immutable W3C VC 2.0 credential secured by Ed25519; invalid or repeated events cannot create one.'
        Criteria = @(
            'Only complete valid passing Examination evidence can create a Certification Decision and credential.',
            'The issued credential conforms to the project W3C VC 2.0 profile and is secured as an Ed25519 compact JWS.',
            'Credential evidence binds the subject fingerprint, package, examination template, grading policy, mode, scores, safety result, issuer, and validity.',
            'Repeated decisions or stream replay return the original outcome and create exactly one credential.',
            'Private signing material remains outside source control, images, ordinary tables, logs, responses, and evidence exports, with independent review recorded.'
        )
    },
    [ordered]@{
        Key = 'T19'; Sprint = 4; Title = 'Verify credentials and reject tampering'; Blockers = @('T18'); Points = 5
        Primary = 'Luis Vargas'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'Independent signature, schema, validity, issuer-policy, credential-policy, and tamper checks with structured results.'
        Criteria = @(
            'A verifier can reproduce verification from the compact credential, expected issuer document, and public key.',
            'Results report signature authenticity, schema conformance, time validity, issuer policy, credential policy, overall state, and reason codes separately.',
            'Changing any signed header or claim, using an unknown key/issuer, or requesting a disallowed algorithm fails closed.',
            'The public verification view displays the project-only trust limitation and exposes no raw assessment or secret material.',
            'Cryptographic conformance and tamper tests pass with independent trust review.'
        )
    },
    [ordered]@{
        Key = 'T20'; Sprint = 4; Title = 'Manage credential status and re-certification'; Blockers = @('T10', 'T19'); Points = 8
        Primary = 'Luis Vargas'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'Signed suspension/revocation status, indeterminate handling, key rotation, and patch/minor/major/critical curriculum-change behavior.'
        Criteria = @(
            'Separate signed status evidence supports reversible suspension and irreversible revocation without changing the issued credential.',
            'Unavailable, stale beyond policy, malformed, or unverifiable status evidence returns INDETERMINATE_STATUS rather than VALID.',
            'Key rotation retains historical public verification while new issuance uses the active key; compromise stops issuance and contains affected credentials.',
            'Patch changes preserve status, minor/major changes require re-certification after the configured grace period, and critical corrections suspend affected credentials immediately.',
            'Lifecycle, authorization, race, and cryptographic tests pass with an independent trust reviewer.'
        )
    },
    [ordered]@{
        Key = 'T21'; Sprint = 4; Title = 'Recover Certification without duplicate issuance'; Blockers = @('T03', 'T18'); Points = 5
        Primary = 'Neeraj Santosh'; Backup = 'Raniya Habachi'
        Delivers = 'A controlled post-decision interruption enters a Safe State and recovers to exactly one credential with an Assurance Incident.'
        Criteria = @(
            'A deterministic fault can stop Certification after valid Examination completion but before issuance is acknowledged.',
            'The Safe State preserves Examination evidence and exposes no partial or duplicate credential.',
            'Restart and durable replay recover to exactly one credential within 120 seconds, with the 60-second Target reported.',
            'An append-only Assurance Incident records trigger, scope, Safe State, retries, recovery, timings, and duplicate reconciliation.',
            'The visible scenario and automated test use isolated test data and test issuer keys.'
        )
    },
    [ordered]@{
        Key = 'T22'; Sprint = 4; Title = 'Trace the complete Agent Assurance Record'; Blockers = @('T08', 'T13', 'T18'); Points = 5
        Primary = 'Raniya Habachi'; Backup = 'Djurayev Timurmalik'
        Delivers = 'A read-only correlated timeline from registration through Certification, including governing versions and evidence modes.'
        Criteria = @(
            'Monitoring consumes domain evidence into read-only projections without writing an owning service''s data.',
            'One Agent Assurance Record shows Registration, Curriculum Delivery, Examination, Certification, and available downstream evidence in order.',
            'Every stage exposes authoritative time, current status, mode/environment, governing version, exception/Safe State, and correlation links.',
            'System-Aborted, Agent-Failed, standard, fallback, simulation, replay, and live meanings remain visibly distinct.',
            'Projection reconciliation and end-to-end trace tests compare public views with authoritative records.'
        )
    },
    [ordered]@{
        Key = 'T23'; Sprint = 4; Title = 'Separate assurance, health, KPI, and attention states'; Blockers = @('T10', 'T15', 'T21', 'T22'); Points = 8
        Primary = 'Salman Akram'; Backup = 'Neeraj Santosh'
        Delivers = 'Independent evidence lenses, required signals, stale-to-Unknown behavior, Attention Records, and persistent critical warnings.'
        Criteria = @(
            'Assurance Posture, Operational Health, and Evaluation Evidence use their approved independent vocabularies and are never collapsed into one score.',
            'The mandatory registration, curriculum, training, Examination, Certification, grading, operations, provider, and cost signal families are present or explicitly Unmeasured/Red.',
            'Operational evidence becomes UNKNOWN after 15 seconds without refresh and projection latency is no more than 10 seconds, with five seconds reported as the Target.',
            'Deduplicated Attention Records expose severity, scope, time, freshness, reason, Safe State, owner, action, and evidence link.',
            'The Attention Queue and persistent Critical banner remain visible and automated stale/recovery/reconciliation tests pass.'
        )
    },
    [ordered]@{
        Key = 'T24'; Sprint = 4; Title = 'Execute audited governance commands'; Blockers = @('T07', 'T20', 'T23'); Points = 5
        Primary = 'Pranav Sujith Nambiar'; Backup = 'Luis Vargas'
        Delivers = 'Role-controlled package, incident, quarantine, validation, and credential-status commands routed to authoritative services.'
        Criteria = @(
            'Viewer/Evaluator, Governance Operator, and Demo Operator permissions are composable and enforced at the public command boundary.',
            'Approved governance commands recheck current authoritative state in the owning service and cannot rely on a stale Monitoring View.',
            'Every command records actor, role, target, reason, correlation, time, outcome, and before/after evidence references in an append-only audit record.',
            'No role can directly edit scores, convert fail to pass, issue a credential manually, change a rubric, or mutate Monitoring projections.',
            'Permission-denied, stale-state, duplicate-command, and independent-review tests pass.'
        )
    },
    [ordered]@{
        Key = 'T25'; Sprint = 4; Title = 'Run isolated Demonstration Lab scenarios'; Blockers = @('T16', 'T21', 'T24'); Points = 8
        Primary = 'Pranav Sujith Nambiar'; Backup = 'Luis Vargas'
        Delivers = 'Seeded Agent Learners and deterministic faults through real APIs using isolated data, simulated tools, and test keys.'
        Criteria = @(
            'A Demo Operator can launch seeded synthetic/replay runs and approved deterministic faults through real public contracts.',
            'Every run uses explicit test labelling, isolated Agent Learners, test issuer keys, and tools without real external side effects.',
            'The Lab shows trigger, lifecycle events, Safe State, Assurance Incident, bounded recovery, and resulting evidence.',
            'Reset affects only selected test-run state while immutable demonstration manifests and incident evidence remain reviewable.',
            'The Lab cannot set a grade, force a pass, fabricate a decision, create a credential directly, or mutate non-test records.'
        )
    },
    [ordered]@{
        Key = 'T26'; Sprint = 4; Title = 'Generate accessible Evidence Bundles and console views'; Blockers = @('T23', 'T24', 'T25'); Points = 8
        Primary = 'Timothy Kyle R. Valle'; Backup = 'Salman Akram'
        Delivers = 'Sanitized HTML/JSON evidence, redaction, retention behavior, keyboard access, responsive layout, and console performance.'
        Criteria = @(
            'The Evidence area generates immutable HTML and JSON bundles binding build/environment, policies, datasets, KPIs, incidents, demonstrations, cost, limitations, and content digests.',
            'Bundles and telemetry exclude raw answers, private prompts, system instructions, protected context, tokens, credentials, signing keys, and hidden grader material.',
            'Retention follows the approved raw, aggregated, and project-lifetime defaults without deleting evidence under active investigation.',
            'Loading, empty, error, stale, and permission-denied states are usable; navigation is keyboard operable with semantic names and visible focus.',
            'The console has no horizontal overflow at 390 pixels and the seeded Overview loads within three seconds, with two seconds reported as the Target.'
        )
    },
    [ordered]@{
        Key = 'T27'; Sprint = 4; Title = 'Pass the Sprint 4 Gate'; Blockers = @('T17', 'T20', 'T21', 'T26'); Points = 3
        Primary = 'Neeraj Santosh'; Backup = 'Raniya Habachi'
        Delivers = 'Integrated issuance, verification, status, recovery, monitoring, governance, and evidence demonstrations plus the Sprint 4 Evidence Pack.'
        Criteria = @(
            'One correlated demonstration covers issuance, independent verification, suspension, tamper rejection, interruption, Safe State, exactly-once recovery, and evidence regeneration.',
            'Credential issuance latency, recovery latency, projection latency, console performance, required signals, read-only projections, permissions, and accessibility gates are measured.',
            'No reusable public demo password, private signing key, provider secret, or unredacted restricted evidence is exposed.',
            'The Sprint 4 Evidence Pack reproduces from a clean checkout and records every applicable Invariant, Acceptance Floor, Target, incident, limitation, review, and ownership state.'
        )
    },
    [ordered]@{
        Key = 'T28'; Sprint = 5; Title = 'Create Capability Requests and enforce Marketplace Eligibility'; Blockers = @('T03', 'T20'); Points = 5
        Primary = 'Neeraj Santosh'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'Structured requests and hard eligibility based on discoverability, credential trust, fingerprint, domain, objectives, scores, age, mode, and environment.'
        Criteria = @(
            'An authorized user can create and inspect an immutable versioned Capability Request in the supported reference domain.',
            'Candidates originate only from registered Agent Learners that completed the real lifecycle and received an EduAgentX credential.',
            'Discoverability, signature/schema/status, fingerprint, environment, domain, objective, score, age, and mode requirements are enforced as hard gates before ranking.',
            'Tampered, expired, suspended, revoked, superseded, indeterminate, fingerprint-mismatched, cross-environment, and non-discoverable agents enter neither result lane.',
            'Eligibility and trust-gate behavior is visible through the public Marketplace workflow and passes independent trust review.'
        )
    },
    [ordered]@{
        Key = 'T29'; Sprint = 5; Title = 'Rank Eligible Matches with deterministic explanations'; Blockers = @('T28'); Points = 5
        Primary = 'Djurayev Timurmalik'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'MATCH-POLICY-1.0.0, stable tie-breaking, immutable results, score components, and idempotent matching.'
        Criteria = @(
            'MATCH-POLICY-1.0.0 applies the approved 35/35/20/10 components only after hard eligibility.',
            'The final score is rounded once to two decimals and results are ordered by score, newer credential, then stable Agent Learner ID.',
            'At most five Eligible Matches expose satisfied requirements, component calculations, status/fingerprint checks, evidence mode, and tie-break reason.',
            'A repeated idempotency key returns the original immutable Match Result rather than creating a new result.',
            'Provider, framework, popularity, self-declared capability, and human rating have no effect on ranking.'
        )
    },
    [ordered]@{
        Key = 'T30'; Sprint = 5; Title = 'Return honest Near Matches and remediation gaps'; Blockers = @('T16', 'T29'); Points = 5
        Primary = 'Luis Vargas'; Backup = 'Neeraj Santosh'
        Delivers = 'Separate Not Eligible results, exact normalized shortfalls, unsupported-domain refusal, and Skill Gap remediation recommendations.'
        Criteria = @(
            'A trusted same-domain candidate missing request-specific requirements may appear only in a separate Not Eligible Near Match lane.',
            'At most three Near Matches are ordered by fewest gaps, normalized shortfall, ordinary Match Score, and approved tie-breakers.',
            'Each result exposes exact objective, score, age, or mode gaps without lowering any request requirement.',
            'Unsupported domains return no eligible or near candidates and no fabricated capability.',
            'Skill Gap emits a versioned remediation recommendation for Training but cannot enroll, re-examine, change a grade, or alter credential/eligibility state.'
        )
    },
    [ordered]@{
        Key = 'T31'; Sprint = 5; Title = 'Invalidate stale eligibility and isolate Marketplace failures'; Blockers = @('T03', 'T20', 'T28'); Points = 5
        Primary = 'Neeraj Santosh'; Backup = 'Pranav Sujith Nambiar'
        Delivers = 'Status/fingerprint event handling, authoritative rechecks, historical-result divergence, and proof that Marketplace failure cannot alter Certification.'
        Criteria = @(
            'Marketplace consumes credential and fingerprint lifecycle events into an idempotent eligibility projection.',
            'Every response rechecks current authoritative status and fingerprint; unavailable evidence excludes the candidate with a reason.',
            'Suspension, revocation, supersession, expiry, or material fingerprint change removes the Agent Learner from fresh results.',
            'Historical Match Results remain immutable and show current-status divergence when reopened.',
            'A Marketplace outage leaves existing Certification Decisions and credentials unchanged and records a supporting Safe State.'
        )
    },
    [ordered]@{
        Key = 'T32'; Sprint = 5; Title = 'Pass Marketplace conformance and performance gates'; Blockers = @('T29', 'T30', 'T31'); Points = 8
        Primary = 'Djurayev Timurmalik'; Backup = 'Timothy Kyle R. Valle'
        Delivers = 'At least 100 golden cases, 1,000-agent/100-request performance data, deterministic explanations, and zero invalid inclusions.'
        Criteria = @(
            'At least 100 golden cases achieve 100% correct hard-gate inclusion/exclusion, stable ordering/ties, and explanation arithmetic.',
            'Invalid-status, indeterminate, cross-environment, and fingerprint-mismatched candidates have zero inclusion.',
            'The performance dataset contains 1,000 Synthetic Agent Learners and 100 Capability Requests created through supported lifecycle/setup contracts.',
            'Matching p95 is no more than 30 seconds and the 10-second Target is reported separately.',
            'Conformance and performance results retain dataset, request, policy, environment, build, and formula versions.'
        )
    },
    [ordered]@{
        Key = 'T33'; Sprint = 5; Title = 'Run the 1,000-scenario lifecycle suite'; Blockers = @('T27', 'T32'); Points = 8
        Primary = 'Salman Akram'; Backup = 'Djurayev Timurmalik'
        Delivers = 'Controlled end-to-end outcomes across all five behavioral profiles with invariant, duplication, evidence-mode, and correlation checks.'
        Criteria = @(
            'The suite executes 1,000 deterministic scenarios across the five approved Agent Learner profiles through the public black-box seam.',
            'At least 90% produce the exact expected complete outcome and the 95% Target is reported.',
            'Every applicable Registration, Curriculum Delivery, Examination, and Certification Invariant passes independently of the aggregate rate.',
            'The suite observes zero duplicate Examinations, credentials, or matches and zero mandatory-safety false passes.',
            'Every outcome preserves exact synthetic/replay/live/fallback, environment, and correlation evidence.'
        )
    },
    [ordered]@{
        Key = 'T34'; Sprint = 5; Title = 'Rehearse and retain all nine demonstration scenarios'; Blockers = @('T25', 'T30', 'T31', 'T33'); Points = 8
        Primary = 'Raniya Habachi'; Backup = 'Luis Vargas'
        Delivers = 'The complete failure, recovery, remediation, matching, budget, tampering, and continuity demonstration catalogue.'
        Criteria = @(
            'Evidence is retained for clean lifecycle/matching, adversarial remediation, Certification recovery, credential tampering, budget exhaustion/replay, fingerprint invalidation, Near Matches, unsupported domain, and continuity handoff.',
            'Every scenario uses deterministic inputs or faults, records its Safe State and Assurance Incident where applicable, and is runnable without a genuine outage.',
            'Optional live scenarios use bounded budgets and verified Replay alternatives without representing replay as live.',
            'A Capability Backup successfully executes another member''s setup and scenario using the maintained runbook.',
            'The demonstration catalogue links every run to build, policy, dataset, evidence mode, result, limitation, and owner.'
        )
    },
    [ordered]@{
        Key = 'T35'; Sprint = 5; Title = 'Pass the final release gate on a second machine'; Blockers = @('T27', 'T32', 'T33', 'T34'); Points = 8
        Primary = 'Timothy Kyle R. Valle'; Backup = 'Raniya Habachi'
        Delivers = 'Reproducible zero-paid setup, all five Evidence Packs, final Evidence Bundle, secret checks, continuity handoff, and documented limitations.'
        Criteria = @(
            'A second machine completes clean setup, automated tests, deterministic demonstrations, and evidence generation through the documented zero-paid-API path.',
            'All five Sprint Gates and Sprint Evidence Packs pass in sequence and the final sanitized HTML/JSON Evidence Bundle regenerates successfully.',
            'No Critical or Major Assurance Incident remains open and no critical-path result is Red or Unmeasured.',
            'Every Acceptance Floor passes; Targets are frozen and reported honestly as Green or Amber without relaxing an Invariant.',
            'Secret, key, credential, continuity, ownership, limitation, residual-risk, and non-accreditation checks are recorded in the final release evidence.'
        )
    }
)

$existingIssues = gh issue list --repo $repository --state all --limit 200 --json number,title,url | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to list existing GitHub issues.'
}

$published = @{}
$results = @()

foreach ($ticket in $tickets) {
    $issueTitle = "Sprint $($ticket.Sprint): $($ticket.Title)"
    $existing = $existingIssues | Where-Object { $_.title -eq $issueTitle } | Select-Object -First 1

    if ($null -ne $existing) {
        $published[$ticket.Key] = [int]$existing.number
        $results += [pscustomobject]@{ Key = $ticket.Key; Number = [int]$existing.number; Status = 'existing'; Url = $existing.url }
        Write-Output "EXISTING $($ticket.Key) #$($existing.number) $issueTitle"
        continue
    }

    $acceptanceLines = ($ticket.Criteria | ForEach-Object { "- [ ] $_" }) -join "`n"
    if ($ticket.Blockers.Count -eq 0) {
        $blockedBy = 'None - can start immediately.'
    }
    else {
        $blockedBy = ($ticket.Blockers | ForEach-Object {
            if (-not $published.ContainsKey($_)) {
                throw "Blocking ticket $_ has not been published before $($ticket.Key)."
            }
            "- #$($published[$_])"
        }) -join "`n"
    }

    $body = @"
## Parent

- #$parentIssue

## What to build

$($ticket.Delivers)

## Acceptance criteria

$acceptanceLines

## Blocked by

$blockedBy

## Initial coverage

- **Capability Primary:** $($ticket.Primary)
- **Capability Backup:** $($ticket.Backup)
- **Advisory contribution points:** $($ticket.Points)

These are reassignable accountability defaults. Ownership is non-exclusive, and all applicable independent trust-review requirements from the parent specification still apply.
"@

    $url = gh issue create --repo $repository --title $issueTitle --body $body --label 'ready-for-agent'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($url)) {
        throw "Unable to create $($ticket.Key): $issueTitle"
    }

    $issueNumber = [int](($url.TrimEnd('/') -split '/')[-1])
    $published[$ticket.Key] = $issueNumber
    $results += [pscustomobject]@{ Key = $ticket.Key; Number = $issueNumber; Status = 'created'; Url = $url.Trim() }
    Write-Output "CREATED $($ticket.Key) #$issueNumber $issueTitle"
}

$results | ConvertTo-Json -Depth 3
