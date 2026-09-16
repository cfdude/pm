---
description: Inspect or (partially) toggle the reconcile-gate guard
allowed-tools: Bash, Read
---

The **gate guard** is a `PreToolUse` hook that mechanically blocks `Edit`/`Write`/`NotebookEdit`
while the active epic still owes a reconcile after a detour POP (`reconcileNeeded: true`). This
is the one place pm's law tolerates mechanical blocking over pure instruction: it protects the
single highest-stakes skip (writing source before the reconcile gate actually runs).

## On by default for the reconcile-owed case

As of the `gate-guard-default-on-reconcile` change, this check is **always active** whenever
the active epic has `reconcileNeeded: true` — this applies retroactively to any epic that
already carries that flag, not just future detour POPs. It previously required an explicit
`set-gate-guard on`; real-usage feedback showed that opt-in was never actually turned on across
several sessions where it would have caught a real skip, so the default flipped after the
policy was reconsidered and approved.

**There is no bypass for this specific case.** `set-gate-guard off` no longer silences the
reconcile-owed block — the only way past it is to actually run the reconcile gate (delegate to
the reconciler agent per the conductor skill's POP protocol), which clears `reconcileNeeded`
once `record-reconcile` has answered every detour the epic was paused for with `--reconcile`.

**Nor can an ordinary verb erase the obligation.** Through 0.43.0 the render heal cleared
`reconcileNeeded` on any epic that was archived or was not the active epic, so `clear-active`,
`set-active <other>`, or archive-then-unarchive silently switched this block off, and a verdict
against the wrong detour cleared it too. Now the obligation is recorded per detour on the paused
epic's `may-invalidate` link and survives all of those: moving the active pointer off an owing epic
prints a warning naming the detours owed, and the block returns when the epic is active again.
`record-reconcile` accepts a verdict only against an armed detour whose frame has been popped.

**The one clear the heal still makes is announced.** An epic carrying `reconcileNeeded: true` with
no detour frame pausing it and no armed or pre-0.44.0 `may-invalidate` link has nothing a verdict
could ever be recorded against, so leaving the flag would block edits permanently. The engine
cannot produce that state itself (a push always arms a link, and removing an armed one is refused);
it comes from a hand-edited file or from the 0.44.0 stamp on an owing epic whose every link already
carried a verdict. The heal clears it and says so on stderr:

```text
conductor: cleared the reconcile obligation on 'q' — it holds no may-invalidate link a verdict could be recorded against and no detour frame pausing it, so no record-reconcile could ever be accepted and it would have blocked the epic permanently
```

## Opt-OUT for the tracker-refresh case

A second check rides the same hook and behaves the opposite way: when the active epic owes a
**tracker refresh** (it is linked to an external item and became active without that item being
re-read), `Edit`/`Write`/`NotebookEdit` are blocked **only while `set-gate-guard on`**. Turning
the guard off silences this one and leaves the reconcile block above untouched.

The escape hatch is deliberate and not optional. An agent that is offline, unauthenticated, or
facing a deleted upstream item has to be able to proceed honestly — a `--verdict unchanged`
recorded blind is a worse outcome than a bypass someone can see. Clear the obligation properly
with `record-tracker-refresh <id> --verdict unchanged|material-change --external-updated-at <iso>`.

## `set-gate-guard on|off`

The repo-level `gateGuard` flag in `.conductor/state.json` is what the tracker-refresh check
above reads. It has no effect on the reconcile-owed check, which is unconditional.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-gate-guard on
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-gate-guard off
```

## `set-gate-guard` with no argument — READS

`set-gate-guard` wrote and confirmed the write, and nothing anywhere read it back, so "is the
guard on?" was answerable only by opening `.conductor/state.json` — which is what a read verb
exists to avoid. A bare invocation now prints the state, what the guard enforces, and what it
does NOT tell you. It exits 0, writes nothing, and does not re-render `PROJECT.md`.

```
GATE GUARD — on.

  The reconcile gate is ALWAYS enforced, whatever this flag says: an epic carrying
  `reconcileNeeded` blocks Edit/Write/NotebookEdit until a verdict is recorded, and
  `set-gate-guard off` does not reach that case.
  This flag additionally enforces the TRACKER REFRESH obligation.

  BLOCKING NOW: 't3' owes a tracker refresh.
  'on' alone never means something is blocked — the guard also needs a live active
  epic that owes one of those two things.

  Change it with `set-gate-guard on|off`.
```

The last section is the half that matters, and it is the reason this is a report rather than a
one-line echo: **`on` does not mean anything is currently blocked.** The guard also needs a live
active epic — one that exists and is not archived — which owes a reconcile or a tracker refresh.
Reading `gateGuard: true` plus a silent hook and concluding the guard was broken is exactly the
inference this removes. The blocked line is computed from the active epic, so it reports
`BLOCKING NOW: '<id>' owes a reconcile` even while the flag reads `off`, matching the
unconditional reconcile case above.

**The reader lives on the toggle and deliberately NOT on `gate-guard`, which is unchanged.** That
verb is the `PreToolUse` hook (`hooks/hooks.json`): it blocks with stderr and exit 2, and it
ALLOWS by returning silently with empty stdout and exit 0. Its stdout is protocol surface, so a
human-readable report printed there would corrupt it. The silence is the allow signal, not a
broken command.

## The command line

**A help token never toggles the guard.** `set-gate-guard off --help` prints `set-gate-guard`'s
help, exits 0 and leaves the guard as it was; from 0.41.0 through 0.43.0 it exited 0 having set
`gateGuard: false`. The same holds for `-h`, and for a help token anywhere after the verb.

**`set-gate-guard` reads one positional, `on` or `off`.** A second one, or a flag it does not
declare, is refused before anything is written. `--force` is accepted (it is a mutating verb) and
is never read as the positional: `set-gate-guard --force` prints the same report as bare
`set-gate-guard`.

**The `gate-guard` hook verb declares `--platform`**, which `hooks/hooks.json` passes as
`--platform claude-code`, and refuses a valueless or unknown one. Any other flag on its line is
refused.

**A refused hook line fails OPEN, deliberately.** In a repository that has run `/pm:init`, a
`gate-guard` line carrying a flag it does not declare exits **1**, after draining the hook payload
on stdin:

```text
conductor: unknown flag --bogus for gate-guard — it accepts: --platform
Nothing was written.
```

Claude Code treats exit 1 as a non-blocking hook error: the error is shown and the tool call
proceeds **unguarded**. Exit 2 would block every `Edit`/`Write`/`NotebookEdit` in every session until
the plugin was fixed, which is the worse failure. Within one plugin version this needs pm's own
`hooks/hooks.json` to disagree with its own engine, and the test suite asserts every hook line in
that file passes the check. Two ways remain: a hook line edited by hand, and an installed plugin's
`hooks.json` driving a checkout engine of a different version under `PM_ENGINE_DELEGATION`. So
**do not hand-edit `hooks/hooks.json`**; if the guard's hook errors on every tool call, update the
plugin so its hook file and engine match. In a repository without pm the hook verbs refuse
nothing and stay silent, as they always have.

That is the opposite polarity from an unreadable `state.json`, which fails **closed** with exit 2
(below). The difference is what cannot be read: a refused command line is pm's own hook file out of
step with its engine, while an unreadable state file means whether a reconcile is owed is unknown.

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-gate-guard on`

## What it checks

Every `Edit`/`Write`/`NotebookEdit` call is checked: if the currently active epic's
`reconcileNeeded` is `true` (it still owes a reconcile — see the conductor skill's POP
protocol), the tool call is blocked with a message pointing you at the reconciler agent. Run the
reconcile gate first. Epics with no pending reconcile are unaffected.

## An unreadable `state.json` blocks — fails CLOSED

If `.conductor/state.json` exists but cannot be read — a merge left conflict markers in it, it is
truncated, or its shape is wrong (not a JSON object, `epics` present and not an array or holding a
non-object, `detourStack` present and not an array) — the guard **blocks every
`Edit`/`Write`/`NotebookEdit` with exit 2** until the file is fixed. Before this, the same file
with a conflict marker prepended exited 0 and silently disabled the unconditional reconcile block,
exactly when the record saying whether one is owed could not be read; with `epics: {}` the hook
crashed with a `TypeError` (exit 1, which Claude Code also treats as allow).

The hook's output with a conflict marker at the top of the file:

```text
conductor: .conductor/state.json cannot be read — it does not parse as JSON (Unexpected token '<', "<<<<<<< HE"... is not valid JSON). Nothing was written.
  If a merge left conflict markers:  git checkout --ours .conductor/state.json   (or --theirs)
  If the markers were committed:     git show <good-rev>:.conductor/state.json > .conductor/state.json
  To discard local damage:           git restore .conductor/state.json
  Never committed (git has no copy): mv .conductor/state.json .conductor/state.json.damaged
                                     then /pm:init   (the damaged bytes are kept beside it)
  Then re-run the command.
  gate guard: Edit/Write/NotebookEdit stay blocked until the file is fixed — whether a reconcile is owed cannot be read. Bash is not blocked: run one of the commands above.
```

**This is not a wedge, because Bash never reaches this hook.** The engine refuses on an unreadable
file whatever tool the payload names; what keeps Bash open is `hooks/hooks.json`, which registers
`gate-guard` for the matcher `Edit|Write|NotebookEdit` only. Every remedy the message names is a
shell command, so fix the file from Bash:

- a merge left conflict markers → `git checkout --ours .conductor/state.json` (or `--theirs`);
- the markers were committed → `git show <good-rev>:.conductor/state.json > .conductor/state.json`;
- local damage → `git restore .conductor/state.json`;
- git has never had the file (a repo damaged before its first commit) →
  `mv .conductor/state.json .conductor/state.json.damaged`, then `/pm:init`. `init` itself refuses
  while the damaged file is in place, and the move keeps its bytes beside the new one.

Do not allow an Edit/Write aimed at `state.json` itself as a way out — that was considered and
declined: it would widen the one unconditional block with a path match on tool input, and every
remedy above is already reachable through Bash. An ABSENT `state.json` is still dormancy: the hook
exits 0 silently in a repo that has not run `/pm:init`.
