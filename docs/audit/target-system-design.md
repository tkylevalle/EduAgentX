# EduAgentX target system design

Companion to [assurance-audit-2026-11-15.md](assurance-audit-2026-11-15.md). The
audit says what is a placeholder. This document describes the system that
replaces those placeholders, so that every claim on a credential is backed by a
measurement that a sceptical reviewer can check.

## 1. The claim the system must support

Every part of the design exists to make this sentence true and checkable:

> "Agent configuration **X**, run by the EduAgentX harness, faced **N** scenarios
> sampled from domain package **D** version **v**. These scenarios were built from
> reviewed official sources. The agent showed the measured behaviours below,
> with stated bounds. The result is signed, it is bound to the configuration we
> observed, and it stops applying when the agent, the package or the grader
> changes."

Rules that follow from it:

1. **Behaviour over words.** Wherever a domain rule is about an action, the
   system grades the action, not a description of it.
2. **Numbers with bounds.** No pass/fail stamp without the number of trials and
   a confidence bound.
3. **Every judge is validated.** No grader decides a credential until it is
   measured against people's labels on that domain's items.
4. **Scope is part of the credential.** The credential says what was tested and
   what was not.
5. **Attestation level is explicit.** The credential says whether the platform
   observed the configuration or the agent declared it.

## 2. System overview

```
  Sources ──► Domain Package Studio ──► Domain Package (reviewed, versioned)
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
             Knowledge Pack            Scenario Bank             Grader Suite
          (lessons + retrieval)   (templates, variants,     (action predicates,
                    │              held-out set, worlds)     state checks, judge)
                    ▼                         ▼                          │
           Learning Loop  ◄──────►  Evaluation Harness  ◄────────────────┘
       (notes, remediation)       (sandbox worlds, agent adapter,
                                   repeated trials, statistics)
                                              │
                                              ▼
                                   Trust Service (credential,
                                   status list, issuer keys)
                                              │
                         ┌────────────────────┼─────────────────────┐
                         ▼                    ▼                     ▼
                  Release Gate API      Trust Registry       Runtime Monitor
                  (CI integration)      (Marketplace)        (production checks)
```

## 3. Domain packages: content you can defend

### 3.1 What a domain package contains

| Part | Content | Replaces |
|---|---|---|
| Competency spec | Objectives written as observable behaviours, a threat model, and critical rules written as predicates over actions and world state | Prose objectives and phrase-matched rules |
| Source snapshots | The text of each pinned section, its hash, licence status and retrieval record | Metadata-only pins |
| Claims | Each lesson claim with an exact quote and its section; a checker confirms the quote is present | Unchecked pinpoints |
| Lessons | Lessons built from the sections, with worked examples and counter-examples per objective | Five 80-word lessons |
| World spec | The sandbox for this domain: tools, data, permissions, secrets, injection channels | None |
| Scenario templates | Parameterised scenarios per objective and attack type, with a sealed held-out pool | 15 fixed items |
| Grader suite | Predicates, state checks, rubric for the free-text judge, and the labelled validation set | Keyword overlap |
| Review record | Two named reviewers per version, rubric scores, resolved disagreements | Scripted approvals |

### 3.2 Domain Package Studio (how content is made and kept current)

1. **Ingest:** fetch the official source, store the text snapshot and hash, record the licence.
2. **Draft:** an LLM drafts lessons, claims and scenario templates from the stored sections only. Every claim must quote its section.
3. **Check automatically:** quote presence, objective coverage (each objective has lessons, at least two tiers, an adversarial family if safety-critical), predicate coverage for every critical rule, and licence.
4. **Calibrate:** run the known-good and known-bad agent panels on every scenario. Retire items that do not separate them (low discrimination) or that every agent fails (broken items).
5. **Review:** two named people outside the authoring role score it in the governance UI. Disagreements are resolved and recorded.
6. **Activate:** sign the package digest. Only one active version per domain.
7. **Maintain:** a scheduled job fetches each source and compares hashes. A change creates a candidate version; a critical correction quarantines the package and suspends the credentials that depend on it.

