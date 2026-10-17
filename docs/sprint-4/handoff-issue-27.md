# Issue #27 implementation handoff — Governance, Demonstration Lab, and permissions

## Note on how this change set came together

Two branches were started independently for Issue #27:
`pranav/issue-27-governance-permissions` (the role/identity foundation —
`viewer`, `evaluator`, two-identity `governance_operator`, `demo_operator`)
and an earlier version of this work, which built a single governance
command but reinvented `governance_operator` as one identity instead of
building on the existing two-identity foundation. That duplication was
caught and PR #73 (the single-identity version) was meant to be closed
without merging once this branch reconciled with the two-identity
foundation — but #73 was merged into `main` before that happened.

This branch is rebased onto `main` as it stands after #73's merge, and the
rebase replaces every piece #73 added with the corresponding two-identity
version: `auth.js`'s single `GOVERNANCE_CLIENT_ID` identity is replaced by
`viewer`/`evaluator`/two `governance_operator`/`demo_operator`, and the
single-call, single-approver `quarantine-release` route #73 shipped is
replaced by the two-distinct-approver version described below — there is
exactly one `quarantine-release` route in the result, not two. Anyone
reviewing this PR's diff against `main` will see it as modifying the
code #73 just merged, not adding a parallel copy of it.

## Delivered in this change set

- **Role foundation** (`services/api-gateway/auth.js`): four roles distinct
  from `agent`/`admin`/`reviewer`, matching the spec's composable
  Viewer/Evaluator, Governance Operator, Demo Operator permission model
  (spec.md line 182):
  - `viewer` — read-only Assurance Console access, one identity.
  - `evaluator` — read-only KPI/assurance evidence access, one identity.
  - `governance_operator` — **two distinct identities**
    (`GOVERNANCE_OPERATOR_1`/`_2`), the same two-distinct-identities shape
    already used for `reviewer`, so governance commands can require two
    independent approvals the same way curriculum review already requires
    two distinct reviewers.
  - `demo_operator` — one identity, for the isolated Demonstration Lab
    (not yet built — see Known gaps).
  `requireRole(...)` composes access across any combination of these with
  no change needed to the middleware itself.

- **Governance command** (`services/api-gateway/index.js`):
  `POST /v1/admin/governance/packages/:packageId/quarantine-release`,
  callable by `governance_operator` or `admin`. The Gateway never mutates
  state itself:
  1. Validates the request shape (`version`, `scope {type, id}`, `reason`,
     `evidenceReference`, `restoredPackageId`) and fails closed with
     `400 invalid_request` before anything else.
  2. Rechecks authoritative state on **every** call — first approval and
     second — by calling validation-activation's `GET /packages/:id?version=`
     and confirming the target scope is still present in
     `quarantinedScopes` right now. If not, `409 scope_not_quarantined`,
     and nothing is recorded or executed.
  3. Requires **two distinct approving subjects** before acting, mirroring
     validation-activation's own two-distinct-reviewer pattern for
     curriculum activation: the first valid call is recorded in an
     in-memory pending-approval map (keyed by package/scope) and answered
     `202 pending_second_approval`; a second call from a *different*
     subject, agreeing on `version`, `restoredPackageId`, and
     `evidenceReference`, completes it. The same subject calling twice is
     refused with `409 duplicate_approver`; a second call that disagrees on
     what's being approved is refused with `409 approval_mismatch` without
     disturbing the pending first approval. Either role can supply either
     approval — any two distinct subjects, `governance_operator` or
     `admin`, complete a release, matching how curriculum review counts
     distinct `reviewer_id`s regardless of role.
  4. Only once two distinct, matching approvals are gathered does it call
     the owning service's existing `POST /packages/:id/quarantines/restore`,
     which performs the mutation and appends a `restored` event — carrying
     both approvers' stated reasons — to its own append-only evidence
     trail. That evidence trail is the audit record for the action; the
     Gateway's pending-approval map never holds a domain record, only
     "who has approved so far," and is cleared the moment a release
     executes.
- The authoritative-state recheck closes a real gap: validation-activation's
  own restore route does not itself verify the target scope is still
  quarantined before appending a `restored` event. Fixing it at the
  Gateway (Issue #27's own ownership) avoids editing validation-activation's
  already-merged route.
- `governance_operator`, `viewer`, `evaluator`, and `demo_operator` are
  added only to the routes meant for them. None is added to
  `/v1/admin/curriculum/activate`, `/v1/admin/training-remediations`, or
  any other mutating admin route, so none of them can edit a score, force a
  pass, issue a credential, or touch immutable policy/evidence — confirmed
  by a negative test against five such routes.
- Wired all five new client-credential pairs through `docker-compose.yml`
  (optional, default empty) and `.env.example`.

## Verification

- `services/api-gateway/test/permissions.test.js` (3 tests, from the
  foundation branch, unchanged): each new identity issues a correctly-role
  token; the two `governance_operator` identities are distinct subjects;
  `requireRole(...)` composes access across all new roles the same way it
  already does for `agent`/`admin`/`reviewer`.
- `services/api-gateway/test/governance.test.js` (11 tests, rewritten for
  the two-person flow): the full two-approval happy path including the
  combined-reason audit trail sent downstream; admin and
  governance_operator jointly completing a release; the same approver
  calling twice never completing it alone; a mismatched second approval
  being refused without losing the first; the recheck running on *both*
  calls (proven by restoring the scope out from under a pending approval
  between the two calls); a never-quarantined scope refusing even the
  first approval; role boundaries (Agent Learner refused; five other
  mutating admin routes refused to `governance_operator`); request-shape
  validation; package-not-found and upstream-unreachable handling.
- Full `services/api-gateway/test/*.test.js` suite: 40/40 passing (26
  pre-existing + 3 permissions + 11 governance).
- `docker compose config --quiet`: no new errors from the added optional
  variables (only the pre-existing errors for required secrets with no
  local `.env` file, unrelated to this change).

## Known gaps / not run here

- `services/validation-activation` has no installed `node_modules` in this
  authoring environment (`Cannot find module 'express'`), so its own test
  suite could not be run here. Pre-existing environment gap, not a
  regression — validation-activation's source was read but not modified.
  Run `npm install` there (or `make install`) and
  `node --test services/validation-activation/test/*.test.js` from a clone
  before merge.
- Docker Compose integration (the Gateway reaching a live
  validation-activation container through the new route, with two real
  distinct governance-operator tokens) was not exercised; only the
  unit-level HTTP stub in `governance.test.js` was. Run `make up` and a
  live two-call release against a real quarantined package before demo.
- `viewer`, `evaluator`, and `demo_operator` have identities and token
  issuance now, but no routes gated by them yet, and the Demonstration Lab
  itself does not exist. That remains separate work under Issue #27's
  broader "Governance, Demonstration Lab, and permissions" scope — this
  change set covers the permission foundation plus one governance command
  (quarantine release), not the full work package.
- The pending-approval store is in-memory and per-Gateway-instance: it does
  not survive a restart and would not be shared across multiple Gateway
  replicas. Acceptable for this capstone's single-instance Sprint 4 scope;
  worth noting if the Gateway is ever run with more than one replica.
