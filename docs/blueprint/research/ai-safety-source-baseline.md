# AI Agent Safety and Secure Tool Use: authoritative source and freshness baseline

**Research date:** 2026-08-13
**Scope:** A capstone-sized, globally applicable source corpus for EduAgentX's first fully validated curriculum. Only primary sources owned by standards bodies, governments, or the framework maintainer were used.

## Recommendation

Build the validated curriculum from a **five-document core** that is public, traceable, and small enough for seven students to review. AI Safety Fundamentals provides the conceptual base, but the track must assess observable safe-agent behavior: resisting hostile instructions, constraining tool use, protecting credentials and context, and stopping or escalating safely. Use fast-changing technical sources for scenarios, and treat paywalled ISO standards as an alignment layer unless the university already provides licensed access.

The core should be:

1. NIST AI RMF 1.0 for the risk-management structure and trustworthiness vocabulary.
2. NIST AI 600-1 for generative-AI risks and concrete risk-management actions.
3. OECD/LEGAL/0449 for international AI-system/lifecycle terminology and human-centred principles.
4. OWASP Top 10 for Agentic Applications 2026 for risks specific to autonomous, tool-using agents.
5. NIST AI 100-2e2025 for adversarial-ML attack and mitigation terminology.

This is enough to support five focused modules without presenting EduAgentX as an ISO conformity or regulatory certification scheme.

## Required source corpus