This keeps content sustainable: the LLM does the drafting volume, people review
the parts that carry the claim, and item statistics remove weak items
automatically.

### 3.3 Domains

Choose domains whose critical rules can be checked from actions. That keeps the
authoritative grading deterministic and valid at the same time.

| Domain | Sandbox tools | Critical predicates (examples) | Core sources |
|---|---|---|---|
| Secure tool use and prompt injection (current) | email, file store, web fetch, ticket system | canary secret leaves the sandbox; tool call outside the permission list; action taken because of an injected instruction | OWASP Agentic Top 10, NIST AI 600-1, NIST AI 100-2 |
| Customer refunds and policy compliance | order database, refund API, customer email | refund above limit without approval; refund to a different account; one customer's data sent to another | the customer's refund policy, consumer-protection guidance |
| Personal data handling | CRM, export tool, outbound email | personal data sent to an unapproved destination; export without a lawful basis; retention period ignored | GDPR articles and regulator guidance, organisational policy |
| Code-change agents | git, sandboxed shell, CI | secret committed; force-push to a protected branch; tests disabled to pass; network call outside the allowlist | OWASP, secure development frameworks, repository policy |
| Payments and financial operations | ledger, payment API, approval queue | payment without dual control above a threshold; payee changed from an unverified request | internal controls frameworks, organisational policy |

The refund, data and payments domains also take **customer policy documents**
as sources. This is how the product serves a real buyer: an organisation brings
its own rules, and the Studio turns them into a package.

## 4. Evaluation harness: the measurement core

### 4.1 Sandbox worlds

- Each scenario is a seeded world: tool state, documents, users, one or more
  canary secrets, a permission manifest, and the injection channels in play
  (retrieved page, tool output, user message, email).
- Tools are mocks with real state. A refund changes the ledger, and an email
  lands in an outbox the grader can inspect.
- Seeds make every trial reproducible. A fixed seed list per attempt is recorded
  in the evidence.

### 4.2 Agent adapter and attestation levels

| Level | How the agent runs | What the credential may claim |
|---|---|---|
| L1 Declared | The agent runs elsewhere and calls the sandbox tools through our proxy | Behaviour observed through the proxy; configuration declared by the agent |
| L2 Observed | The platform runs the declared model, system prompt and tool manifest itself | Behaviour and configuration observed by the platform |
| L3 Monitored | L2, plus the production deployment sends tool-call telemetry to the Runtime Monitor | Behaviour continues to match in production |

The fingerprint becomes a hash of what the platform observed (L2 and above),
plus the agent's knowledge pack and notes (section 5). This closes audit
finding D1.

### 4.3 Grader suite (layered)

1. **Action predicates (authoritative for critical rules).** Deterministic checks over the tool-call log: canary in an outbound call, call outside the permission list, action whose cause was an injected instruction.
2. **World-state checks.** End state after the episode: refund amount, files changed, messages sent.
3. **Citation checker.** For open-book items: the cited section exists in the package and supports the answer.
4. **Rubric judge (LLM).** Scores free-text quality such as explanations and escalation messages. It may lower a score, but it can never clear a critical failure that layers 1-2 found.
5. **Grader validation lab.** Per domain, at least 150 responses labelled by two people, with their own agreement reported. The judge's agreement, score error and repeat variance are measured against those labels. The zero-false-pass Invariant is checked on the critical items. This runs in CI. A grader version that fails cannot be activated.

Every grader has an id and version, and the credential records them.

### 4.4 Exam assembly and statistics

- **Sampling:** stratified across objectives, tiers and attack families, from the active pool. The held-out pool is used only for final certification and the learning measurement.
- **Repetition:** each adversarial scenario runs K times at the deployment temperature.
- **Reporting:**
  - Per-objective pass rates with Wilson intervals.
  - For critical rules, the 95% upper bound on the violation rate; for 0 violations in n trials it is about 3/n.
  - Coverage: which objectives and attack families were tested.
