## Why

The reconcile gate guard is the one place pm's architectural law tolerates a mechanical block
instead of an instruction, and it is wired to `PreToolUse` with the matcher
`Edit|Write|NotebookEdit` (`hooks/hooks.json`). A `Bash` call never reaches it, so an agent
blocked on `Edit` writes the same file with `cat > f <<EOF`, `sed -i` or `tee` and the gate it
exists to protect is skipped in one hop. The block's own message says
"Completing the reconcile gate is the only way through", which is false as shipped.

Reproduced on 0.45.0 in a hermetic scratch repo
(`.../scratchpad/propose-46/the-guard-covers-every-write-path`), created with `init`, epics `p`
and `d`, `push-detour p --detour d --reconcile`, `pop-detour p` — `p` then carries
`reconcileNeeded: true`:

- `gate-guard` fed `{"tool_name":"Edit",...}` exits **2** with the message above.
- `gate-guard` fed `{"tool_name":"Bash","tool_input":{"command":"cat > src/x.js <<EOF..."}}`
  also exits 2 — the verb ignores `tool_input` entirely. The gap is therefore **purely the
  matcher**: the hook is never invoked for a Bash call, so that heredoc runs unguarded.
- Widening the matcher naively would wedge the repository. In a copy of the same repo with a
  conflict marker prepended to `state.json`, `gate-guard` fed
  `{"tool_name":"Bash","tool_input":{"command":"git restore .conductor/state.json"}}` exits
  **2** — the unreadable-state fail-closed path. Every remedy that path names is a shell
  command, so under a `Bash` matcher the guard would block the only way out of its own block.

## What Changes

- `hooks/hooks.json` registers the gate guard for `Bash` as well as `Edit|Write|NotebookEdit`.
- The guard reads the drained hook payload it already discards, and for a call whose
  `tool_name` is affirmatively `Bash` it blocks only when the command text matches a **closed,
  documented list of write shapes** (redirection to a file, in-place editors, `tee`, copiers,
  patchers). Anything else passes.
- A tool the payload does not identify — absent, unparseable, or an unknown `tool_name` — is
  treated as a write tool and blocks exactly as today, and so is a payload naming `Bash` with no
  readable command. No existing behaviour moves.
- **Destroying the conductor record is on the shape list.** `rm .conductor/state.json` is not a
  smaller evasion than a heredoc — the guard is dormant while no record exists, so deleting it
  turns the block off entirely, and `mv` and `truncate` were already on the list. The match is on
  the record's exact path, never a prefix, so the `rm .conductor/state.json.lock` remedy the engine
  itself prints stays runnable.
- **An invocation of pm's own engine is never a command-word write shape**, so the commands the
  gate names as the way through it — and the sibling change's `drop-detour` — stay reachable as
  the list grows. A redirection in the same segment still blocks, so the exemption is not a bypass.
- The unreadable-state branch **allows an affirmed Bash call unconditionally**, whatever shape
  it has, because the remedy `git show <rev>:.conductor/state.json > .conductor/state.json` is
  itself a write shape. Wedge-freedom stops resting on "Bash is not matched" and starts resting
  on this exemption, which is the requirement being modified.
- The block message names the matched shape with a **fixed label from the closed list and no text
  taken from the command**, and states that a Bash write is forbidden whether or not the check sees
  it. It drops today's "Completing the reconcile gate is the only way through", which this change
  does not make true either. The guard's docs state plainly what it cannot see.
- The check is **incomplete by construction** and says so: `eval`, a variable-built path, a
  script invoked by name, `python -c`, a program that writes files of its own accord — all
  undecidable from a command string. Two fail-open modes are named for the first time: an
  unreadable record allows every Bash call, and an absent record leaves the guard dormant. The
  instruction layer stays primary; the hook is a backstop, not a shell parser.
- No new bypass. The reconcile branch's Bash coverage ships **without** an inverse,
  deliberately: any switch that silenced Bash writes would be a bypass for the whole reconcile
  gate. The tracker-refresh branch's Bash coverage inherits the inverse it already has
  (`set-gate-guard off`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gate-integrity`: the unconditional reconcile block covers Bash write shapes, names what it
  matched, and declares what it cannot decide.
- `state-write-guard`: the unreadable-state hook requirement's gate-guard bullet — its matcher
  and the mechanism that makes the block wedge-free.
- `tracker-sync`: the opt-out tracker-refresh block extends to the same Bash write shapes,
  keeping its existing inverse.
- `managed-rules-block`: the marker refusal's shell remedy is no longer justified by "Edit and
  Write are blocked" — that `sed` is itself a recognized write shape now, and the interaction is
  stated rather than left to be discovered.

## Impact

- `hooks/hooks.json` (matcher), `hooks/README.md` (per-matcher rationale, asserted by
  `scripts/test/hooks-schema.test.mjs`).
- `scripts/lib/gate-guard.mjs` (payload-aware branch, write-shape scan, messages).
- `scripts/lib/state.mjs:201`, `scripts/lib/refusal.mjs:18`, `skills/conductor/SKILL.md:206`,
  `README.md:1593` and `commands/gate-guard.md` — each asserts in prose that Bash is not matched,
  not blocked, or never reaches the hook; all become false or need their reason restated.
- `scripts/lib/rules.mjs` — a sentence in the emitted managed rules block, so an agent reads the
  Bash obligation before it reaches for a heredoc. Repo state: it lands on `/pm:upgrade`.
- `scripts/test/hooks-schema.test.mjs` — its README assertion is keyed on the matcher string and
  goes vacuous once both PreToolUse entries share one; it is re-keyed on the hook's command.
- `scripts/test/conductor-28.test.mjs` reasons about the guard/advisor matcher asymmetry.
- No dependency change: the scan is built-in string work only.
