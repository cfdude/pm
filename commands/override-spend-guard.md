---
description: Record the escalation decision taken at a spend-guard STOP, or revoke it
allowed-tools: Bash, Read
---

Record who took the decision at a `spend-guard` STOP, and re-arm the guard from the current count.

```bash
conductor.mjs override-spend-guard <epicId> --signal rounds|tokens --escalated-to user|fable|opus|sonnet|haiku --reason "<why>"
conductor.mjs override-spend-guard <epicId> --signal rounds|tokens --revoke --reason "<why>"
```

An override appends `{signal, baseline, escalatedTo, reason, at}` to `epic.spendGuardOverrides`. The
`baseline` is the signal's count at that moment, so the guard trips again after `limit` more rounds, or
after another ceiling's worth of tokens.

- **Only while the signal is tripped.** An override given in advance would be a pre-authorization to loop,
  which is what the guard exists to prevent. It is refused, writing nothing, when the signal is not tripped
  now. A `tokens` override also needs spend tracking on: with it off there is no count to baseline.
- **It must name who decided**, and the model must rank at or above the computed escalation target
  (`haiku < sonnet < opus < fable`, from the resolved `review` model for rounds and `implement` for tokens).
  The model that failed cannot override itself. After one live **model** override for a signal, the next
  escalation is the user's and only `--escalated-to user` is accepted, so a trip, an override and a trip
  cannot repeat without a person. The engine records the claim and checks its rank; it cannot know which
  model actually ran.
- **No autonomy grant covers it.** The override is the escalation decision, and pre-authorizing it would
  remove the stop. `set-autonomy --preauthorize` does not reach this verb.
- **A later pass spends a `rounds` override.** A pass resets the streak the baseline was measured against, so
  the baseline no longer applies once a pass is recorded after the override.
- **Revoke** (`--revoke --reason`) marks the latest live override for that signal with `revokedAt` and
  `revokeReason`, keeps the entry, and re-arms the guard at once: the baseline falls back to the previous live
  override, or to 0. `--escalated-to` is refused alongside `--revoke`, and a revoke with nothing live exits
  non-zero. The record is never deleted.
