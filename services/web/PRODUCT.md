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
| Marketplace | Operate | Open a Capability Request, generate Eligible/Near Match candidates against real credentials |
| Evidence | Operate | Regenerate the sanitized, digested Evidence Bundle from what the platform can currently back live |

## Two modes

The app has two views of the same platform. Both read the same BFF routes and
the same lifecycle run (`src/run/store.js`), so they cannot disagree.

- **School** (`#/school/<room>`) is the view for visitors. Quill, a robot
  student, goes through five rooms: Enrol, Class, Exam, Report card,
  Graduation. Each scene comes from an event of the real run stream
  (`src/school/director.mjs`). The panel under the stage shows the records
  behind the room. A failed exam gives a report card and a catch-up class,
  and no diploma.
- **Operator** (`#/<page>`) is the technical console in the table above.

The switch is in the top bar of both views, and the key M does the same. It
keeps the run and maps the room to its page (Exam opens the Lifecycle Lab,
Graduation opens Credentials). The browser stores the last mode in
`localStorage`.

The School shows no value of its own. A record that did not load shows as
missing. The one development aid, `?pose=`, exists only in the dev server and
labels itself "Art check".

## Audience

Capstone PoC reviewers watching a shared screen (Remo, 19 October), then
operators of the platform. Desktop first; usable down to 375 px.

## Visual world

"Flight deck": near-black ink with a faint dot grid, one mint signal colour for verified
state, amber for suspended or remediation, red for failure. Archivo (expanded,
heavy, uppercase titles) for people and Geist Mono for machine answers. Dense
panels, live readouts instead of hero copy, keyboard-driven runs (1–6, Enter)
and pointer-lit surfaces. No serif accent titles, no airy hero space.
The School adds a lamp-lit cross-section of the building and cream paper for
the report card and the diploma; it uses the same type and signal colours.
Evidence is shown as it was answered: ids, digests and
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