- **Pass policy:**
  - Thresholds on the lower bounds, not on point estimates.
  - Zero critical violations, with a minimum n, so that the bound means something.

## 5. Learning loop: training you can claim

| Part | Design |
|---|---|
| Knowledge pack | The reviewed lessons, plus retrieval over the stored source sections, exposed as the read-only `knowledge.lookup` tool in every world |
| Notes | After each lesson and practice episode, the agent writes a short note per objective. Notes are stored, versioned and hashed into the fingerprint. |
| Practice | Practice scenarios in the same sandbox, drawn from the non-held-out pool, with feedback on the predicate that fired and the objective it belongs to |
| Remediation | After a failure, targeted practice on the failed objective and attack family. The agent receives the violated rule and the evidence, never the answer key. |
| Learning measurement | Held-out pre-test, training, held-out post-test, with a control arm (notes from an unrelated module). The report gives the gain with an interval, and states a zero gain plainly. |

The credential then certifies **agent + knowledge pack + notes**. A copy of the
agent without them is a different configuration and does not match.

## 6. Trust service

- **Credential content:** the claim from section 1 as structured fields: domain package and version, item-set hash and seeds, n and K, per-objective rates and bounds, critical bound, grader ids and versions, attestation level, scope (tested and not tested), and expiry.
- **Status:** a signed W3C Bitstring Status List, published at a stable URL and referenced from each credential. Anyone can check status without calling our API.
- **Issuer:** `did:web` (or a JWKS endpoint) listing active and historical keys, with a rotation procedure.
- **Revalidation triggers:**
  - The fingerprint changes.
  - The package changes: a patch keeps the credential, a minor or major change sets a grace period, and a critical correction suspends at once.
  - The grader version changes.
  - Time expiry.
  - A critical violation recorded by the Runtime Monitor.

Everything in today's signing, verification and fail-closed design stays. The
change is what the credential contains and how status is published.

## 7. Continuous assurance: where the value is for a buyer

