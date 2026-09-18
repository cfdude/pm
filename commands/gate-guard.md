---
description: Inspect or (partially) toggle the reconcile-gate guard
allowed-tools: Bash, Read
---

The **gate guard** is a `PreToolUse` hook that mechanically blocks `Edit`/`Write`/`NotebookEdit`
— and a `Bash` call whose command text matches one of a closed, documented list of write shapes —
while the active epic still owes a reconcile after a detour POP (`reconcileNeeded: true`). This
is the one place pm's law tolerates mechanical blocking over pure instruction: it protects the
single highest-stakes skip (writing source before the reconcile gate actually runs).

Its matcher is **`Bash|Edit|Write|NotebookEdit`** (`hooks/hooks.json`). Bash is covered because a
guard that matched only the editing tools was one hop from useless: an agent blocked on `Edit`
writes the same file with `cat > f <<EOF`, `sed -i` or `tee`. What that added coverage can and
cannot decide is set out under "The Bash write shapes" below.

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

Every `Edit`/`Write`/`NotebookEdit` call is checked, and so is every `Bash` call whose command
text resolves to one of the write shapes below: if the currently active epic's `reconcileNeeded`
is `true` (it still owes a reconcile — see the conductor skill's POP protocol), the tool call is
blocked with a message pointing you at the reconciler agent, naming the shape it matched when it
matched one. Run the reconcile gate first. Epics with no pending reconcile are unaffected.

## The Bash write shapes — a closed list, and what it cannot see

The guard reads `tool_name` from the hook payload. Only an **affirmatively-identified** `Bash`
call takes the shape path; anything else — `Edit`, an unknown tool name, an unparseable payload,
an absent payload, or a `Bash` payload carrying no readable command — takes today's blocking path
unchanged. That direction is deliberate: defaulting an unidentifiable call to the allow path would
be a silent hole in the one unconditional block pm ships.

The list is **closed**, and each row matches a FIXED label the block message prints — never the
matched path or any slice of the command, so the message interpolates no text the engine did not
write. It blocks:

| Shape | Label |
|---|---|
| a redirection into a file — `>`, `>>`, `&>`, `&>>`, `>\|` or `>&`, optionally preceded by fd digits, with a path target | `a redirection into a file` |
| a segment-leading `sed` / `gsed` / `perl` / `ruby` carrying `-i…` or `--in-place[=…]` | `an in-place stream editor` |
| a segment-leading `tee` with a non-device argument | `tee` |
| a segment-leading `cp`, `mv`, `install`, `rsync`, `dd`, `truncate`, `patch` | that command's name |
| a segment-leading `git apply` | `git apply` |
| removing the conductor record with `rm`, `unlink` or `shred` — or `git rm`/`git mv` — where the written argument names the record itself | `a write to the conductor record` |

**Destroying the record is on the list**, because it is not a smaller evasion than writing over a
file: the guard is dormant while no record exists, so `rm .conductor/state.json` turns the whole
block OFF, and the call after it passes. **The record match is on the exact path, and that is what
keeps pm's own remedies runnable.** It matches `.conductor`, `.conductor/state.json`, a `/*` glob
of the directory, and a trailing `*` on either name (`.conductor/state.json*`, `.conductor*`) at
any directory prefix, with one surrounding quote stripped from each end — the written argument as
it expands names the record. It is **never a longer literal filename beneath it**, so
`rm .conductor/state.json.lock` — the remedy the engine's own lock refusal prints, as the literal
path — stays runnable, and the lock-only glob `.conductor/state.json.*` (which cannot expand to the
record) stays the runnable spelling for lock cleanup. `state.json*` IS blocked even though it would
also reach the lock, and that costs nothing because pm prints the literal lock path, never a glob.

**Git is read through its subcommand.** `git rm -f .conductor/state.json` destroys the record
exactly as `rm` does, so a git invocation has its global options skipped first and its subcommand
read: `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace` and `--exec-path` each take a
separate value word (in both the separate and the glued spelling), and every other flag-shaped word
consumes itself alone — so **`git -p rm <record>` is not read as `rm` being `-p`'s value.** The
subcommand's OWN arguments are what the record pattern reads, never git's globals, so `git -C
.conductor status` (a read) passes. The reader also repairs `git -C <path> apply p.patch`, this
repository's own mandated spelling. Its bound, named rather than left to be found: `git -C
/repo/.conductor rm state.json` passes, because `state.json` alone is not the record's path — the
same pre-existing class as `cd .conductor && rm state.json`.

**An invocation of pm's own engine is never a command-word write shape.** A `node`-led segment
whose first argument is a path ending `conductor.mjs` or an unexpanded variable reference
(`node "$ENGINE" <verb>` — the spelling pm's own command docs emit), followed by a verb, is exempt
from the command-word rows. This is what keeps the commands the gate names as its own exit — and
the detour-stack's `drop-detour` — reachable as the list grows. The bound is exact: the exemption
covers the command-word arm ONLY. **A redirection in the same segment still blocks**
(`node … conductor.mjs status > out.txt`), because an exemption that swallowed redirections would
make "prefix the command with an engine invocation" a one-line bypass. And no row is reachable from
a `node`-led segment today anyway — the command-word arm reads the segment's leading word, always
the runtime — so the exemption is a forward commitment, not a behaviour you can observe.

**Segments are split on newline, `;`, `&&`, `||` and `|`** (except the `>|` no-clobber operator),
and the scan runs per segment, so a write shape after a `&&` is caught. The command word is taken
after its last `/`, and a leading `VAR=value`, `sudo`, `env` or `command` is skipped.

**The two fail-open modes, stated plainly.**

- **An unreadable record allows every Bash call CARRYING A COMMAND** — see the next section. This
  is a carve-out, not a gap: one remedy the unreadable-state message prints redirects into the
  record itself and would otherwise match the shape list.
- **An absent record leaves the guard dormant.** With no `.conductor/state.json` the hook exits 0
  silently for every tool. That is the plugin's standing dormancy contract, and it is exactly why
  destroying the record is a shape.

**What it CANNOT see, and must never claim to:** a path built from a variable or `$(…)`; anything
behind `eval`; a script or Makefile target invoked by name; an interpreter given inline source
(`python -c`, `node -e`); a program that writes files of its own accord; an in-place editor reached
through another command's arguments (`find … -exec sed -i …`, `xargs … sed -i`). It has no quoting
model either, so a `>` inside a quoted string or a heredoc body reads as a redirection.

**Accepted false positives.** A redirect to a non-source file (`node --test > red-1.txt`,
`cmd > /tmp/scratch`) is blocked: the guard has no path policy, and the window is short because
running the gate is the correct next action anyway. A **spaced comparison** still blocks —
`awk '$1 > 5' f.txt`, `jq 'select(.n > 3)'`, `rg -n 'a > b' .`, `git commit -m "fix: a > b"` — and
that is accepted under the no-quoting-model non-goal. The **arrow** case is *not* a false positive
and is excluded deliberately, because this repository mandates `rg`: a `>` whose immediately
preceding character is `-` does not match, so `rg 'foo->bar' src/` and `git log --format='%h -> %s'`
pass. What that exclusion does and does not reach is the exact boundary above — it reaches the
unspaced arrow and nothing else.

**Emitting a remedy the guard then refuses.** Widening coverage changes what pm's OWN printed
remedies can do while a reconcile is owed, and two classes are accepted rather than fixed:

- **The `sed -i.bak '<N>d' CLAUDE.md` rules-marker remedy** matches the in-place-editor row and is
  blocked. That is accepted — it is not time-critical, and the way through is the one this gate
  always names: run the reconcile gate. The remedy appears at **four** sites
  (`scripts/lib/rules.mjs`, and `commands/init.md`, `commands/review-mode.md`,
  `commands/upgrade.md`), one more than the design first enumerated.
- **An UNFILLED command template** — `<id>`, `<sha>`, `<iso>`, `<why>`, `<existing>` — carries a
  `>` that the redirection arm matches, so pasting one unfilled blocks while the FILLED command
  passes. This class is pm-wide and PRE-EXISTING (it already breaks at the shell, where `<id>` is
  an input redirection), and any template pm emits falls in it, including
  `add-epic … --link "relates-to:<existing>:<how>"` in `commands/triage.md`.

## The asymmetry: the reconcile arm has no inverse, the tracker arm keeps one

`set-gate-guard off` **cannot** reach the reconcile block, Bash included. Any switch that silenced
Bash writes while a reconcile is owed would be a bypass for the whole gate — an agent that learns
it exists routes around the gate in one command, which is the defect this coverage closes. The
tracker-refresh arm is the opposite and stays that way: its Bash coverage IS silenced by
`set-gate-guard off`, because an agent that cannot reach its tracker must be able to proceed
honestly. Both halves are stated here so the asymmetry is a decision on the record rather than an
inconsistency someone later "fixes".

## An unreadable `state.json` blocks — fails CLOSED

If `.conductor/state.json` exists but cannot be read — a merge left conflict markers in it, it is
truncated, or its shape is wrong (not a JSON object, `epics` present and not an array or holding a
non-object, `detourStack` present and not an array) — the guard **blocks every
`Edit`/`Write`/`NotebookEdit` and every Bash write shape with exit 2** until the file is fixed —
**with one carve-out that keeps the remedies below runnable**: an affirmed `Bash` call carrying
command text is ALLOWED whatever its shape, because one of the remedies the message prints redirects
into the record itself (`git show <rev>:.conductor/state.json > .conductor/state.json`) and another
is a `mv` of it, so a shape check here would block the escape hatch the message hands you. The
carve-out is unconditional for such a call — not "allow unless it is a write shape". A `Bash`
payload with NO readable command does not inherit it and blocks; there is nothing to decide from,
and every remedy named is a command. Before this, the same file
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

**This is not a wedge, and the reason is the carve-out, not the matcher.** Through 0.45.0 what kept
Bash open was that `hooks/hooks.json` registered `gate-guard` for `Edit|Write|NotebookEdit` only;
under the widened matcher that is no longer true, and wedge-freedom rests instead on the exemption
above — an affirmed Bash call carrying a command is allowed even over an unreadable record. Every
remedy the message names is a shell command, so fix the file from Bash:

The printed output's closing line reads "Edit/Write/NotebookEdit stay blocked … Bash is not
blocked: run one of the commands above." The Bash half of that sentence is true of every call the
harness actually produces, because a `Bash` call carries a command; the one spelling that is not
covered is a `Bash` payload with no readable command, which the harness does not produce and which
blocks.

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
