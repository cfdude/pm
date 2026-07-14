---
description: Set this repo's review-intensity dial (off / standard / thorough)
allowed-tools: Bash, Read
---

Set the conductor's **review mode** — a bounded, repo-level dial for "how many reviews, and
when," replacing an ad-hoc judgment call each time. It is a pure instruction-layer setting: the
plugin never runs a review itself, it only shapes what the CLAUDE.md rules block tells YOU (the
interactive agent) to do.

## The three modes

| Mode | Reviewer budget | Trigger |
|------|-----------------|---------|
| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |
| `standard` (default) | one fresh-context reviewer per gate | OpenSpec Gate 1/Gate 2, a Superpowers task review |
| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |

If `set-review-mode` has never been run, the mode is `standard` — this matches the default
Gate 1/Gate 2 behavior the conductor already documents elsewhere.

## Set it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-review-mode --mode thorough
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-review-mode --mode thorough`

`--mode` must be one of `off | standard | thorough`. Re-running `set-review-mode` replaces the
prior mode outright (unlike `set-autonomy`'s additive flags — there is only one active mode at a
time). It refreshes the CLAUDE.md rules block so the "Current mode" line stays accurate.

## Your ongoing responsibility once a mode is set

Read the active mode from the rules block (or `state.reviewMode`) before starting a review pass,
and size the reviewer budget accordingly — don't default back to ad-hoc judgment. This is a
repo-level setting, not per-epic: it applies uniformly regardless of which epic is active.
