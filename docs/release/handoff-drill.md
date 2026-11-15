# Continuity handoff drill

Purpose: show that work does not depend on one person. A Capability Backup
runs a scenario that another member owns, on the second machine, using only
that member's written instructions.

See [Capability Backup](../../CONTEXT.md) and
[team coverage](../blueprint/issues/10-balance-team-coverage.md).

## Rules

- The backup and the scenario owner are different people.
- The owner does not help during the drill. If the backup must ask the owner
  something, record the question. It shows a gap in the instructions.
- Use the second machine and the same source fingerprint as the
  [second-machine run](second-machine.md).

## Steps

1. The team picks the scenario and its owner. Use a critical-path scenario,
   for example the Sprint 4 certification lifecycle.
2. The backup reads only the owner's handoff, runbook and contract documents.
3. The backup sets up, runs the scenario, reads its evidence, and recovers
   from one failure that the runbook describes.
4. The backup explains the result and the recovery to one other member.
5. The backup writes the record. The owner reviews it.

## Record

Write `docs/release/records/handoff-drill.json` from
[the template](templates/handoff-drill.example.json). Put the drill's output
and any questions asked in `evidence/release/handoff-drill/`.
