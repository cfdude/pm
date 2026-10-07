* **`integrity` now names an epic whose Gate 1 verdict reads stale.** A Gate 1 recorded with `--artifact` goes stale
  when a reviewed spec artifact is amended, and PROJECT.md and the brief showed `⚠ stale`, but no `integrity` check
  listed the epic. The new `gate-1-verdict-stale` check reuses the artifact-digest predicate behind that marking (one source of
  truth; it does not ask the Gate 2 commit-range question), prints its count line even at zero, names the changed artifact files, and names
  `record-gate-review <id> --gate 1 …` to re-record. A legacy verdict with no digests is `⚠ unverifiable`, not
  stale, and is not reported here. Reported, never refused.
