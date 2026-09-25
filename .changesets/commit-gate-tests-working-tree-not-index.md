* **The pre-commit hook tests what you are committing, not your working tree.** It exports the
  index with `git checkout-index -a` into a private temp directory and runs the assertion half
  there, so a failing test that is staged can no longer commit green because a passing copy sits
  unstaged beside it; an untracked test file neither runs nor counts; a partially staged file is
  tested — and its tests counted by the floor — as its staged half. The hook now also honours the
  index git hands it, so `git commit -a` and `git commit <path>`, whose index is not `.git/index`,
  are tested, drift-checked and counted as what they commit. The drift script that runs first is
  the commit's own copy, and it now reads every set it judges — certified engine modules, test ids,
  conformance rows — from that index rather than from disk, so an engine module staged and then
  deleted from the working tree can no longer slip past the certification check. The hook never
  writes the working tree or the index (a `git stash` approach was measured and rejected: it
  rewrites the tree, fails before a repository's first commit, and shares one stash stack across
  every worktree), and its snapshot and suite lock are removed on exit, including on Ctrl-C.
* **`drift.mjs`, `certify.mjs` and `node-majors.mjs` no longer do nothing when run through a
  symlinked path.** Each compared its own path against the command line without resolving
  symlinks, so run from under macOS's `$TMPDIR` (`/var` → `/private/var`) it exited 0 without
  running; they now compare real paths.
