# EduAgentX Security Assurance Pack

Owner: Raniya Habachi (cybersecurity). Status: draft 1, 13 November 2026.

This pack is the cybersecurity contribution to EduAgentX. It looks at the platform as a system that certifies AI agents and asks what could go wrong, what already stops it, and what is still open.

| File | What it holds |
|---|---|
| `threat-model.md` | Assets, actors, trust boundaries, 22 threats with the controls that answer them |
| `control-mapping.md` | Each control mapped to NIST CSF 2.0 and the OWASP Top 10 for LLM Applications (2025), plus the gaps |
| `findings.md` | Security findings with severity, status and fix |
| `security-test-cases.md` | Security test cases to add to the test plan amendments |

## How to read the evidence tags

| Tag | Meaning |
|---|---|
| `[ARCH]` | `docs/architecture.md` on main |
| `[PR84]` `[PR88]` `[PR90]` | Description of that pull request. The claim is stated there. The author of this pack has not re-tested it |
| `[TP]` | The team test plan, route conventions and test cases |
| `[REV]` | The author read the source on main and checked it directly |
| `[TO VERIFY]` | Believed true, not yet checked. Do not cite as fact |

## Limits

- This is a design and code-reading review. It is not a penetration test.
- Controls marked from a pull request description are claims until a test run confirms them.
- The platform runs locally with development keys. Production hardening is listed under findings, not assumed.
