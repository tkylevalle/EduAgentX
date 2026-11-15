# Learning measurement

Answers assurance audit finding B7: does training change what an agent does?

The measurement plays the exam's held-out behaviour items (the four
adversarial slots, 9 sandbox episodes each) in three arms that differ only in
the notes the agent carries:

| Arm | Notes |
|---|---|
| `no-notes` | none |
| `with-notes` | the agent's own notes, written after studying the lessons of the item's objectives |
| `control-notes` | as many of the agent's own notes, from one module the behaviour items do not test (o1 or o2): same domain and length, other objectives |

This is an arms design, not the pre-test, training, post-test sequence the
target design describes: `no-notes` stands in for the pre-test, and the arms
run in fresh held-out worlds rather than one agent before and after. The
report gives each arm's gain over `no-notes` and the gain of `with-notes` over
`control-notes`, which separates "these notes help" from "any notes help".
The control is not content-free: the o1 and o2 lessons are about the same
domain, so a gain over the control is a gain from topic-specific notes.

Items are played the way the Examination Engine records them: one action at
a time against `stepEpisode`, then graded by `behaviourGrade` over the
recorded steps, in fresh held-out worlds for each run. An episode succeeds
when it scores at the pass mark with no critical violation.

The report gives each arm's episode success rate with a 95% Wilson interval
and the count of actions the agent failed to give, and each gain with a 95%
Newcombe interval. A gain whose
interval holds zero is reported as "no measured gain", including a zero gain.

```bash
node packages/learning-measurement/cli.js             # scripted check of the instrument
node packages/learning-measurement/cli.js --runs 3 --live --write
```

## What it can and cannot show

- **Scripted agents do not learn.** Without `--live`, every arm is the
  reference safe agent, which ignores notes. That run checks the instrument:
  it must show no gain. It is not evidence about learning.
- **The live run is manual.** `--live` needs `OPENCODE_API_KEY` (and
  optionally `LIVE_MODEL`). It makes one model call per lesson and several per
  episode: one run is about 36 episodes per arm. It is not run in CI, and no
  live result is committed yet.
- **Notes, not weights.** The measurement tests whether the agent's own notes
  change its behaviour in held-out worlds. Nothing changes model weights.
- **Episodes in one run share an agent.** The interval treats episodes as
  independent; repeated runs with fresh worlds reduce, but do not remove, that
  dependence.
- **Text items are not measured here.** The keyword grader for recall and
  applied items is not valid (see `packages/grading-validity`), so the
  measurement uses the behaviour tier only.
