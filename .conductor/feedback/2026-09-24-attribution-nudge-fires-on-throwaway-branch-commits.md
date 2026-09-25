# The commit-watch attribution nudge tells you to attribute a commit made on a throwaway branch

**Kind:** bug

## What happened

While applying node-support-policy (0.49.0, tasks 4.5 and 8.3) three commits were made on a throwaway
branch (`ci-verify-049`) to drive a draft PR's CI: a 404 schedule URL, a mismatched fallback, a bench
job. The branch was never merged and was deleted afterwards. After each of those commits the
PostToolUse hook printed:

> ATTRIBUTION — record this commit against its epic now, before the next one:
> `update-epic node-support-policy --attribute-commit <sha>`

Following that instruction would have recorded three commits that exist on no branch into the epic's
`attributedCommits` — and since every attributed commit must be reached by the recorded Gate 2
`headSha`, it would have made the epic's Gate 2 unrecordable (the reviewed dev head does not reach
them) until each was withdrawn with `--withdraw-commit`.

## Suggestion

The nudge is an instruction the agent is expected to obey. Scope it: only nudge for a commit on the
branch the active epic's work lives on (or on the repository's development branch), or at minimum
say which branch the commit landed on and that commits on a branch that will not be merged must not
be attributed — the same kind of exclusion the nudge already states for the archive move.
