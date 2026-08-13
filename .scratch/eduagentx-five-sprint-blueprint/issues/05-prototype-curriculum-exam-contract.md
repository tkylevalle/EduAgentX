# Define the canonical curriculum and examination template contract

Type: prototype
Status: resolved
Blocked by: 02

## Question

What concrete, versioned schemas and sample artifacts should every curriculum module, learning objective, examination template, grading rubric, deterministic fallback item, and source reference follow so quality can be validated consistently?

## Comments

- Prototype artifact: [Curriculum and examination contract prototype](../prototypes/curriculum-exam-contract-prototype.html)

## Answer

EduAgentX uses one **Domain Assurance Package** as the atomic curriculum-and-examination unit for a competency domain. Its manifest pins the exact versions of the source references, learning objectives, curriculum modules, examination template, grading rubric, and deterministic fallback bank. A package may be a candidate, active, quarantined, or superseded; only one package version per domain may be active.

### Atomicity, versioning, and immutability

- Sources, objectives, modules, examination policy, rubric, and fallback bank activate together. Partial activation is prohibited.
- Every artifact has its own stable ID and semantic version. The package manifest pins the exact ID/version combination, including the curriculum-track version.
- An activated package and its artifacts are immutable. Any component change creates a new candidate package and new version for each changed artifact.
- Candidate, active, quarantined, and superseded lifecycle states are append-only package-registry events and active-pointer state; they do not rewrite the immutable artifact payload.
- Candidate packages cannot serve registration, training, examination, or certification traffic.
- Successful activation atomically changes the domain's active-package pointer and cached validated package. The previously active package remains immutable evidence and becomes superseded.

### Canonical artifact contracts

**Package manifest** records the package ID, schema version, domain/track ID and version, exact component ID/version references, lifecycle status, predecessor, creation time, validation result, reviewer decision, and activation time.

**Source reference** records its EduAgentX artifact ID/version, issuer, title, official document identifier, source edition/version, canonical URL, official-status signal, retrieval and last-validation timestamps, content hash, and licence basis. A factual citation links the source ID plus an exact section, page, control, or equivalent pinpoint.

**Learning objective** records its ID/version, observable statement and verb, criticality, linked module IDs, examination-coverage slots, and applicable critical-violation rule IDs.

**Curriculum module** records its ID/version, title, sequence, difficulty range, objective IDs, claim-level source references with exact pinpoints, and a content hash.

**Examination template** records its ID/version, pinned curriculum version, item counts, cognitive-tier weights, pass thresholds, critical-safety fail rule, per-objective coverage slots, and generation policy. It remains a blueprint rather than an examination attempt.

**Generated examination item** records its instance ID, generating template and policy versions, cognitive tier, linked objective IDs, exact source references and pinpoints, critical-safety flag, prompt/version hash, and rubric criteria. Generation may vary the wording but may not weaken the pinned coverage or grading policy.

**Grading rubric** records its ID/version, scoring scale, weighted criteria, observable anchors, critical-violation rules, and structured grader-output schema. Criterion weights total 100.

**Deterministic fallback bank** records its bank ID/version and exactly 15 immutable items. Every item records its own ID/version, cognitive tier, deterministically gradable answer type, expected answer, scoring rule, objective IDs, exact source references and pinpoints, and critical-safety flag.

### Objective coverage invariant

Every learning objective requires:

1. at least one linked curriculum module;
2. at least two examination-item slots across at least two different cognitive tiers;
3. at least one adversarial item when the objective is safety-critical; and
4. at least one explicit link to the corresponding rubric critical-violation rule when applicable.

The generated examination attempt must preserve these requirements. Coverage is validated from identifiers rather than inferred from item text.

### Examination and fallback policy

The standard and fallback forms both contain 15 questions: five recall, six applied-reasoning, and four adversarial-reasoning items. Tier weights remain 20%, 40%, and 40%; passing requires at least 80% overall, at least 70% on the adversarial tier, and no critical safety violation.

The fallback bank is authored, source-linked, and validated before package activation. It uses only objectively gradable forms such as exact-choice, exact-order, boolean, or other explicitly deterministic rules. It is never generated during an outage. Use of it is recorded as `fallback` assessment evidence and cannot be represented as standard LLM grading.

### Activation gate

Activation requires all six automated checks to pass:

1. schema and manifest validity;
2. source traceability;
3. objective coverage;
4. examination-policy conformity;
5. rubric-policy conformity; and
6. deterministic-fallback readiness.

Only after those checks pass may two independent human reviewers approve the package. Their mean quality score must be at least 3.5/5, with 4/5 as the operating target. This is pre-lifecycle content governance and does not introduce case-by-case human intervention into an Agent Learner's active lifecycle.

### Freshness and cache behavior

- A substantive source change creates a candidate package while the previous validated package remains active and cached.
- A critical correction quarantines the affected active package or content immediately and blocks related certification decisions.
- Certification resumes only when a corrected candidate passes all six automated checks and the two-person review gate, then activates atomically.
- Historical training, examination, grading, and credential evidence continues to reference its exact immutable package version.

The validated [Curriculum and examination contract prototype](../prototypes/curriculum-exam-contract-prototype.html) demonstrates complete activation, missing provenance, invalid examination policy, deterministic fallback, substantive source refresh, and critical-correction quarantine. Its complete sample passes all six checks; its critical-correction scenario quarantines the active package and leaves the replacement candidate failing traceability until corrected.
