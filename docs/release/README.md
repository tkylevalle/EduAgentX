# Final release gate (Issue 36)

The final release gate decides whether EduAgentX is a tested Capstone-Grade
Reference Implementation. The rules come from
[the final release gate](../blueprint/issues/09-define-sprint-exit-gates.md#final-release-gate).

```bash
node packages/release-gate/cli.js                 # evaluate; writes artifacts/release/release-result.json
node packages/release-gate/cli.js --fingerprint   # print the source fingerprint for a new record
```

Exit code 0 is PASS, 2 is BLOCKED, 1 means the gate could not run. Every
blocker is printed.

## What the gate checks

| Check | Source | Machine or people |
|---|---|---|
| No `.env`, key file, private key block, signed token or provider key is tracked; example and Compose secrets are empty, `example-only-` or `${...}` | tracked files | machine |
| The working tree has no uncommitted changes | git | machine |
| Sprints 1 to 5 each passed, in order, with an evidence pack that exists | `records/sprint-N.json` | people |
| Clean setup, tests, deterministic demonstration and Evidence Bundle on a second machine, with no paid API calls | `records/second-machine.json` | people |
| A Capability Backup ran another member's scenario on the second machine | `records/handoff-drill.json` | people |
| No open Critical or Major Assurance Incident | `records/incidents.json` | people |
| Every Acceptance Floor met; every result Green or Amber | `records/metrics.json` | people |
| Optional live usage and its AED cost reported | `records/live-cost.json` | people |
| Team approval and the mandatory independent reviews | `records/approval.json` | people |
| Limitations, scope reductions, residual risks, non-accreditation, live cost and ownership history | [limitations.md](limitations.md) | people |

The gate never writes a record. A record that a script fills in as PASS is not
evidence. The people who did the work write and commit the record.

## Writing a record

1. Commit the source you are releasing. Do not change it after this step.
2. Run `node packages/release-gate/cli.js --fingerprint`.
3. Copy the matching template from [templates/](templates/) to
   `docs/release/records/<type>.json`. Fill every field. Put the fingerprint
   in `sourceFingerprint`.
4. Commit the record. Records and `evidence/` are outside the fingerprint, so
   adding them does not make other records stale.

Any source change after step 2 changes the fingerprint. Then every record
except the sprint passes must be made again for the new source. Sprint pass
records describe earlier commits, so they hold a `sourceCommit` instead.

## Procedures

- [Second-machine run](second-machine.md)
- [Continuity handoff drill](handoff-drill.md)

## Limits of the secret scan

The scan reads tracked text files up to 2 MB. It skips binary files. It cannot
find a reused demo password written in prose, so the approval record must
confirm that the team checked for one.
