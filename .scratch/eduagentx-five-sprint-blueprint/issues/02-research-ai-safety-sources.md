# Establish the authoritative AI Agent Safety and Secure Tool Use source and freshness baseline

Type: research
Status: resolved
Blocked by: none

## Question

Which current primary standards, frameworks, and official technical sources should ground the AI Agent Safety and Secure Tool Use curriculum, and which change or age signals should cause EduAgentX to consider that curriculum stale?

## Comments

- Research artifact: [AI Agent Safety and Secure Tool Use source and freshness baseline](../research/ai-safety-source-baseline.md)

## Answer

Use a free, reviewable five-document core for the first validated curriculum:

1. NIST AI RMF 1.0 as the risk-management and trustworthiness spine.
2. NIST AI 600-1 for generative-AI risk families and actions.
3. OECD/LEGAL/0449 for AI lifecycle terminology and human-centred principles.
4. OWASP Top 10 for Agentic Applications 2026 for autonomous-agent risks.
5. NIST AI 100-2e2025 for adversarial-machine-learning terminology.

Use OWASP LLM Top 10 2026 and version-pinned MITRE ATLAS snapshots for scenarios rather than as the curriculum spine. Treat relevant ISO/IEC standards as an alignment layer unless the university provides lawful full-text access; EduAgentX must not claim ISO conformity or certification.

Organize AI Agent Safety and Secure Tool Use into five modules: systems/actors/impacts; lifecycle risk management; generative-AI failure modes; safe agent autonomy; and adversarial evaluation/response. AI Safety Fundamentals remains the conceptual foundation, while the reference track tests practical, observable behavior.

Every source, module, and exam item stores exact edition/snapshot and pinpoint provenance. Check freshness every 30 days by default, with faster checks for dynamic sources where practical. Classify changes as Critical, Substantive, Watch, Patch, or Non-substantive. Generate and validate a candidate version before atomic activation; never overwrite the active version. Keep the last validated cache active unless a critical correction requires quarantine.

The complete source analysis, module mapping, metadata contract, change signals, and acceptance criteria live in the linked research artifact.
