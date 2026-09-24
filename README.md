# EduAgentX

The current Sprint 1 increment exposes the authenticated, provider-neutral
`ExternalAgentLearner` protocol and a deterministic Synthetic Agent Learner.
See [docs/external-agent-learner-protocol.md](docs/external-agent-learner-protocol.md)
and [docs/issue-5-handoff.md](docs/issue-5-handoff.md)
for the contract, safe outcomes, Compose setup, and tests.

## Sprint 1 verification

Install test dependencies and run the complete clean-state gate:

```bash
make install-test-deps
make test
```

The gate runs unit, contract, security, public HTTP, Redis Stream,
dependency-failure/recovery, and registration-latency checks. Machine-readable
results are written to `artifacts/sprint1/`. See
[docs/issue-7-handoff.md](docs/issue-7-handoff.md) for coverage and limitations.
