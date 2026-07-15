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
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-review-mode --mode thorough`

`--mode` must be one of `off | standard | thorough`. Re-running `set-review-mode` replaces the
prior mode outright (unlike `set-autonomy`'s additive flags — there is only one active mode at a
time). It refreshes the CLAUDE.md rules block so the "Current mode" line stays accurate.

## Your ongoing responsibility once a mode is set

Read the active mode from the rules block (or `state.reviewMode`) before starting a review pass,
and size the reviewer budget accordingly — don't default back to ad-hoc judgment. This is a
repo-level setting: it applies uniformly regardless of which epic is active, EXCEPT where a
single epic has an escalation-only override (below).

## Per-epic override (escalate only, never de-escalate)

A single epic can be forced to a stricter mode than the repo-global dial — e.g. a
security-sensitive epic in an otherwise `standard` repo — without flipping the whole repo to
`thorough`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> --review-mode thorough
```

Rules:
- The override may only ESCALATE above the repo-global dial (`off` < `standard` < `thorough`).
  An attempt to set an epic's `--review-mode` BELOW the current global dial is rejected outright
  (non-zero exit, state unchanged) — an epic can never quietly weaken review rigor a human
  explicitly raised repo-wide.
- The effective mode for a given epic is `max(global dial, that epic's override)`. Query it with
  `conductor.mjs rules --epic <id>` (look for "Current mode" in the emitted block), or read
  `state.epics[].reviewMode` directly alongside `state.reviewMode`.
- If the repo-global dial is later raised above a previously-set epic override, the global dial
  wins again for that epic — the override never pins a *lower* effective mode than the current
  global dial; it only ever adds a floor above it.
- Clearing an override requires setting `--review-mode` to a value at or above the current global
  dial (there is no separate "unset" — set it equal to the current global dial to make the
  override a no-op).
