# EduAgentX web app

## What it is

The operator and demonstration surface for EduAgentX, a competency assurance
platform for AI agents. It reads live data from the running platform through
the API Gateway and drives one real Agent Learner through the lifecycle.

| Page | Mode | Job |
|---|---|---|
| Overview | Operate | Ledger of certifications, credential status, monitoring posture, recent activity |
| Lifecycle Lab | Operate | Runs package → register → train → examine → certify → verify → status → monitor, live |
| Credentials | Operate | Inspect a W3C VC, re-verify it, suspend / reinstate / revoke with a reason |
| Verify | Operate | Paste any compact JWS; tamper with it to show the signature check failing |
| Curriculum | Read | The active Domain Assurance Package: modules, gates, exam blueprint, objectives, sources |
| System | Read | Fourteen services by layer with live health and the GitHub issue that built each |

## Audience

Capstone PoC reviewers watching a shared screen (Remo, 19 October), then
operators of the platform. Desktop first; usable down to 375 px.

## Visual world

"Dark assurance lab": near-black ink, one mint signal colour for verified
state, amber for suspended or remediation, red for failure. Geist and Geist
Mono for interface and data, Instrument Serif italic for one emphasised word
per page title. Evidence is shown as it was answered: ids, digests and
durations are real values, never decoration.

## Constraints and assumptions

- Assumption: the brief was inferred from the PoC announcement and the earlier
  prototype at eduagentx-prototype.vercel.app; no product owner signed it off.
- The browser never holds a credential. `server.js` keeps the admin and
  reviewer client secrets and exposes only sanitized reads, the status
  actions and an NDJSON lifecycle stream.
- Demo-only: anyone who can reach port 4300 can use the admin status actions.
  Compose binds it to 127.0.0.1 for that reason. Put real operator sign-in in
  front of it before any shared deployment.
- All agent behaviour is the deterministic Synthetic Agent Learner (Issue #21
  scenarios), labelled as simulation evidence.
