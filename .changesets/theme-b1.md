* **`update-epic --attribute-commit` records a commit once.** A commit the epic already attributes (or one given
  twice in a call, `HEAD` and its full sha included) is now a no-op: exit 0, a line on stderr naming it, nothing
  written for it. Retrying an attribution after a failed commit hook no longer inflates the array Gate 2
  reachability and `integrity` reason over. (gh#237)
* **The attribution array is read as a set, and nothing depends on its order.** After a catch-up of an earlier
  commit the array's last entry is an ancestor of the rest; the stale-Gate-2 remedy no longer tells you to record
  `--head-sha <the last attributed commit>` and now names "the attributed commit every other one is an ancestor
  of" and "the parent of the earliest attributed commit", and `integrity`'s bookkeeping arm dates "the merge
  commit" by the latest commit instead of the last element. Re-attributing the head to repair the order is
  unnecessary. (gh#216)
* **Attributing a commit that turns a passing Gate 2 stale now says so.** `--attribute-commit` prints that the
  verdict moved to stale and names both ways out: re-record Gate 2 if the commit changed the implementation, or
  `--withdraw-commit` if it was lifecycle bookkeeping (lessons routed after the gate, the task-list tick). The
  ordering rule is documented in the attribution task item: commit such work before recording Gate 2, and do not
  attribute it where you cannot. The commit is still recorded nowhere the engine reads. (gh#205)
* **A Gate 1 verdict goes stale when a reviewed artifact is amended.** `record-gate-review --gate 1 --artifact`
  now stores a sha-256 per readable artifact as `artifactDigests` beside the unchanged `artifacts` paths; amending
  an artifact reads `⚠ stale` on `/pm:status` and the brief, an unreadable one (or a verdict recorded before this
  release) reads `⚠ unverifiable`, never stale. The archive move is not an amendment. It never blocks an archive.
  (gh#198)
* **`update-epic` refuses contradictory deferral assertions and a directory as a plan.** `--no-deferrals` together
  with `--deferral` or `--declined-deferral` is refused by name with nothing written (gh#233). `--plan` / `--spec`
  on `update-epic` and `add-epic` refuse a trailing-slash value and a path that exists and is not a regular file;
  a path that does not exist yet is still accepted (gh#232).
