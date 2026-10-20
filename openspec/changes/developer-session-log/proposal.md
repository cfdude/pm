# Proposal: developer-session-log

## Why

Rob, 2026-10-13: a developer working on pm, or tuning a repo that uses it, needs to see per session which
pm features were on, what went into each request, what came back, the full token breakdown, and when a
session has been kept alive too long ("same context window for seven days without a new session"). The
spend ledger answers "which epic spent it"; it deliberately stores no content shape, and it has no
per-session view or retention warning.

Rob suggested a dependency for this. The engine is zero-runtime-dependency (`CLAUDE.md`, "The `pm`
engine — hard constraints"), and a plain append-only JSONL file with Node built-ins is enough: the ledger
already is one.

## What Changes

- **An opt-in, off by default:** `set-dev-log on|off`, an `OPT_INS` row `devLog`, never enabled by `init`
  or `upgrade`. It requires spend tracking on, because it rides the same ingest pass and the same
  transcript reader.
- **Composition, not content.** During `spend`'s ingest, for each assistant message, a `devlog.jsonl`
  entry records the request's new content as byte counts by kind (user text, tool results per tool name,
  attachments and system reminders, image count) and the response's text and thinking bytes. Token counts
  and tool names are NOT copied: the report joins the ledger row with the same `messageId`. Like the
  ledger, nothing stored contains prompt, response, tool input or output text.
- **Which features were on.** Each ingest appends a `features` snapshot (the opt-in states and pm's
  per-surface overhead from `pm-overhead`) when it differs from the last one.
- **`dev-log [--session-id <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]`** reports per
  session: message count, first and last time, the token classes and `work`, composition totals, the
  features snapshot in force, and the warnings.
- **Context-retention warnings, owned here:** `stale-session` (first to last message at least 7 days,
  Rob's example), `large-context` (a message whose context exceeds a named threshold), `compacted` (the
  transcript records a compaction).
- **Its inverse:** `dev-log --clear`, plan first, `--yes` to act. `set-dev-log off` deletes nothing.

## Capabilities

### New Capabilities

- `developer-session-log`: the opt-in, the composition capture, the features snapshot, the per-session
  report, the retention warnings and the clear.

### Modified Capabilities

None. It extends ingest behind its own switch without changing any `spend-ledger` requirement: no hook
reads a transcript, stored data holds counts and identifiers only, and the file sits in the git-ignored
spend directory.

## Impact

- Engine (Node built-ins only): the ingest module (an extra pass over the entries ingest already reads,
  only while the log is on), a new `scripts/lib/dev-log.mjs`, `opt-ins.mjs`, `constants.mjs`,
  `verb-effects.mjs`, `conductor.mjs`.
- State: additive optional `state.devLog = {enabled, enabledAt}`. No migration.
- Files: `.conductor/spend/devlog.jsonl` (already git-ignored with the spend directory).
- Docs: `commands/dev-log.md` and `commands/set-dev-log.md` with parity-ledger claims, changeset, README.
- Depends on `pm-overhead-baseline` (the overhead numbers in the snapshot) and `gh-cfdude-pm-251` (`work`).
