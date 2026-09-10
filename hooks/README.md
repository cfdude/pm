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

## `SessionStart` — matcher `startup|resume|compact`

Inject the project briefing (active epic, detour stack, next-up) on startup, resume, and AFTER auto-compaction (source=compact). No-ops silently in projects that have not run /pm:init.

## `PreCompact` — matcher `auto|manual`

PreCompact cannot inject context, so snapshot the freshest state (re-render PROJECT.md + write .conductor/brief.txt) right before the window collapses.

## `PostToolUse` — matcher `Bash`

Fires on EVERY Bash call by design — commit-nudge decides whether a commit happened by OBSERVING the repo (a HEAD watermark plus the reflog action), not by reading the command text, so it must see every call to keep the watermark truthful. It re-renders the index and nudges to update epic status / pop a finished detour only when a commit actually landed. Non-blocking, and silent in projects that have not run /pm:init.

## `PreToolUse` — matcher `Edit|Write|NotebookEdit`

gate guard — on by default for any epic with reconcileNeeded:true (unconditional, `set-gate-guard off` does not bypass it). Blocks Edit/Write/NotebookEdit while the active epic still owes a reconcile after a detour POP. Dormant until /pm:init.

## `PreToolUse` — matcher `Bash|Edit|Write|NotebookEdit`

lesson advisor — surfaces a docs/lessons/ entry whose `detect:` matcher matches the pending tool call, BEFORE the mistake. ADVISORY ONLY: it never blocks and always exits 0, which is why it is a separate entry from the gate guard above. A SEPARATE, WIDER matcher on purpose: half the matchable lessons match on a COMMAND, so Bash must be covered or they are dead on arrival. Silent in projects that have not run /pm:init, and in any project with no docs/lessons/.
