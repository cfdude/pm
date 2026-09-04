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
the reconciler agent per the conductor skill's POP protocol), which clears `reconcileNeeded`.

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

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-gate-guard on`

## What it checks

Every `Edit`/`Write`/`NotebookEdit` call is checked: if the currently active epic's
`reconcileNeeded` is `true` (it still owes a reconcile — see the conductor skill's POP
protocol), the tool call is blocked with a message pointing you at the reconciler agent. Run the
reconcile gate first. Epics with no pending reconcile are unaffected.
