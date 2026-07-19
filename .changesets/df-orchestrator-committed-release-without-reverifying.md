- **Mechanical pre-commit hook: the full test suite must pass immediately before every
  commit, enforced, not just documented.** A genuinely failing test was committed once already
  (0.16.0) because a prose reminder alone wasn't enough — "run the tests one more time before
  committing" is exactly the kind of rule that gets skipped under momentum. `.githooks/pre-commit`
  runs `node --test scripts/conductor.test.mjs` and blocks the commit on any failure. One-time
  setup per clone: `git config core.hooksPath .githooks` (documented in `CONTRIBUTING.md`).