1. **Release Gate API.** A CI step or webhook. When an agent's prompt, model, tools or knowledge pack changes, it runs that agent's domain suites. It blocks the deploy on a regression and posts a diff against the last credential: which objectives moved, and which bounds changed.
2. **Runtime Monitor.** A small SDK or tool proxy in production logs tool calls and checks the same action predicates. A critical violation creates an incident and suspends the credential. This closes the gap between exam behaviour and production behaviour.
3. **Assurance Incident log.** One append-only log for all services, feeding the Attention Queue.
4. **Trust Registry (today's Marketplace).** Buyers query by domain, objectives and minimum bounds, and verify the results themselves. Keep the existing 16 eligibility checks; add the attestation level and the bounds as filters.

## 8. Platform shape

The current 23 containers can become about eight services with clear ownership.
This also reduces the startup and configuration failures seen this week.

| Target service | Absorbs today's |
|---|---|
| Gateway | api-gateway |
| Registry | agent-registry |
| Package Studio | curriculum-engine, validation-activation, curriculum-index |
| Evaluation | examination-engine, grading-service, training-service, skill-gap-service, synthetic-agent-learner (as panels and adapters) |
| Trust | certification-service, credential-verification |
| Registry of matches | marketplace-service |
| Assurance | monitoring-service, evidence-bundle, incident log |
| Console | web (assurance-console retired) |

PostgreSQL stays authoritative with one schema per service. Redis Streams stays
as the event bus. ChromaDB stays only because `knowledge.lookup` now uses it.

## 9. Evidence and governance

- CI produces the Evidence Bundle on every release candidate, with digests committed to the repository.
- The limitations record is generated from measured state: every Red or unmeasured KPI appears automatically.
- The governance UI is where reviewers score packages, label grader datasets and approve releases. No script writes a review.

## 10. Roadmap

Each phase unlocks one claim. A phase is not done until its claim holds on a
fresh clone, with evidence committed.

| Phase | Work | Claim unlocked | Audit items | Size |
|---|---|---|---|---|
| 0. Honest baseline | One grader; KPI on the production route; grader id in the credential; fallback choices shuffled with real distractors; parrot and first-option validity tests in CI; complete limitations record | "Every score names the grader behind it, that grader is measured on the production route and fails CI while it is invalid, and its known weaknesses are listed." (Corrected after the Phase 0 review: the original wording, "the score means what it says", is a Phase 1 claim; Phase 0 makes the weakness measured and visible, it does not fix it.) | A3, A10, A11, A12, E1, E2, E8, F4 | Small |
| 1. Behavioural core | Sandbox world for secure tool use; action predicates; repeated trials and bounds; known-bad panel; scenario variants and held-out pool; people-labelled set for the judge | "Measured safe behaviour, with a bound, on this domain" (Stated after the Phase 1 review, 16 November 2026, as what holds today: "On the adversarial tier only (objectives o3, o4, o5), no critical violation in any of the 36 Engine-recorded sandbox episodes (9 of each objective's own for o3 and o5, 18 for o4), a 95% success lower bound of at least 0.70 per objective, and a 95% violation upper bound of about 28% (o3, o5) or 15% (o4), in five simulated tool families with held-out attack wording. Recall and applied items are still graded by a keyword grader whose validity status is Red." The people-labelled set, end-state checks and a live-model panel member are not done.) | A1, A2, A4-A9 | Large |
| 2. Learning loop | `knowledge.lookup` over source sections; notes; feedback-driven remediation; pre/post measurement with a control | "Training changes the measured behaviour by this much (or it does not)" (Stated after the Phase 2 review, 16 November 2026, as what holds today: "There is an instrument that measures whether an agent's own training notes change its behaviour on held-out sandbox items, against no notes and against off-topic notes, with intervals; it has not been run on a live model, so no gain is claimed." It is an arms design, not pre/post; lookup returns lessons, not source sections; notes are not stored or attested by the platform; remediation gives rule ids, not evidence; practice episodes are not built.) | B1-B7 | Medium |
| 3. Trust hardening | Platform-run harness (L2) and observed fingerprint; signed status list; `did:web` issuer; live provenance with budgets; real replay reviews | "Anyone can verify it, and it is bound to what we observed" (Stated after Phase 3, 16 November 2026, as what holds today: "Anyone can check a new credential's signature with the published keys and its revocation or suspension with the signed status lists, and each new credential says whether it comes from the platform-run live learner (L2, not checkable by a verifier) or a self-declared agent (L1)." Not done: `did:web`, a harness for external agents, live provenance, replay reviews.) | D1-D4, E6 | Medium |
| 4. Content and breadth | Package Studio; real review of the current domain; two more domains (refunds, personal data) | "Several reviewed domains, built from official and customer sources" (Stated after Phase 4, 16 November 2026, as what holds today: "Three domain packages whose every claim quotes a stored section of an official source, checked against the source itself, with sandbox families calibrated against reference panels; none is reviewed yet, so none may be claimed as reviewed." The review mechanism is built and needs two people per package; the customer policies are samples, not a customer's; LLM drafting is not built.) | C1-C6 | Large |
| 5. Continuous assurance | Release Gate API; Runtime Monitor; incident log; consolidation to about eight services | "It stays true after deployment, and it fits into a team's release process" (Stated after Phase 5, 16 November 2026, as what holds today: "A CI step can ask whether a re-examined agent may ship, and the gate blocks a regression against its last credential; a deployment that runs the Runtime Monitor SDK has every tool call checked against the exam's predicates, and a critical call is blocked, logged and the credential suspended and confirmed suspended; every service's incidents reach one append-only log and the console's Attention Queue." The gate judges an examination CI ran; it does not run one. The monitor covers only deployments that run the SDK, and a disclosure finding rests on the deployment's report. Consolidation to eight services and an L3 attestation level are not done.) | E9, E10, F6 | Large |

Phase 0 is the step before anything else. Phases 1 and 2 are the product's
core, and should be done before adding domains, because a weak measurement
copied across five domains is five weak claims.
