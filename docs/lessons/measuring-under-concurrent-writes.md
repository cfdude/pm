---
lesson: measuring-under-concurrent-writes
date: 2026-08-23
trigger: A test suite, lint run, or build goes red while background agents are writing to the tree.
cost: Nearly dispatched an agent to chase 4 phantom failures. The same suite ran green minutes later with no change.
rule: Stop the writers before measuring. A red suite under concurrent writes is not evidence.
enforced_in: habit — no mechanism
tags: [concurrency, false-signal]
---

**Cause.** The tree was mid-write. Half-applied edits produce failures that describe nothing real.

The dangerous version is the inverse: a suite that runs **green** mid-write is equally meaningless,
and far less likely to be questioned.
