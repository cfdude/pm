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
