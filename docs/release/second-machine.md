# Second-machine run

Purpose: show that a person who is not the usual developer can set up, test,
demonstrate and produce evidence on another computer, using the
zero-paid-API path only.

## Rules

- Use a computer that was not used to develop the release.
- Start from a fresh clone. Do not copy `.env`, `keys/`, `node_modules/` or
  Docker volumes from another computer.
- Leave `OPENCODE_API_KEY` empty. The live model tile stays disabled, and no
  paid call is possible.
- Record every failure. Do not fix code during the run. A fix changes the
  source fingerprint, so the run must then start again.

## Needs

Docker with Compose v2, Node 24, Python 3.9 or later and git.

## Steps

Run the commands from the repository root. Keep the output of each step.

1. **Clone and check the source.**

   ```bash
   git clone https://github.com/tkylevalle/EduAgentX.git
   ```

   ```bash
   git -C EduAgentX checkout <release commit>
   ```

   ```bash
   node packages/release-gate/cli.js --fingerprint
   ```

   The fingerprint must match the one the team is releasing.

2. **Setup.** `make up` creates `.env` and the development keys, builds the
   images, starts the stack and waits for health. Without `make`, run
   `node scripts/setup-dev.js`, then the commands that the `up` target in the
   [Makefile](../../Makefile) lists. On Windows, `EduAgentX-Start.bat rebuild`
   does the same.

3. **Tests.**

   ```bash
   make install
   ```

   ```bash
   node scripts/run-unit-tests.js
   ```

   ```bash
   python scripts/run-sprint1.py --technical-only
   ```

   All unit tests must pass with none skipped. The Sprint 1 gate must report
   `technical_checks: PASS`.

4. **Deterministic demonstration.**

   ```bash
   node scripts/poc-lifecycle.js
   ```

   Every stage must pass. The report is in `artifacts/poc/lifecycle-run.json`.

5. **Evidence Bundle.** Regenerate the final sanitized Evidence Bundle with the
   command that Issue 35 delivers. Until Issue 35 is done, this step cannot
   pass.

6. **Paid calls.** Confirm that `OPENCODE_API_KEY` stayed empty and count paid
   API calls. The count must be 0.

## Record

Write `docs/release/records/second-machine.json` from
[the template](templates/second-machine.example.json). Put the run's output in
`evidence/release/second-machine/` and name that folder in
`evidenceReference`.