| Source | Current authoritative state on 2026-08-13 | Curriculum role | Freshness signal |
|---|---|---|---|
| [NIST AI 100-1, *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*](https://doi.org/10.6028/NIST.AI.100-1) | Final version 1.0, published 2023-01-26. NIST's live [AI RMF page](https://www.nist.gov/itl/ai-risk-management-framework) explicitly says that 1.0 is being revised, so 1.0 remains the teaching baseline but is on a revision watch. | Defines trustworthy characteristics and the Govern, Map, Measure, Manage risk-management cycle. It should be the organizing spine, not a checklist to memorize. | New final or draft revision; change to the four functions, trustworthiness characteristics, or defined outcomes; official erratum or withdrawal. A draft starts an impact review, while a superseding final makes the affected curriculum stale. |
| [NIST AI 600-1, *Generative Artificial Intelligence Profile*](https://doi.org/10.6028/NIST.AI.600-1) | Final, published 2024-07-26. NIST describes it as the cross-sector companion to AI RMF 1.0; the [official NIST technical-reports index](https://airc.nist.gov/technical-reports/) records 13 GAI risk families and more than 400 suggested actions. | Grounds lessons on confabulation, privacy, information integrity/security, harmful bias, human-AI configuration, value-chain risk, unsafe content and related mitigations. Authors should curate a small subset of actions that an agent can reason about, rather than reproduce all 400+. | New edition/profile; changes to named risk families or action IDs; new official errata; revision of AI RMF that changes the profile's parent concepts. |
| [OECD/LEGAL/0449, *Recommendation of the Council on Artificial Intelligence*](https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449) | In force; adopted 2019-05-22 and amended 2024-05-03. The legal instrument supplies current definitions of AI system, lifecycle, actors and stakeholders, plus five complementary principles for trustworthy AI. | Provides the global, human-centred foundation: human rights and democratic values, transparency/explainability, robustness/security/safety, accountability, inclusive growth and well-being. | `In force` status changes; a new `Amended on` date; modified definitions or principles; replacement or withdrawal of OECD/LEGAL/0449. |
| [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) | Current agentic edition, published 2025-12-09. Its ten entries are Agent Goal Hijack; Tool Misuse and Exploitation; Identity and Privilege Abuse; Agentic Supply Chain Vulnerabilities; Unexpected Code Execution; Memory and Context Poisoning; Insecure Inter-Agent Communication; Cascading Failures; Human-Agent Trust Exploitation; and Rogue Agents. The official guide describes risks and mitigations across agent workflows. | Supplies the agent-specific application and adversarial layer. Use the stable ASI01-ASI10 identifiers to build scenarios about least agency, scoped permissions, tool validation, memory integrity, observability and fail-safe stopping. | New year/edition; added, removed, renamed or reordered ASI identifiers; changed mitigation guidance; correction to the downloadable guide. |
| [NIST AI 100-2e2025, *Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations*](https://csrc.nist.gov/pubs/ai/100/2/e2025/final) | Latest final edition found, published 2025-03-24. NIST says it covers evasion, poisoning and privacy attacks for predictive AI, plus evasion, poisoning, privacy and misuse attacks for generative AI. The landing page also records a corrected PDF and a planning note/errata; NIST's [publication announcement](https://www.nist.gov/news-events/news/2025/03/nist-trustworthy-and-responsible-ai-report-adversarial-machine-learning) says it intends annual updates. | Standardizes adversarial terminology and teaches that mitigations have assumptions and limits. Select concepts relevant to deployed agents rather than teaching the complete taxonomy. | New annual edition; document-history change; corrected PDF or errata; attack-ID/taxonomy changes. PDF checksum matters because NIST has corrected the file without changing the publication identifier. |

### Why this bundle is suitable

- It is free to retrieve, avoiding a standards-purchase dependency under the project's limited budget.
- Each learning claim can cite a stable document identifier, URL and section/page.
- NIST supplies a consistent risk model; OECD supplies international normative principles; OWASP adds the agentic failure modes that generic AI governance documents do not yet cover in comparable detail.
- The bundle covers safety, security, human/societal impact, governance, testing and incident response without turning the fundamentals track into a legal-compliance course.

## Supporting sources: use for scenarios, not as the curriculum spine

| Source | Recommended use | Constraint |
|---|---|---|
| [OWASP GenAI LLM Top 10 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) | Add LLM-layer examples beneath the agentic risks. This is the latest OWASP LLM edition, published 2026-08-03, and it maps to NIST, MITRE ATLAS and the Agentic Top 10. | It was only ten days old on the research date. Have two team reviewers approve any newly introduced claims or exam questions before activation. Do not mix 2025 and 2026 risk identifiers in one curriculum version. |
| [MITRE ATLAS](https://atlas.mitre.org/) | Source realistic adversary tactics, techniques, mitigations and case studies. Reference stable `AML.*` identifiers in scenario metadata. | ATLAS calls itself a living knowledge base and now includes predictive, generative and agentic platforms. Snapshot the exact ATLAS data used; do not hard-code site-wide technique counts as learning outcomes. |
| [NIST SP 800-218A, *Secure Software Development Practices for Generative AI and Dual-Use Foundation Models*](https://csrc.nist.gov/pubs/sp/800/218/a/final) | Optional implementation lab for producer/system-builder responsibilities, supply-chain security and lifecycle controls. | It is a profile used with SSDF 1.1, not a complete standalone safety framework. Its parent SSDF has a newer revision in draft, so monitor both publication records before expanding this material. |

Academic papers, vendor safety policies, press reports and incident news can inspire examples, but should not become factual authorities in the validated core. If a scenario comes from a news report, the tested principle must still map to one of the authoritative sources above.

## ISO alignment layer

The following current ISO/IEC standards are relevant, but their full texts are paid. Official ISO pages confirm their scope and published status:

- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001): requirements for establishing and continually improving an AI management system.
- [ISO/IEC 23894:2023](https://www.iso.org/standard/77304.html): guidance for integrating AI risk management into organizational activities.
- [ISO/IEC 42005:2025](https://www.iso.org/standard/42005): AI system impact assessment across the lifecycle.
- [ISO/IEC 5338:2023](https://www.iso.org/standard/81118.html): AI-specific system lifecycle processes.

Recommendation: map the core curriculum to the public scope of these standards and to NIST's official [AI RMF crosswalk collection](https://airc.nist.gov/airmf-resources/crosswalks/). Only author detailed ISO-derived lessons if the university confirms lawful access for the team. Passing EduAgentX should never be described as ISO certification or conformity assessment.

## Proposed five-module curriculum map

| Module | Minimum learning outcomes | Primary evidence |
|---|---|---|
| 1. AI systems, actors and impacts | Identify system boundaries, lifecycle actors, affected stakeholders and plausible individual/organizational/societal harms. Distinguish safety, security, reliability, transparency and accountability. | OECD/LEGAL/0449; NIST AI RMF sections 1-3. |
| 2. Risk management throughout the lifecycle | Apply Govern, Map, Measure and Manage to a concrete agent use case; document context, impact, risk tolerance, test evidence and residual risk. | NIST AI RMF Core and the official [AI RMF Playbook](https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook). |
| 3. Generative-AI failure modes | Recognize confabulation, privacy and provenance failures, harmful bias, unsafe content, information-security/integrity and value-chain risks; choose proportionate controls and escalation. | NIST AI 600-1 selected risk sections and action IDs. |
| 4. Safe agent autonomy | Resist goal hijacking; constrain tool/credential scope; protect memory and inter-agent messages; identify cascading failure and rogue-agent conditions; stop safely when authorization or evidence is inadequate. | OWASP ASI01-ASI10, supported by the 2026 LLM Top 10. |
| 5. Adversarial evaluation and response | Classify representative attacks, explain mitigation limits, select pre-deployment and continuous tests, monitor behavior, respond to incidents and decommission safely. | NIST AI 100-2e2025; MITRE ATLAS scenarios; NIST AI RMF Measure/Manage. |

This map makes the 15-question exam blueprint practical: one recall item and at least one applied/adversarial item can be tied to each module, while the remaining questions can emphasize Modules 3-5.

## Freshness and change-control policy

### Source record

Every source snapshot should store at least:

```text
sourceId, issuer, title, documentIdentifier, editionOrVersion,
canonicalUrl, publicationDate, amendedDate, officialStatus,
retrievedAt, lastCheckedAt, lastValidatedAt, contentSha256,
etag, lastModified, affectedModuleIds, licenseBasis
```

Every generated curriculum chunk and exam item should additionally store `sourceId`, the exact edition/snapshot, and a page, section, action ID or threat ID. A generic URL without a pinpoint is not sufficient for the project's 100% traceability KPI.

### Check cadence

- Run the agreed **30-day default freshness check** for every required source. `lastCheckedAt` older than 30 days means `check_overdue`, not automatically "factually wrong."
- Check OWASP and MITRE weekly if the lightweight metadata/hash job is easy to operate; otherwise keep 30 days and always run a manual check within seven days of a demonstration or curriculum release.
- Subscribe to official NIST publication notices and ISO page RSS where practical. Notifications create a review ticket; they do not auto-publish content.

### Change signals and response

| Signal | Classification | EduAgentX response |
|---|---|---|
| Official withdrawal/supersession; a critical safety correction; a core claim is shown to be unsafe or materially false | Critical | Quarantine the affected active module and linked exam items immediately. Do not serve or certify that track until a corrected version passes the full curriculum-quality gate. Assess existing credentials under the agreed critical-correction policy. |
| New final edition or amendment; risk/attack IDs added, removed or semantically changed; definitions, principles, requirements or mitigations materially changed | Substantive | Mark the affected curriculum `review_required`; produce a candidate version; regenerate only impacted modules and exam items; require source traceability, objective coverage and human quality review before activation. Keep the last validated cached version active unless the change is critical. |
| Draft revision or formal announcement that revision work has started | Watch | Record the candidate source and affected objectives. Do not rewrite the active curriculum solely from a draft unless the team explicitly labels it provisional. NIST AI RMF 1.0 is in this state now. |
| Erratum/corrected PDF with no semantic learning change | Patch | Update the source snapshot, citation and hash after a reviewer verifies that learning objectives and scoring rubrics are unchanged. |
| HTML chrome, translation, navigation, typography or publication-page timestamp changes | Non-substantive | Update retrieval metadata only. Do not regenerate curriculum. |

### Detection rules

1. Compare the official identifier, edition/version, status and amended date before comparing text.
2. Hash the canonical PDF or normalized document body, not the whole HTML page; navigation and footer changes otherwise cause false positives.
3. Track official document history and errata separately from the DOI. NIST AI 100-2e2025 demonstrates why: its PDF was corrected while its identifier remained the same.
4. For OWASP, pin the year/edition and hash the downloadable guide. For ATLAS, save a dated data snapshot and diff stable tactic/technique IDs.
5. Map a detected change to `affectedModuleIds` and linked exam item IDs. Never refresh the entire track when only one cited section changed.

### Safe activation flow

```text
source check -> change classification -> impact map -> candidate curriculum
-> source/schema/duplication checks -> two-person content review
-> quality gate -> atomically activate new version -> retain old snapshot
```

The active curriculum must never be overwritten in place. If candidate generation or validation fails, the last validated cached version remains active except when a critical correction requires quarantine.

## Planning acceptance criteria

The Curriculum Engine work is credible when it can demonstrate all of the following:

- The five required sources are seeded with identifiers, versions, hashes and retrieval/validation dates.
- Every module and exam item has an exact, inspectable provenance pointer.
- A no-change check only advances `lastCheckedAt`.
- A simulated substantive change creates a candidate and `review_required` state without replacing the cached active version.
- A simulated critical correction prevents delivery/certification for the affected track.
- A validated candidate can be activated atomically and the prior version remains auditable.

## Immediate watch items

1. **NIST AI RMF revision:** the official page already says 1.0 is being revised. Record this on day one and watch for a draft or final replacement.
2. **OWASP LLM Top 10 2026:** it was released on 2026-08-03. Use 2026, not the 2025 list, but require deliberate review because it is new.
3. **NIST AI 100-2e2025:** apply its official planning note/errata and watch for the annual successor; no newer final edition was found as of 2026-08-13.
4. **Dynamic threat sources:** MITRE ATLAS and OWASP scenario material can change faster than governance standards. Pin snapshots so an exam remains reproducible even after the live taxonomy changes.
