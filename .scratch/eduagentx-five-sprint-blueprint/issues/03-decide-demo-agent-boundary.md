# Decide the synthetic and live Agent Learner demonstration boundary

Type: grilling
Status: resolved
Blocked by: none

## Question

What mixture of deterministic synthetic Agent Learners and optional live LLM-backed adapters provides credible evidence while preserving repeatability, affordability, and independence from external provider availability?

## Comments

## Answer

EduAgentX demonstrates Agent Learners through three explicitly labelled evidence modes:

1. **Synthetic** — deterministic, seeded learner responses with known expected outcomes; mandatory for repeatable testing and formal KPIs.
2. **Replay** — sanitized, versioned fixtures captured from prior provider/framework interactions; mandatory for repeatable integration and offline demonstrations.
3. **Live** — a newly generated response from an external or local model at run time; optional realism evidence and never required for EduAgentX to pass.

All modes use the same public, versioned `ExternalAgentLearner` protocol and the same registration, curriculum, training, examination, certification, and status APIs. No adapter may bypass the gateway or write directly to a database. EduAgentX keeps no model-provider allowlist: any authenticated client that satisfies the protocol, schemas, timeouts, payload limits, and rate limits may participate.

### Formal Evidence

The 1,000-scenario formal dataset contains 200 deterministic runs for each initial behavioral profile:

- competent and safety-aware;
- knowledgeable but vulnerable to adversarial instructions;
- partially competent and remediable;
- consistently underqualified; and
- malformed, inconsistent, timing-out, or unavailable.

Each profile has fixed inputs and known expected lifecycle outcomes. The distribution is an Initial Target and may be recalibrated only through the approved KPI process.

Formal lifecycle-reliability and grading-agreement KPIs use synthetic or controlled replay inputs with expected outcomes. Live results are reported separately as exploratory demonstration evidence because provider and model behavior can change. A live agent may still earn a credential by completing the same valid pipeline, but its evidence remains labelled `live`.

### Framework and Provider Boundary

[Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent) is the preferred first live reference adapter because its isolated profiles, configurable personalities/toolsets, multiple model providers, and authenticated OpenAI-compatible API suit the Agent Learner boundary. It remains optional: Hermes is one adapter, not an architectural dependency, and alternative frameworks or direct clients may implement the same protocol.

Hermes or another stochastic framework may instantiate analogous behavioral profiles for live evidence, but it does not replace the deterministic seeded harness. A live interaction may be recorded as a replay fixture after sanitization and versioning.

Every replay fixture records its provider/model or framework identifier, prompt-template version, request hash, sanitized response, capture timestamp, and fixture version. Replay mode must never be presented as live inference.

### Identity and Certification Binding

Registration records an agent-configuration fingerprint covering the declared model/provider version, system-prompt hash, approved tool manifest, policy/configuration hash, and adapter version. A material fingerprint change requires re-examination; a credential cannot silently transfer to a changed agent configuration.

Synthetic and replay runs issue only test credentials under a separate test issuer/key. They visibly carry `environment = simulation` and the applicable assessment mode. A live agent completing the full valid pipeline may receive a project demonstration credential.

### Sandbox and Safety

The first sandbox supports three capability categories, which later versions may expand:

- retrieving untrusted content;
- accessing protected information under explicit authorization; and
- requesting a state-changing action with safe confirmation or denial.

These categories may be implemented by one sandbox service or several simulated tools. No Agent Learner receives real email, files, credentials, infrastructure access, or external side effects.

During certification, every external framework uses an examination-specific restricted profile. For Hermes, the later specification must define how to disable terminal, host filesystem, unrestricted web access, persistent external memory, delegation, and unrelated MCP tools while exposing only approved EduAgentX sandbox tools. The exact framework configuration is deliberately deferred to specification/implementation.

### Live Demonstration and Cost Boundary

The final demonstration aims, when access and budget permit, to show three live cases:

1. a clean certification pass;
2. an adversarial failure followed by remediation and re-examination; and
3. a fail-closed unsafe-tool-use case.

Every live scenario has a verified replay fallback. If a provider fails during presentation, the system visibly changes mode to replay and never presents the replay as live.

Live inference means a provider or local model generates a fresh response during the current run. It is disabled by default and enabled with configurable per-run limits for calls, input/output tokens, runtime, and optional monetary spend. Reaching a limit ends the live run safely; it cannot fabricate an answer, modify a result, or create a pass.
