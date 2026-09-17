---
lesson: a-subagent-that-backgrounds-its-run-ends-without-a-report
date: 2026-09-17
trigger: You are writing the dispatch prompt for a subagent — a gate reviewer above all — whose work includes a long command (the full test suite, a fixture build, a Layer B run) that it may choose to start in the background.
cost: emitted-commands-run-as-written, Gate 2 (release 0.45.0). Three fresh-context review subagents started a long run in the background and ended their turn with "waiting for results" and no report. A subagent's final message IS its report, so the orchestrator received no verdict from any of the three and had to dispatch each review again — three fresh-context review turns spent for nothing, during a gate that already took four rounds.
rule: Tell every dispatched subagent that its turn ending is its report — it must not end its turn while a command it started is still running. Run long commands in the foreground (with a long enough timeout), redirected to a file and read back; if it does background one, it waits for it before replying. A reply that says it is waiting is a failed dispatch — re-dispatch it, never read it as a verdict.
enforced_in: habit — a line in the dispatch brief; no mechanism. Nothing in the harness distinguishes a subagent's last message that reports from one that merely pauses.
tags: [subagents, review, gates, dispatch]
---

**Cause.** In the main conversation a backgrounded command is harmless: the session is re-invoked
when it exits and the agent picks up where it left off. A subagent has no such continuation. Its
final assistant message is returned to the orchestrator as its entire result, and the context is
discarded. A reviewer that backgrounds the suite and says "I'll report once it finishes" has
already finished — with no report.

**Why it recurs.** Backgrounding a four-minute suite is the sensible move for the main agent, and a
subagent inherits the same instinct and the same tool. Nothing in the reply looks like a failure:
it is polite, specific about what it is waiting for, and reads like progress.

**The step.** Put one sentence in every dispatch prompt that asks for a run: *"Your final message is
your report; do not end your turn while anything you started is still running — run the suite in
the foreground with its output redirected to a file, then read the file."* When a reply arrives
without the report's fields (`VERDICT`, findings, `STATUS`), treat the dispatch as failed and send it
again rather than waiting for a result that will never be delivered.
