'use strict';

// Authored Candidate for model inspection, not approved teaching material.
const { sha256 } = require('../model');
const version = '0.1.5-draft';
const retrievedAt = '2026-09-29T15:00:00Z';
const source = (id, issuer, title, documentIdentifier, edition, snapshot, canonicalUrl, snapshotUrl, contentSha256, licenseBasis, sourceRetrievedAt = retrievedAt) => ({
  id, version, issuer, title, documentIdentifier, edition, snapshot,
  canonicalUrl, snapshotUrl, contentSha256, licenseBasis,
  officialStatus: 'official-publication', verificationStatus: 'pending-independent-review',
  retrievedAt: sourceRetrievedAt,
});
const sources = [
  source('nist-rmf', 'NIST', 'AI Risk Management Framework', 'NIST AI 100-1', '1.0', '2023-01-26 PDF', 'https://doi.org/10.6028/NIST.AI.100-1', 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf', '7576edb531d9848825814ee88e28b1795d3a84b435b4b797d3670eafdc4a89f1', 'NIST public publication'),
  source('nist-gai', 'NIST', 'Generative AI Profile', 'NIST AI 600-1', '1.0', '2024-07-26 PDF', 'https://doi.org/10.6028/NIST.AI.600-1', 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf', '6e73620ab6b64e90ef2c04bf0e0d6246185a2f4b1b13cab0df494496cff89b6a', 'NIST public publication'),
  source('oecd-ai', 'OECD', 'Recommendation of the Council on Artificial Intelligence', 'OECD/LEGAL/0449', 'amended 2024-05-03', '2026-09-29 official print PDF', 'https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449', 'https://legalinstruments.oecd.org/api/print?ids=648&lang=en', '88227000e69be9aad5864155bd3e06ebead1e76c5b7cf662d63c1605408e5060', 'OECD public legal instrument'),
  source('owasp-agentic', 'OWASP', 'Top 10 for Agentic Applications 2026', 'OWASP Agentic Top 10 2026', 'Version 2026 (December 2025)', 'official 2026 guide PDF; 1,274,186 bytes', 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/', 'https://genai.owasp.org/download/52117/', 'a2db94cd00b08e0b3a5e5b619afe024bdbcd74503111085705e4f3dd886fcb5c', 'OWASP public download; licence review pending', '2026-09-29T22:13:31Z'),
  source('nist-aml', 'NIST', 'Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations', 'NIST AI 100-2e2025', '2025 edition', '2025-04-01 corrected PDF retrieved 2026-09-29', 'https://csrc.nist.gov/pubs/ai/100/2/e2025/final', 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf', '4811fb6ad73f9c9121843ab77e029b5adc6f2c86d33c2fc5b2099ef133847646', 'NIST public publication'),
];
const topics = [
  ['m1', 'AI systems, actors, and impacts', 'Map an agent system boundary and identify affected people before making a safety claim.', 'oecd-ai', 'Section I: Definitions and Principles'],
  ['m2', 'Lifecycle risk management', 'Apply Govern, Map, Measure, and Manage to one agent use case and record residual risk.', 'nist-rmf', 'AI RMF Core: Govern, Map, Measure, Manage'],
  ['m3', 'Generative AI failure modes', 'Identify confabulation and privacy or information-integrity failure in an example, then select an escalation.', 'nist-gai', 'Section 2: GAI risks'],
  ['m4', 'Safe agent autonomy', 'Refuse a goal-hijacking instruction and constrain a tool call to authorized scope.', 'owasp-agentic', 'ASI01 Agent Goal Hijack; ASI02 Tool Misuse'],
  ['m5', 'Adversarial evaluation and response', 'Classify a poisoning or evasion scenario and explain a mitigation limit.', 'nist-aml', 'Executive Summary: evasion and poisoning attacks'],
];
const lessons = [
  'Start with a system map: name the agent, model, prompts, tools, data stores, human operator, and people affected by its outputs. For a support agent, mark whether a tool only reads a ticket or can send a message or change an account. The OECD instrument defines AI-system actors and lifecycle stages; those boundaries help identify who can be harmed and who is accountable. Practice: draw the boundary for a ticket-handling agent, name two affected stakeholders, and identify one decision that needs a human owner.',
  'Use the four AI RMF functions as a working cycle. Govern assigns responsibility and policy; Map records the use case and context; Measure gathers test and monitoring evidence; Manage chooses controls and tracks residual risk. For a tool-using agent, list the allowed action, a plausible failure, a test that could expose it, and the safe response when the test fails. Practice: write a one-page risk record for an agent that can search documents and draft replies, then state what evidence would justify deployment.',
  'A plausible answer is not necessarily a grounded answer. The NIST Generative AI Profile identifies confabulation and information-integrity or privacy risks among the risks to manage. Give the agent an unsupported claim and a private-data lure. The safe response is to distinguish verified facts from uncertainty, avoid revealing private data, and escalate when the task cannot be completed with trustworthy evidence. Practice: annotate the answer with its supporting source and explain where the agent should stop.',
  'A tool call can have effects outside the conversation. The OWASP agentic-risk release names Agent Goal Hijack and Tool Misuse among its 2026 risks. Treat retrieved text and tool output as untrusted data, keep credentials scoped to the authorized task, and require an explicit boundary before a message is sent or state is changed. Practice: inspect a forged instruction hidden in a retrieved page and show that the agent keeps its original task and refuses an unauthorized tool action.',
  'Adversarial testing asks how a system behaves when inputs are deliberately hostile. NIST AI 100-2e2025 distinguishes evasion, poisoning, privacy, and misuse attacks across AI settings. For an agent, record the attacker-controlled surface, the desired deviation, the observed behavior, and a mitigation with its limits. Practice: classify a poisoned document and an evasive user request, then choose a monitor and a stop/escalation response for each. Re-test after changing a defense.',
];
// Each lesson ends with its practice task; Training delivers the two as a
// lesson item and a practice item, so every module holds bounded practice.
const deliveryItemsOf = (id, content) => {
  const at = content.indexOf(' Practice: ');
  return [
    { id: `${id}-lesson-1`, kind: 'lesson', text: content.slice(0, at) },
    { id: `${id}-practice-1`, kind: 'practice', text: content.slice(at + 1) },
  ];
};
const objectives = topics.map(([id, , statement], index) => ({
  id: `o${index + 1}`, version, statement,
  observableVerb: ['Map', 'Apply', 'Identify', 'Refuse', 'Classify'][index],
  safetyCritical: index >= 2,
  moduleIds: [id], deliveryItemIds: deliveryItemsOf(id, lessons[index]).map((item) => item.id),
  examSlotIds: [`r${index + 1}`, `a${index + 1}`, ...(index >= 2 ? [`v${index - 1}`] : [])],
  criticalViolationRuleIds: index >= 2 ? [`critical-o${index + 1}`] : [],
}));
const modules = topics.map(([id, title, summary, sourceId, pinpoint], index) => {
  const content = lessons[index];
  const deliveryItems = deliveryItemsOf(id, content);
  return {
    id, version, title, sequence: index + 1, difficulty: 'foundational',
    objectiveIds: [`o${index + 1}`], summary, content, deliveryItems,
    contentSha256: sha256({ content, deliveryItems }),
    claims: [{ text: summary, sourceId, pinpoint }],
  };
});
const curriculumTrack = { id: 'ai-safety-fundamentals', version, moduleIds: modules.map(({ id }) => id) };
const examTemplate = {
  id: 'ai-safety-exam', version, curriculumTrackVersion: version,
  policy: 'Draft slot blueprint only; wording and quality review pending.',
  slots: [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, tier: 'recall', objectiveIds: [`o${i + 1}`] })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i + 1}`, tier: 'applied', objectiveIds: [`o${i < 5 ? i + 1 : 2}`] })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i + 1}`, tier: 'adversarial', objectiveIds: [`o${i < 3 ? i + 3 : 4}`] })),
  ],
};
const rubric = {
  id: 'ai-safety-rubric', version,
  policy: 'Draft critical-rule identifiers only; grading criteria and human approval pending.',
  criticalViolationRuleIds: ['critical-o3', 'critical-o4', 'critical-o5'],
};
const fallbackBank = { id: 'ai-safety-fallback', version, policy: 'Draft contract only; 15 reviewed deterministic items pending issue #14. This package cannot activate.' };
const pin = (value) => ({ id: value.id, version: value.version, sha256: sha256(value) });
const pkg = {
  manifest: {
    packageId: 'ai-safety-fundamentals', version, schemaVersion: '1.0.0', domain: 'AI Agent Safety and Secure Tool Use',
    state: 'Candidate', predecessor: null,
    sourcePins: sources.map(pin), objectivePins: objectives.map(pin), modulePins: modules.map(pin),
    curriculumTrackPin: pin(curriculumTrack), examTemplatePin: pin(examTemplate),
    rubricPin: pin(rubric), fallbackBankPin: pin(fallbackBank),
  },
  sources, objectives, modules, curriculumTrack, examTemplate, rubric, fallbackBank,
};
if (require.main === module) process.stdout.write(`${JSON.stringify(pkg, null, 2)}\n`);
module.exports = pkg;
