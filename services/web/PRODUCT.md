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

- **School** (`#/school/<view>`) is the view for visitors. The platform is one
  school building, and every page is a camera move on it
  (`src/school/campus.mjs`). The campus view (`hub`) shows the whole building.
  Quill, a robot student, goes through the five rooms of the ground floor as a
  real run moves on. Each scene comes from an event of the run stream
  (`src/school/director.mjs`). The papers on the table under the stage show
  the records behind the view. A failed exam gives a report card and a
  catch-up class, and no diploma.
- **Operator** (`#/<page>`) is the technical console in the table above, with
  Governance, Labelling and Attention.

| School view | Shows | Operator page |
|---|---|---|
| Campus | The building, the student roster, the course, the latest result | Overview |
| School gate | Choose a student and start a run | Lifecycle Lab |
| Classroom | Lessons, sources, objectives | Curriculum |
| Exam hall | The paper, the pass lines, the instant-fail rules | Lifecycle Lab |
| Head teacher's office | Report cards, question by question | Credentials |
| Graduation hall | Diplomas, the seven-check verification, graduates | Credentials, Verify |
| Library | Course checks, pinned sources, each claim beside its source | Governance |
| Staff room | Incidents; acknowledge and resolve with a note | Attention, Labelling |
| Caretaker's workshop | Service health, the evidence bundle | System, Evidence |
| Careers office | Post a job, see matched graduates | Marketplace |

Work that needs a reviewer's own account (signing a review, labelling) stays
in Operator Mode; the School links to it.

The switch is in the top bar of both views, and the key M does the same. It
keeps the run and maps the view to its page. When two pages share a room, the
switch returns to the page the visitor came from. The browser stores the last
mode in `localStorage`.

The School shows no value of its own. A record that did not load shows as
missing. The one development aid, `?pose=`, exists only in the dev server and
labels itself "Art check".

## Audience

Capstone PoC reviewers watching a shared screen (Remo, 19 October), visitors
at the innovation fair, then operators of the platform. Desktop first; usable
down to 375 px.

## Visual world

"Flight deck": near-black ink with a faint dot grid, one mint signal colour for verified
state, amber for suspended or remediation, red for failure. Archivo (expanded,
heavy, uppercase titles) for people and Geist Mono for machine answers. Dense
panels, live readouts instead of hero copy, keyboard-driven runs (1–6, Enter)
and pointer-lit surfaces. No serif accent titles, no airy hero space.
The School has its own look: a dollhouse school on a model-maker's table.
The rooms and the robot are 3D models rendered in Blender (`art/blender`) to
layered plates and sprite sheets; the page puts live records on their boards,
clocks and lamps. Navigation is brass, captions are chalk, records are paper.
Six colours: workshop black `#17130F`, chalkboard green `#2F5D50`, pencil
yellow `#FDAE12`, paper `#F2E9D5`, red pen `#C8352B`, brass `#C9993F`.
Archivo in sentence case, Shantell Sans for chalk only, Geist Mono for real
identifiers. `art/README.md` describes how the art is made.
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
