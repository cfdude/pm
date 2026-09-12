---
lesson: filter-at-read-time-not-at-capture-time
date: 2026-09-12
trigger: About to run a test suite, build, or long command in the background and pipe it through `tail`, `head`, `grep` or `rg` to keep the output small.
cost: A background suite reported `fail 14` and the fourteen names were gone — the capture kept only the `ℹ tests/pass/fail` summary lines. Nothing could be diagnosed, so a hypothesis about the cause got formed with zero evidence, and the run had to be repeated in full to learn anything.
rule: Redirect the WHOLE stream to a file, then filter when you read it. A filter in the capture pipeline discards the evidence permanently; a filter at read time costs nothing and can be re-run with a different pattern.
enforced_in: habit — no mechanism
tags: [testing, false-signal, evidence]
---

**Cause.** A summary line answers *whether* something failed. Only the body answers *what* failed,
and the body is the half a filter throws away. The two look interchangeable while everything is
green, which is exactly when the pipeline gets written.

```bash
# Wrong — `fail 14` with no way to learn which fourteen
node --test scripts/test/*.test.mjs 2>&1 | rg '^ℹ (tests|pass|fail)' > out.txt

# Right — capture everything, filter on the way out
node --test scripts/test/*.test.mjs > out.txt 2>&1
rg -n '^ℹ (tests|pass|fail)' out.txt      # the verdict
rg -n '✖' out.txt                          # the names, still there
```

**The sharper failure is the exit code, and it is the same mistake one step further on.** A pipeline
reports the exit status of its LAST stage, so `node --test … | tail -20` exits 0 while the suite is
red. That one is already known here; this lesson is its sibling — the pipe does not merely mislead
about pass/fail, it destroys the diagnosis.

**Related, and the reason this cost a cycle rather than a minute:** with the names gone, the only
thing left to reason about was the circumstances. Two suites happened to be running at once, so
"contention" became the explanation — untestable, unfalsifiable, and load-bearing for a decision
about whether to ship. See [`measuring-under-concurrent-writes`](measuring-under-concurrent-writes.md)
for the inverse trap: a green run under concurrency is meaningless too, and far less likely to be
questioned. Neither lesson helps if the evidence was discarded at capture.

Output size is not the reason to filter early. A suite's full output is a few hundred KB on disk and
zero tokens until read — the file is not in context, only what `rg` pulls out of it is.
