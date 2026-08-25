---
description: Upgrade this repo's conductor state/rules to the current pm plugin version
allowed-tools: Bash, Read
---

> **Before running this command:** if the SessionStart briefing shows an upgrade is
> available (e.g. "pm 0.4.0 → 0.4.1 available"), run `/reload-plugins` (or restart
> Claude Code) **first** so this command uses the new engine. If you instead see a
> message like "this is pm 0.4.0 but 0.4.1 is installed", that is the reload reminder —
> the upgrade has not run yet. Reload, then come back and run `/pm:upgrade`.
>
> **If you're seeing this file's contents in your context right now, `/pm:upgrade` was
> just invoked — execute it.** When `/reload-plugins` and `/pm:upgrade` land in the same
> turn (exactly the sequence recommended above), the harness wraps that turn's local
> command output in a caveat meant for passive stdout (e.g. `/reload-plugins`'s "Reloaded:
> N plugins" line) — it does NOT mean this command's instructions are passive output too.
> This file being loaded is the user's request; do not respond with "no action needed" or
> similar and skip the steps below.

Bring this repository in line with the currently-installed `pm` plugin version. Safe to run
anytime; idempotent. Use it when the briefing shows a "pm <old> → <new>" upgrade nudge.

1. Run the engine's upgrade (applies any pending migrations, refreshes the managed rules block
   in whichever file the recorded platform reads — `CLAUDE.md` for Claude Code, `AGENTS.md` for
   Codex, first-match-wins over `HERMES.md` > `AGENTS.md` > `CLAUDE.md` for Hermes — re-renders
   PROJECT.md, and re-stamps the recorded version). If this repo's `.conductor/state.json` predates
   `0.24.0` and has no `platform` field, the migration stamps `platform: "claude-code"` — the
   platform this repo was already running on — so the rules block keeps landing in the same file
   it always has:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" upgrade
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" upgrade`

2. **Review the changelog delta and recommend adoption.** The command prints "What's new in pm
   (since \<old\>)" — the `### Added` headlines for every version between the repo's old and new
   `pmVersion`. Don't just display these and move on: read each one, judge whether it describes an
   **opt-in capability** (a new flag, a new `set-*` subcommand, a new tracker/autonomy/review-mode
   behavior — as opposed to a bug fix, an internal refactor, or something that applies
   automatically with no action needed) that is **relevant to this repo** given its current
   `.conductor/state.json` (e.g. it already has a tracker configured but hasn't set up secondary
   trackers; it never turned on `thorough` review mode despite touching schema-sensitive files).
   For each one that's a plausible fit, recommend it to the user in one line with a one-line
   reason and the command that would enable it — do not enable anything yourself. If nothing in
   the delta is opt-in or relevant, say so briefly rather than silently skipping the review.

3. **Tracker awareness (optional; only if not already set).** If `.conductor/state.json` has no
   `tracker` block AND there is a *real* signal that work is actively managed in an issue tracker
   (a connected/in-use tracker MCP, issue-key conventions, or an explicit note), *offer* it as a
   choice via the `/pm:tracker` procedure. **Do not infer a tracker from the Git host** — being on
   GitHub/GitLab/Bitbucket is not a signal. Reassure that declining loses nothing: the conductor
   keeps tracking everything locally in `.conductor/state.json` + `PROJECT.md`; a tracker only adds
   an external mirror. If a `tracker` block already exists, leave it untouched.

4. Show the result with `/pm:status`.

## What `0.27.0`'s migration does

One entry, additive, idempotent and backward-compatible — a `state.json` written by `0.26.0` still
loads, and a second run changes nothing. It reads nothing outside `state`, because a migration
that consulted disk would produce a different result on a machine whose checkout sits at a
different commit.

1. **Tracker direction is stamped with the behavior each tracker already has** — a
   `github-issues` primary → `inward`, any other primary → `outward`, every secondary entry →
   `inward`. `both` would be wrong for an existing non-`github-issues` primary in the direction
   that costs something: a Jira tracker receives *only* the outward section today, so `both` would
   grant an inward pull no repo has ever had and `/pm:sync` would start registering an untriaged
   epic per open issue. An explicitly set `direction` is never overwritten.
2. **Every ARCHIVED epic gets a terminal outcome, regardless of lane** — `delivered` only where a
   passing Gate 2 exists, `unknown` everywhere else, both carrying `recordedBy: "migration"` so a
   later rule can key on which path wrote the stamp. Lane-scoping this would be wrong on measured
   data: of pm's own 69 archived epics only 3 are openspec-lane, so stamping one lane would leave
   66 with no outcome and the outcome invariant would fail on its own repository the instant the
   migration ran. `unknown` is not a hedge — it says nobody recorded a disposition, which is
   exactly true. An existing disposition is never overwritten.

**Then expect a burst of `heal-archived-epic-passed-gate-2` on your first `/pm:integrity`.** The
migration only stamps epics that are already `archived` in state; the archive-drift heal flips the
rest to `archived` *afterwards* and stamps them `unknown` at that moment. So every repo that
followed the documented `/opsx:archive` → heal flow lands on `unknown` rather than `delivered`,
by one step. That is the expected shape, not a bug. The check names the exact remedy —
`update-epic <id> --status archived --outcome delivered --no-deferrals` — and the archive gate
lets an agent replace an engine-written stamp, so nothing is stuck at `unknown`.

**Two things about the emitted output will differ from `0.26.0`, deliberately.** The "Sync after
completing tracker-linked work" reminder now leaves the rules block where no inward procedure is
emitted, and the brief's `consider /pm:sync` nudge now leaves outward-only repos. A third
difference is in progress rendering: `· N lifecycle` where tasks carry the
`<!-- pm:lifecycle -->` marker. Treat a fourth as a regression.

## If an upgrade goes wrong — git is the rollback

There is no undo verb, and there does not need to be one: `.conductor/state.json` is
git-tracked in every repo that uses pm, so the file itself is the backup.

1. **Commit `state.json` before upgrading.** A restore discards every uncommitted state change
   since the last commit, not only the migration's.
2. Restore it and re-render the generated view:

   ```bash
   git restore .conductor/state.json
   ```

   then `/pm:status` (PROJECT.md is generated from state — never hand-edit it back).
3. **Rolling back state does not require rolling back the engine.** Every field this release
   added has a documented absent-value default, so the current engine behaves identically on a
   restored older state file; keep working while the problem is diagnosed. Rolling back the
   *engine* is a separate, plugin-level operation — pin the marketplace source to the prior ref
   and `/reload-plugins`.
