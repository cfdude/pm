# pm's hooks — what each one is for, and why its matcher is shaped that way

**This file exists because the rationale cannot live in `hooks.json`.** Claude Code validates that
file against a schema in which a matcher group accepts exactly `matcher` and `hooks`; a `comment`
key beside them is reported as an unknown key and ignored, printing a warning at the top of every
session in every repository the plugin is installed in. The comments were real documentation and
were moved here rather than deleted — each one records a decision that looks like a mistake to
anyone who has not read it, which is exactly the kind of note somebody "fixes" and breaks.

`scripts/test/hooks-schema.test.mjs` fails the build if an unknown key comes back.

Every command passes `--platform claude-code` and every hook is silent in a project that has not
run `/pm:init`.

## The command lines are checked, so do not hand-edit them

The engine refuses, before dispatch, any flag a verb does not declare and any positional it does
not read. The five hook verbs — `brief`, `snapshot`, `commit-nudge`, `gate-guard` and
`lesson-advice` — each declare `--platform` and refuse a valueless or unknown one, and
`scripts/test/verb-surface.test.mjs` asserts that every command line in `hooks.json` passes the
check and that the verbs marked `hook: true` in `scripts/lib/verb-effects.mjs` are exactly the
verbs this file invokes.

- **In a project without pm, a hook refuses nothing.** A line the engine would refuse still exits
  0 with no output of its own, because these hooks run in every project on the machine. A help
  token still prints help, and nothing is created.
- **In a project with pm, a refused line exits 1** — after draining the hook payload on stdin —
  and prints the refusal, e.g. `conductor: unknown flag --bogus for brief — it accepts: --platform`.
  Claude Code treats exit 1 as a non-blocking hook error. For `gate-guard` that is a deliberate
  trade: the error is shown and the tool call proceeds unguarded, because exit 2 would block every
  `Edit`/`Write`/`NotebookEdit` in every session until the plugin was fixed.

A mismatch needs this file to disagree with the engine that runs it: a hand-edited hook line, or
an installed plugin's `hooks.json` driving a checkout engine of another version under
`PM_ENGINE_DELEGATION`. **Do not hand-edit `hooks.json`**; change a hook line in the same commit as
the verb's declaration, and let the suite hold them together.

## `SessionStart` — matcher `startup|resume|compact`

Inject the project briefing (active epic, detour stack, next-up) on startup, resume, and AFTER auto-compaction (source=compact). No-ops silently in projects that have not run /pm:init.

## `PreCompact` — matcher `auto|manual`

PreCompact cannot inject context, so snapshot the freshest state (re-render PROJECT.md + write .conductor/brief.txt) right before the window collapses.

## `PostToolUse` — matcher `Bash`

Fires on EVERY Bash call by design — commit-nudge decides whether a commit happened by OBSERVING the repo, not by reading the command text. It keeps an observation record, `.conductor/commit-observe.json` (git-ignored): a **reflog anchor** — the byte size of HEAD's reflog file and its full last line, stored as bytes (`anchor.lineBase64`, because a reflog is not guaranteed to be UTF-8 and a decoded subject never matched again) — and a **reported set** of the full shas it has already named (the 500 most recent). Each run finds the anchored line by content, reads every entry after it, and reports each `commit…` entry not yet reported, oldest first, whatever happened to HEAD afterwards: a commit followed by a `checkout`, and every commit of a call that made several, are both seen. If the anchored line is gone from the reflog the run reports nothing from it and re-anchors. A commit reachable from no branch is named as rewritten or abandoned and gets no row and no attribution command. Every report says the commits landed since the last observation and may come from another terminal or a parallel call — the hook cannot tell which. It re-renders the index and nudges to update epic status / pop a finished detour only when a commit actually landed. Non-blocking, and silent in projects that have not run /pm:init.

The whole observation — read the record, walk the reflog, decide, write — runs under an exclusive lock, `.conductor/commit-observe.json.lock`, so overlapping runs (parallel Bash calls) never drop or repeat a commit. A run that cannot take the lock within 200 ms skips entirely: no report, no write, no output; the commits stay after the anchor for the next run. The lock records its holder (pid, host, pid namespace, nonce) and is broken on **liveness**, not age alone: at once when its holder is confirmed dead; after 10 s when liveness cannot be confirmed (another host or pid namespace, content not yet written); and a holder confirmed alive blocks observation, broken only past a 10-minute pid-reuse backstop. A run releases only its own lock, never one another run took after breaking it. The 0.44.0 watermark `.conductor/commit-watch.json` is neither read nor written, so an unreloaded 0.44.0 session sharing the checkout cannot clobber the record.

## `PostToolUseFailure` — matcher `Bash`

The same commit-nudge command line as `PostToolUse`. Claude Code fires `PostToolUse` only when a Bash call succeeds and `PostToolUseFailure` when it fails, so a commit made inside a call that then exited non-zero was invisible to a success-only hook. Wired on both post-call events and on no pre-call event (commit-nudge-reads-the-whole-move).

## `PreToolUse` — matcher `Edit|Write|NotebookEdit`

gate guard — on by default for any epic with reconcileNeeded:true (unconditional, `set-gate-guard off` does not bypass it). Blocks Edit/Write/NotebookEdit while the active epic still owes a reconcile after a detour POP. Dormant until /pm:init.

It also blocks (exit 2) while `.conductor/state.json` exists but cannot be read — a merge left conflict markers, the file is truncated, or it has the wrong shape — because whether a reconcile is owed cannot be known. Bash is not matched, so fix it from the shell with one of the remedies the message names: `git checkout --ours .conductor/state.json` (or `--theirs`) after a conflicted merge, `git restore .conductor/state.json` to discard local damage, or, for a file git has never had, `mv .conductor/state.json .conductor/state.json.damaged` and re-run `/pm:init`. The other hooks never write over such a file either: `brief` delivers only a warning, `snapshot` writes nothing (and never exits 2, which would block compaction), and `commit-nudge`, on `PostToolUse` and `PostToolUseFailure` alike, writes nothing — the observation record included, so a commit that landed meanwhile is reported by the first run after the file is repaired — and reports it with exit 2.

## `PreToolUse` — matcher `Bash|Edit|Write|NotebookEdit`

lesson advisor — surfaces a docs/lessons/ entry whose `detect:` matcher matches the pending tool call, BEFORE the mistake. ADVISORY ONLY: it never blocks and always exits 0, which is why it is a separate entry from the gate guard above. A SEPARATE, WIDER matcher on purpose: half the matchable lessons match on a COMMAND, so Bash must be covered or they are dead on arrival. Silent in projects that have not run /pm:init, and in any project with no docs/lessons/.
