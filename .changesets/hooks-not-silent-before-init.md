* **pm's hooks are silent in a repository pm never initialised, as documented.** The
  root-divergence ("WRITING A DIFFERENT REPOSITORY") and detached-checkout warnings ran before the
  engine checked for `/pm:init`, so `commit-nudge` warned on every Bash call when
  `CLAUDE_PROJECT_DIR` pointed at a non-pm repository, and `snapshot` printed a four-line "about to
  write .conductor/brief.txt" in a detached non-pm checkout — both for a write the dormant hook
  never makes. Both warnings now fire only once pm is initialised there, except for `init` itself,
  which is the one verb that writes into an uninitialised repository and still warns before it
  scaffolds the wrong one. A non-hook verb refused there for want of `/pm:init` still prints the
  wrong-repository warning first, naming both repositories, so following its advice does not
  initialise the wrong one.
