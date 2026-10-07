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
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-review-mode --mode thorough`

`--mode` must be one of `off | standard | thorough`. Re-running `set-review-mode` replaces the
prior mode outright (unlike `set-autonomy`'s additive flags — there is only one active mode at a
time). It refreshes the CLAUDE.md rules block so the "Current mode" line stays accurate.

### If the rules block cannot be located — exit 11

The block is found by whole marker LINES, and anything other than exactly one BEGIN line followed by
one END line — an orphan marker, or two blocks — is refused rather than guessed at. With a second
copy of the block appended to `CLAUDE.md`:

```text
$ conductor.mjs set-review-mode --mode thorough
conductor: refused to write the pm rules block into CLAUDE.md — its marker lines are not exactly one BEGIN line followed by one END line, so which text is managed cannot be known:
  line 3: BEGIN
  line 379: END
  line 381: BEGIN
  line 757: END
  Delete the stray marker line(s) from the shell, highest line number first, e.g.:
    sed -i.bak '<N>d' CLAUDE.md
  (a whole managed block is safe to delete; hand-written text between markers is yours to keep).
  The rules file, and every write this command makes after it, were NOT made. After fixing the markers, run `write-rules` and then `render` (or /pm:status) to complete it.
```

Unlike `init` and `upgrade`, this verb refuses AT the block write, after its state save. So
`state.reviewMode` already reads `thorough`, while `CLAUDE.md` and `PROJECT.md` were not written —
and `verify-state` reports PROJECT.md as stale until they are. That is why the message says to run
`write-rules` then `render` rather than to re-run the verb. Delete the stray marker lines (here,
the whole second block), then `write-rules` and `render` (or `/pm:status`); after that `CLAUDE.md`
carries `Current mode: **thorough**.` and `verify-state` reports that the last render is current.

An unreadable `.conductor/state.json` is refused before anything is written, exit 11, with the git
remedies (see `/pm:gate-guard`).

## Your ongoing responsibility once a mode is set

Read the active mode from the rules block (or `state.reviewMode`) before starting a review pass,
and size the reviewer budget accordingly — don't default back to ad-hoc judgment. This is a
repo-level setting: it applies uniformly regardless of which epic is active, EXCEPT where a
single epic (or lane) carries its own value (below).

Then RECORD the verdict, whatever the lane. This dial is lane-agnostic — the table above names a
Superpowers task review — and `record-gate-review` now accepts any lane to match, with each gate's
own evidence (`record-gate-review <id> --gate 1 --verdict pass|fail --artifact <path>` for a spec
review, `record-gate-review <id> --gate 2 --verdict pass|fail --base-sha <a> --head-sha <b>` for an
implementation review), so a review this dial asked for has somewhere to land as checkable fields
instead of prose. Recording one creates no archive obligation: the
archive gate remains openspec-only. See `/pm:epic`'s "Record a gate verdict".

## Per-epic override (any direction; most specific wins)

A single epic can carry its own review mode, stricter OR looser than the repo-global dial — a
security-sensitive epic in an otherwise `standard` repo, or a docs tweak in a `thorough` one:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> --review-mode thorough
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic --id <id> --lane claude-code --review-mode off
```

Rules:
- The effective mode for an epic is resolved most-specific-wins: **the epic's own value, else its
  lane's (`set-profile --lane <lane> --review <m>`), else the repo-global dial, else `standard`.**
  It is NOT the maximum of the layers: an epic set BELOW the dial resolves to its own lower value.
  Earlier versions refused that ("escalate only"); that refusal is gone by decision. What replaces
  it is visibility: `conductor.mjs profile --epic <id>` and `rules --epic <id>` name the layer each
  value came from and, when an epic lowers a value, the higher value it overrides, and the activity
  log records the change.
- `--review-mode` is accepted by `add-epic`, `add-many` (as the batch key `reviewMode`) and
  `update-epic`.
- Query the effective value with `conductor.mjs rules --epic <id>` (look for "Current mode") or
  `conductor.mjs profile --epic <id>`.
- Clear an override with `update-epic <id> --clear review-mode`: the epic then follows its lane's
  value, or the repo dial. Note that this may be higher OR lower than what the epic held.
- The repo-wide dial has its inverse too: `set-review-mode` ships none of its own, and
  `set-profile --unset review` is it (it removes the recorded dial, so the default `standard`
  applies again).

## When several changes are reviewed as one release candidate

Building a release from several changes, the budget applies **per candidate, not per change**: the
converged review runs at the HIGHEST effective `review` among the candidate members (the members that
are not archived and have built work), so one `thorough` member makes the whole candidate `thorough`.
When members resolve to different levels the procedure names each and recommends splitting the
candidate by level. The whole procedure — batching, one integration branch, one capped review round,
recording the same range as every member's Gate 2 — is the `release-candidate` skill.

This dial is one field of the **execution profile**, which also carries the model and effort per
job role and a verbosity level. See `/pm:profile`.
