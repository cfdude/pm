* **New opt-in `set-dev-log on|off`: a developer-only session log (off by default, needs spend tracking).** `init` and
  `upgrade` never turn it on; `on` is refused while spend tracking is off and in a linked worktree or on a detached
  main HEAD, as `set-spend-tracking` is. `off` stops capture and deletes nothing. `upgrade` lists `devLog` among
  the opt-ins a repo has not adopted, and `overhead --all-features` counts it as on.
