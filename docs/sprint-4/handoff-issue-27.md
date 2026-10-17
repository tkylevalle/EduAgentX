# Issue #27 implementation handoff — Governance command: quarantine release

## Delivered in this change set

- Added `governance_operator` as a JWT role distinct from `admin`
  (`services/api-gateway/auth.js`), issued via the existing
  `POST /v1/auth/tokens` client-credentials exchange from a
  `GOVERNANCE_CLIENT_ID`/`GOVERNANCE_CLIENT_SECRET` pair. This satisfies the
  spec's composable Viewer/Evaluator, Governance Operator, Demo Operator
  permission model (spec.md line 182) without touching the existing
  `agent`/`admin`/`reviewer` roles.
- Added the bounded governance command
  `POST /v1/admin/governance/packages/:packageId/quarantine-release`
  (`services/api-gateway/index.js`), callable by `governance_operator` or
  `admin`. The Gateway never mutates state itself:
  1. Validates the request shape (`version`, `scope {type, id}`, `reason`,
     `evidenceReference`, `restoredPackageId`) and fails closed with
     `400 invalid_request` before calling any owning service.
  2. Rechecks authoritative state immediately before acting: it calls
     validation-activation's own `GET /packages/:id?version=` and confirms
     the target scope is still present in `quarantinedScopes` right now,
     under this request — not merely when an operator last looked at a
     dashboard. If it is not, the command is refused with
     `409 scope_not_quarantined` and the owning service's write endpoint is
     never called.
  3. Only then calls the owning service's existing
     `POST /packages/:id/quarantines/restore`, which performs the mutation
     and appends a `restored` event to its own append-only evidence trail.
     That evidence trail — now reachable through an authenticated command
     instead of being internal-only — is the audit record for this action;
     no separate audit store was added.
- The authoritative-state recheck closes a real gap: validation-activation's
  own restore route does not itself verify the target scope is still
  quarantined before appending a `restored` event, so without the Gateway's
  recheck it would be possible to "restore" a scope that was never
  quarantined, or one that was already restored. The fix was made at the
  Gateway (Issue #27's own ownership) rather than by editing
  validation-activation's already-merged route, to keep this change set
  self-contained.
- `governance_operator` is deliberately added to this one route only. It is
  not added to `/v1/admin/curriculum/activate`, `/v1/admin/training-remediations`,
  or any other mutating admin route, so the role can govern quarantines
  without being able to edit a score, force a pass, issue a credential, or
  touch immutable policy/evidence.
- Wired `GOVERNANCE_CLIENT_ID`/`GOVERNANCE_CLIENT_SECRET` through
  `docker-compose.yml` (optional, defaults empty — admin can still call the
  route if unset) and documented them in `.env.example`.

## Verification

- `services/api-gateway/test/governance.test.js` (new, 8 tests): successful
  release with both the GET recheck and the POST restore observed on the
  owning-service stub with correct `x-internal-service-key`/`x-actor-subject`/
  `x-actor-role` headers; admin can also call the route; an Agent Learner is
  rejected; `governance_operator` is rejected by five other mutating admin
  routes; the recheck refuses a scope that is not currently quarantined
  (closing the gap above) without ever calling restore; missing/blank
  `reason`, `evidenceReference`, `scope`, `version`, or `restoredPackageId`
  are refused before the owning service is called; a package the owning
  service cannot find is reported back as-is; an unreachable
  validation-activation fails the command closed with `502`.
- Full `services/api-gateway/test/*.test.js` suite: 34/34 passing (26
  pre-existing + 8 new).
- `docker compose config --quiet` parses the updated compose file without
  new errors (only the expected warnings for unset `.env` values in this
  authoring environment).

## Known gaps / not run here

- `services/validation-activation` has no installed `node_modules` in this
  authoring environment (`Cannot find module 'express'`), so its own test
  suite could not be run here. This is a pre-existing environment gap, not
  a regression from this change set — validation-activation's source was
  read but not modified. Run `npm install` in that service directory (or
  `make install`) and `node --test services/validation-activation/test/*.test.js`
  from a clone before merge.
- Docker Compose integration (the Gateway actually reaching a live
  validation-activation container through the new route) was not exercised;
  only the unit-level HTTP stub in `governance.test.js` was. Run `make up`
  and a live `POST /v1/admin/governance/packages/:packageId/quarantine-release`
  call against a real quarantined package before demo.
