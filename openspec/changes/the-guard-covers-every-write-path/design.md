# Design — the guard covers every write path

## Context

See proposal.md — Why. The relevant current state, verified against 0.45.0:

- `hooks/hooks.json` registers `gate-guard` at `PreToolUse` with the matcher
  `Edit|Write|NotebookEdit`, and `lesson-advice` separately with `Bash|Edit|Write|NotebookEdit`.
- `gateGuardCheck()` (`scripts/lib/gate-guard.mjs`) drains stdin and throws the payload away
  (`readStdin(); // drain, unused`). It blocks on `active.reconcileNeeded` unconditionally, and
  on `active.trackerRefreshNeeded` under the repo's `gateGuard` flag.
- An unreadable `state.json` raises `StateUnreadableError` inside `loadState()`; the top-level
  handler maps it to exit 2 for this verb (`refusalFor`, unit-tested at
  `scripts/test/state-file-refuses-to-guess.test.mjs:273`).
- SIX places assert in prose that Bash is not matched, not blocked, or never reaches the hook —
  enumerated with `rg` at Gate 1, three more than the first draft named: `scripts/lib/state.mjs:201`,
  `scripts/lib/refusal.mjs:18`, `skills/conductor/SKILL.md:206`, `README.md:1593`,
  `hooks/README.md`'s PreToolUse section, and `commands/gate-guard.md` ("This is not a wedge,
  because Bash never reaches this hook").

**The architectural law applies and bounds this change.** pm is an instruction layer; the
gate-guard hook is its single documented local-block exception (`CLAUDE.md`, "The pm engine —
hard constraints"). This change widens what that one exception sees. It introduces no network
call, no external system, and no second mechanical gate. Everything the shape scan cannot decide
stays where pm's law puts it: in the emitted instruction and in the guard's own message.

## Goals / Non-Goals

**Goals**

- The gate guard is invoked for Bash calls, and blocks a recognized write shape while a
  reconcile is owed.
- The unreadable-state block stays wedge-free under the new matcher.
- Today's behaviour for `Edit`/`Write`/`NotebookEdit`, and for an unidentifiable payload, is
  byte-for-byte unchanged.

**Non-Goals**

- Parsing shell. No quoting model, no variable expansion, no `eval`, no alias resolution, no
  following a script by name.
- Deciding whether a written path is source, a scratch file or a report. The guard has no
  path policy and this change does not give it one.
- A path-based exemption for `state.json` itself — considered and declined already in
  `commands/gate-guard.md`; it would widen the one unconditional block with a path match on
  tool input, and every remedy is reachable through Bash anyway.
- Nothing here is scoped out on account of subagents. `PreToolUse` DOES fire for tool calls made
  inside a dispatched subagent — hooks from settings, managed policy and plugins run inside
  subagents, tool events fire the same configured hooks as in the main conversation, and the
  payload carries `agent_id` and `agent_type` (`code.claude.com/docs/en/hooks.md`, read at Gate 1
  rather than recalled). The widened matcher therefore covers a subagent's Bash calls on the same
  terms as the main conversation's, and the guard needs no knowledge of `agent_id` to do it.

## Decisions

### D1 — Widen the existing matcher rather than add a second hook entry

`hooks/hooks.json`'s gate-guard entry becomes `Bash|Edit|Write|NotebookEdit`. The alternative —
a second PreToolUse entry matching only `Bash` and running a distinct verb — was rejected: two
entries would give one obligation two sources of truth and two messages to keep honest, and the
verb already receives the payload it needs.

Consequence for `hooks/README.md`: `scripts/test/hooks-schema.test.mjs` asserts the README
contains the literal `` `PreToolUse` — matcher `<matcher>` `` for every matcher group, so both
PreToolUse sections would now carry the same heading string. Keep them two sections and
distinguish them with a suffix *after* the closing backtick — the assertion is a substring
`includes`, so `` ## `PreToolUse` — matcher `Bash|Edit|Write|NotebookEdit` (gate guard) ``
satisfies it while the per-hook rationale the file exists for stays separable. Also read
`scripts/test/conductor-28.test.mjs:205-230` before editing: it reasons about the two matchers
being different, and its assertion is that the two *entries* differ, which still holds.

### D2 — What the guard can and cannot decide from a Bash command string

This is the honest boundary, and it belongs in the message and the docs, not only here.

**It CAN see** a small set of lexical shapes that mean "this command writes a file":

Each row's label is a FIXED string. What the matcher returns is the label alone — never the
matched path, the matched fragment or any other slice of the command — so the block message
interpolates nothing the engine did not write (see D6).

| Shape | Label |
|---|---|
| `>`, `>>`, `&>`, `&>>`, `>\|` or `>&`, optionally preceded by ONE OR MORE fd digits, whose target is a path | `a redirection into a file` |
| segment-leading `sed` / `gsed` / `perl` / `ruby` with an `-i…` or `--in-place[=…]` argument | `an in-place stream editor` |
| segment-leading `tee` with a non-device argument | `tee` |
| segment-leading `cp`, `mv`, `install`, `rsync`, `dd`, `truncate`, `patch` | that command's name |
| segment-leading `git apply` | `git apply` |
| segment-leading `rm` whose target names the record — `.conductor/state.json`, `.conductor`, `.conductor/`, `.conductor/*`, or a trailing `*` on either name (`.conductor/state.json*`, `.conductor*`) — at any directory prefix, ONE surrounding quote stripped from each end, which is why `'.conductor/state.json'*` (a `*` outside the quote) is undecided rather than matched | `a write to the conductor record` |

Segments are split on newline, `;`, `&&`, `||` and `|`, EXCEPT a `|` immediately following `>` —
`>|` is the no-clobber-override redirection operator, and splitting there hides it from the
redirection arm entirely (caught on the prototype: `cmd >| out.txt` passed until the split was
fixed). A leading `VAR=value` prefix and a leading `sudo`/`env`/`command` are skipped; the command
word is taken after its last `/`. **Both arms run per segment** — the redirection scan included,
which is what lets the engine exemption below be scoped to one segment.

**An engine invocation is never itself a shape.** A segment whose command word is a runtime
(`node`) whose first argument — one surrounding quote stripped from each end — is a path ending
`conductor.mjs` OR an unexpanded variable reference, followed by a verb, is exempt from the
COMMAND-WORD arm above: no engine verb is a write shape, whatever it is named and whatever its
arguments say. The variable form is in the predicate because `node "$ENGINE" <verb>` is the
spelling pm's own command documents emit and the guard cannot expand it; the first draft's
predicate returned FALSE for both spellings pm actually emits (the trailing quote and the
variable), which is the narrower half of what the release's cross-spec pass found. Widening it
costs nothing today, since a `node`-led segment matches no command-word row either way.

**Cross-spec r1 BLOCK 1 — which fix was taken, and what it does and does not buy.** The reviewer
offered (a) make the exemption operative, or (b) demote it to a forward commitment. **(a) is
taken, and it CARRIES (b) rather than replacing it**, because (a) alone would overstate what it
achieves. What (a) buys is DELETE-DETECTABILITY: the predicate is exported and asserted directly
over both emitted spellings, so removing it fails a test. What it does not buy is behavioural
reachability — the command-word arm reads the segment's LEADING word, always the runtime and never
the verb, so no row is reachable from an engine segment and the case battery is byte-identical
with the exemption's CALL SITE removed (verified: the call-site-only mutant's rows diff clean, measured on that round's 78-row battery
against the base; the predicate-deleted mutant fails at import). That structural fact and the
forward binding — any future row keyed on something other than the segment's leading command word
must re-establish reachability before it ships — are therefore stated normatively in the
`gate-integrity` delta alongside the predicate requirement. Stating the limit is what stops this
being reopened as a finding. The gate names engine invocations as the way through it, so a gate that blocked one
would have no exit, and the exemption is what keeps that true as the list GROWS — today no engine
verb matches any row, which is a coincidence of the current list rather than a property of it.
This is also what keeps the sibling change's `drop-detour` reachable (see Coordination).

The exemption covers the command-word arm ONLY and deliberately not the redirection arm. A
redirection is a write wherever it appears, so `node … conductor.mjs status > out.txt` still
matches — an exemption that swallowed redirections would make "prefix the command with an engine
invocation" a one-line bypass of the whole gate. Quoted argument text is handled by the arrow
exclusion instead, which is why `record-reconcile … --amendment "story 3 -> story 4"` and
`update-epic … --notes "lane: claude-code not openspec -> small"` pass without needing any
exemption at all.

**It explicitly does NOT treat as a write:** a redirection whose target starts with `/dev/`; a
file-descriptor duplication — which is `&` followed by DIGITS or `-` (`>&2`, `2>&1`, `>&-`) and
deliberately not `&` followed by a path, since `node --test >& out.txt` writes a file and passed
on the prototype until the two were told apart; and a `>` whose immediately preceding character is
`-`. These are the idioms of ordinary read-only commands; blocking them is how a guard earns being
routed around. The arrow case is in the SPEC's exclusion list rather than accepted as a false
positive because this repository mandates `rg`, and `rg 'foo->bar' src/` and
`git log --format='%h -> %s'` both blocked on the prototype before it was added.

Verified against the prototype (scratchpad `propose-46/shape.mjs`, driven by
`gate1-46/grd-a/battery.mjs`, 86 cases plus 8 assertions over the exported engine predicate, all
as intended): `rg foo 2>/dev/null`, `cmd >&2`,
`cmd > /dev/null 2>&1`, `node --test 2>&1 | tail`, `diff <(a) <(b)`, `for f in *; do echo $f;
done`, `curl -s url | jq .`, `rg 'foo->bar' src/`, `echo "<!-- pm:lifecycle -->"`,
`rm .conductor/state.json.lock`, its quoted spelling, the lock-only glob `rm .conductor/state.json.*`,
`rm -rf .conductorish`, the multi-digit fd
DUPLICATION `cmd 10>&1` and every engine invocation the gate names as its exit — including
`node "$ENGINE" drop-detour p --reason "stale frame"` — all pass;
`cat > src/x.js <<EOF`, `sed -i '' s/a/b/ f.js`, `tee -a notes.txt`, `cp a b`, `printf x >> f`,
`awk '{print}' f > out.txt`, `git apply p.patch`, `cmd &> out.txt`, `cmd &>> out.txt`,
`cmd >| out.txt`, `rm .conductor/state.json`, `rm -rf .conductor`, the multi-digit fd
redirections `cmd 10>out.txt`, `exec 10>lockfile` and `cmd 12>>out.txt` (which passed until the
cross-spec fix — the fd was a single optional digit sitting behind a negated class that also
excluded digits), `rm -rf .conductor/*`, the trailing globs `rm -rf .conductor/state.json*` and
`rm -rf .conductor*`, `rm '.conductor/state.json'`, an absolute path to the
same record, `sed --in-place s/a/b/ f.js` and
`node … conductor.mjs status > out.txt` all block.

**It CANNOT see, and must never claim to:** a path built from a variable or `$(…)`; anything
behind `eval`; a script or Makefile target invoked by name; an interpreter given inline source
(`python -c`, `node -e`); an editor or program that writes files of its own accord; a write
performed by a tool the matcher does not cover at all. It also has no quoting model, so a `>`
inside a quoted string or a heredoc body reads as a redirection — a false positive, accepted
below.

**The record row's discriminator is the WRITTEN ARGUMENT, not the file it reaches** (cross-spec r1
confirmation POLISH 3). `rm -rf .conductor/state.json*` passed the first fix — which matched the
quoted, absolute and `/*` spellings but keyed on the literal path — and it turns the guard off as
thoroughly as `rm .conductor/state.json`. So a trailing `*` on either name matches, because the
argument as written names the record among its expansions. **`.conductor/state.json*` also reaches
`.conductor/state.json.lock`, and blocking it anyway is the deliberate call:** the lock remedy pm
emits is the LITERAL path (`state.mjs`'s `lockRefusalMessage()`), never a glob, so nothing pm
prints is blocked, and `.conductor/state.json.*` — which cannot expand to the record — stays the
runnable glob spelling for lock cleanup. The reviewer's finding named `state.json*` only;
`.conductor*` is the identical evasion one level up, and an unedited sibling site is a FINDING in
this repository rather than a detail, so both ship. A trailing `*` and ONLY `*`: `?` and `[…]`
are left to the incomplete-by-construction requirement rather than turned into a glob engine, and
`'.conductor/state.json'*` — a `*` outside the surrounding quote — is the no-quoting-model
non-goal, named in the spec so a later gate does not rediscover it as new.

Only `rm` needs the record row: `mv` and `truncate` are already unconditional command words above,
so the record is covered against them whatever their target. `rm` is on the list for the record
and for nothing else — the guard gets no general path policy out of this (Non-Goals).

`touch` and `mkdir` are deliberately absent: they create a file or directory without content,
which is not the skip this gate exists to stop, and including them would add noise for nothing.
Git verbs other than `apply` are absent for the same reason — `git checkout -b` is routine and
`git restore` is a remedy the unreadable-state branch must never block.

The list is CLOSED and lives in one exported function, so the spec's "closed, documented list"
has a single site to test and a single site to grow.

### D3 — Only an affirmatively-identified Bash call takes the shape path

The guard reads `tool_name` from the payload it already drains. `Bash` takes the shape path;
anything else — `Edit`, an unknown name, an unparseable payload, an absent payload — takes
today's blocking path unchanged. Rejected alternative: default unknown to the Bash path. That
would convert a malformed payload into a silent hole in the one unconditional block, and it
would change the behaviour every existing test exercises (the suite invokes the hook with `"{}"`
and with `{"tool_name":"Edit"}`).

### D4 — The unreadable-state exemption is a local branch, decided before the load and applied at it

The exemption is DECIDED from the drained payload before `loadState()` runs, and APPLIED when the
load raises `StateUnreadableError`. It is not an early `return 0` for Bash: a Bash call over a
READABLE record still goes on to the reconcile and tracker branches, and only an unreadable record
turns the decision into an allow. Concretely: parse the drained payload; if `tool_name === "Bash"`
and its `tool_input.command` is a string, wrap the load so `StateUnreadableError` allows rather
than refuses. A `Bash` payload with no readable command does NOT get the exemption — there is
nothing to decide from, every remedy the message names is a command, and the `gate-integrity`
capability blocks an undecidable Bash call for the same reason.

**Order matters and is fixed: drain stdin → `requirePlatformFlag("gate-guard")` → decide the
affirmed-Bash exemption → `loadState()` (applying it).** The decision goes AFTER the flag check,
never before.
`commands/gate-guard.md` documents that a refused hook line fails OPEN with exit 1 after draining
stdin; an exemption that returned 0 ahead of `requirePlatformFlag` would silently delete that
behaviour for every Bash call, which is a documented surface disappearing with no test failing.

`refusalFor()` is NOT touched. `state-file-refuses-to-guess.test.mjs:273-282` unit-tests that
`refusalFor("gate-guard", StateUnreadableError)` maps to exit code 2, and `state-write-guard`
requires that a refusal raised outside the hook's own load still takes the hook's status.
Changing the mapping would break both; a local branch keeps them true.

The exemption is UNCONDITIONAL for Bash — not "allow unless it is a write shape" — because one
of the remedies the message itself prints is
`git show <rev>:.conductor/state.json > .conductor/state.json`, a redirection into a file. A
shape check there would block the escape hatch the message hands you.

### D5 — No inverse for the reconcile arm, and the asymmetry is the point

`set-gate-guard off` already cannot reach the reconcile block; the Bash arm inherits that and
ships no switch of its own. Any flag that silenced Bash writes while a reconcile is owed would
be a bypass for the entire gate — an agent that learns it exists routes around the gate in one
command, which is exactly the defect being closed. A false positive is answered by running the
reconcile gate, the same answer `Edit` already gets, and the window is short by construction.

The tracker-refresh arm is the opposite and stays that way: its Bash coverage is silenced by
`set-gate-guard off`, because an agent that cannot reach its tracker must be able to proceed
honestly. Both halves are stated in the docs so the asymmetry is a decision on the record and
not an inconsistency someone later "fixes".

### D6 — The message names the shape, and stops claiming what it cannot deliver

Today's reconcile message ends "Completing the reconcile gate is the only way through", which
was false for Bash. It is not made true by this change either — every undecidable form in D2 still
passes, and an unreadable record allows every Bash call — so the sentence is DROPPED rather than
kept with a new justification. What replaces it: the matched shape's fixed LABEL, so the block is
legible as a decision about *this* command, and one sentence saying a Bash write is forbidden
while the reconcile is owed whether or not this check detects it. That sentence is the instruction
layer doing the work the mechanism cannot — it is why the block does not need to be exhaustive to
be honest.

The label is a fixed string from D2's table and the message interpolates NO text from the command:
not the target path, not the matched fragment. That is subtractive rather than defensive —
0.45.0's output-text-integrity requirement exists because engine output that carries user text has
to be escaped and bounded, and text the engine wrote itself has neither obligation.

### D7 — An emitted remedy that is itself a write shape

Widening the guard changes what pm's own emitted remedies can do while a reconcile is owed. Found
mechanically, not from memory:

- **The `sed -i.bak '<N>d'` rules-marker remedy, at THREE sites.** `scripts/lib/rules.mjs`'s
  `rulesBlockAmbiguousMessage()` emits it, and it is reproduced in `commands/review-mode.md:49`
  and `commands/upgrade.md:184`. It IS a recognized shape and will be blocked while a reconcile is
  owed. **Accepted.** It is not time-critical, it is not the guard's own escape hatch, and the way
  through is the one this gate always names: run the reconcile gate. The comment above that
  function ("while a reconcile is owed the gate guard blocks Edit and Write") becomes incomplete
  and is corrected in the sweep, and the interaction is now stated normatively in the
  `managed-rules-block` delta, because that requirement's own text justified the remedy by saying
  Bash was unblocked.
- `scripts/lib/state.mjs` — `lockRefusalMessage()` emits `rm <path>` / `rm -r <path>` for
  `.conductor/state.json.lock`. `rm` IS now on the shape list, but only against the record's own
  path (or the `.conductor` directory, or a glob of it, or a trailing `*` on either name) at any
  directory prefix — never a LONGER LITERAL FILENAME beneath it — so this remedy stays runnable.
  The remedy is printed as the literal lock path, which is what makes blocking the trailing glob
  `state.json*` free even though that glob would also reach the lock (D2). That constraint is in
  the spec, not just
  here, because the lock path begins with the record path and a match that reached it would block
  the remedy pm prints.
- **`/pm:feedback` step 2 (`commands/feedback.md:44-46`)** — "Write the report to a local file
  FIRST … every time, on every path" is a `mkdir -p` plus a write of a markdown file, and the
  write is a redirection or a heredoc however it is performed. Under a reconcile block it becomes
  unrunnable by Bash AND by Edit/Write, so pm's own friction channel dies at the moment friction
  is felt. **Accepted, and named rather than silently true:** the local-file step's purpose is to
  survive a failed network call and a lost session, and a reconcile-owed window is short and has
  an obvious remedy. The docs task states it, so a user who hits it reads why instead of
  concluding the feedback command is broken. Making feedback the one path-based exemption was
  rejected for the reason every path exemption here is rejected — it is a second policy surface,
  and a path exemption is a bypass the moment a filename is chosen to match it.
- **An UNFILLED command template is blocked, and the class is pm-wide and PRE-EXISTING.** A
  placeholder spelled `<id>`, `<sha>`, `<iso>`, `<why>` carries a `>` that the redirection arm
  matches, so pasting a template unfilled blocks while the FILLED command passes. Found on the
  prototype: `update-epic <id> --attribute-commit <sha>`, `record-tracker-refresh <id> --verdict
  unchanged --external-updated-at <iso>`, `drop-detour <pausedEpicId> --reason "<why>"`. This is
  not the sibling change's to own: pm EMITS these spellings today —
  `briefing.mjs:30`, `:45`, `:60`, `autonomy.mjs:44-46`, `gate-review-writeback.mjs:51-52`,
  `argv-surface.mjs:213` — so it is a consequence of THIS change's scope wherever a template
  appears, including any the sibling adds. **Accepted, and the reason is that the block removes
  nothing that would otherwise run:** an unfilled template is already broken at the shell, where
  `<id>` is an input redirection, so a user who pastes one gets a refusal either way. Filling it
  in — the only spelling that ever worked — passes. Named here rather than left implicit, and
  carried into 4.1b's known-case list so the sweep re-derives it.
- `scripts/lib/refusal.mjs` — the gate-guard suffix on the unreadable-state refusal says "Bash is
  not blocked: run one of the commands above". That stays TRUE under D4 and needs no edit; the
  reason it is true changes, which is why the sweep reads it rather than assuming.

**`rm` of the conductor record is on the list, and that is a reversal from the first draft**,
which kept every deletion off it on the grounds that the list is about writing content. It is not
a matter of taste: deleting `.conductor/state.json` does not evade this block, it turns the guard
OFF. `gateGuardCheck()` returns at `isInitialized()` when the file is absent, so after an `rm` the
hook is dormant for every tool — a strictly larger bypass than the write it was standing in for,
and `mv` and `truncate` were already on the list while destroying the record no less thoroughly.
What the list does NOT do is give the guard a path policy for anything else: `rm` of any other
path stays unmatched, and the record's own match is the record's path itself or a trailing `*` on
it, never a longer LITERAL filename beneath it.

**Two fail-open modes remain and the message must not imply otherwise.** A record that cannot be
read allows every Bash call CARRYING A COMMAND (D4, and `state-write-guard`'s requirement — a Bash
payload with no readable command does not get that exemption either); a record that is absent
leaves the guard dormant, which is the plugin's standing dormancy contract rather than a defect.
Neither is named anywhere in 0.45.0's text. The first is now stated in the `gate-integrity`
requirement and in `commands/gate-guard.md`; the second is why `rm` of the record is a shape.

**Cross-spec r1 — two suggestions considered and DECLINED, recorded here rather than left in a
review.** (1) *Add an `emitted-instructions` delta binding pm not to emit a remedy its own guard
refuses.* Declined: that capability governs whether the INSTALLED ENGINE accepts an invocation
("Every engine invocation pm ships is one the installed engine accepts") and whether a remedy
clears the condition that printed it. The `sed -i.bak` marker fix is not an engine invocation at
all, the engine refuses nothing, and the remedy still clears its condition when run — it is
temporarily unrunnable under a SEPARATE obligation that names its own exit. Reading that as an
engine refusal would move a policy block into a capability about command-line acceptance, and the
case is already named as accepted in this D7 and enumerated mechanically by task 4.1b. (2) *Add a
staleness note that three deltas assert facts about a list a fourth defines.* Declined as a change
to the artifacts: the observation is true and useful, but `record-cross-spec-review` enumerates and
hashes the spec set FROM DISK, so growing or narrowing the list marks the release verdict stale on
every surface without anyone remembering a note. A prose warning would duplicate a mechanism that
already fires.

The general rule the sweep enforces: any command pm EMITS as a remedy must still be runnable, or
the interaction must be named as accepted here. That is the `emitted-instructions` concern a
diff-scoped gate cannot see, because none of these files need to change.

## Risks / Trade-offs

- **False positive: a redirect to a non-source file is blocked** (`node --test > red-1.txt`,
  `cmd > /tmp/scratch`) → Accepted. The guard has no path policy (Non-Goals) and adding one
  would be a second policy surface to keep honest. The window is only while a reconcile is
  owed, during which running the gate is the correct next action anyway. Named in the docs so
  it is a known behaviour rather than a surprise.
- **False positive: a `>` inside a quoted string or heredoc body** → Partly removed, partly
  accepted. The arrow exclusion (a `>` immediately preceded by `-`) is in the SPEC's exclusion
  list, not merely accepted here, because this repository mandates `rg` and the arrow is routine
  in its patterns: `rg 'foo->bar' src/` and `git log --format='%h -> %s'` blocked on the prototype
  and now pass. It does NOT reach a spaced comparison — `awk '$1 > 5' f.txt`,
  `jq 'select(.n > 3)'`, `rg -n 'a > b' .` and `git commit -m "fix: a > b"` still block, and that
  is accepted under the no-quoting-model non-goal. The common true case (`cat > f <<EOF`) is a
  genuine write matched on the same line regardless.
- **False negative: every undecidable form in D2 passes** → Mitigated, not closed, by the
  instruction layer: the block message states the obligation covers Bash writes, and a task adds
  the same obligation to the emitted rules block so it reaches an agent before it reaches for a
  heredoc. The two mitigations have different reach and the difference is stated in the Migration
  Plan: the message ships with the plugin, the rules block is repo state and stays stale until
  `/pm:upgrade`.
- **Wedge risk under the new matcher** → Closed by D4, and pinned by a scenario that runs each
  remedy command through the hook over a conflicted `state.json`.
- **Blast radius: every Bash call in every pm repo now runs one more hook** → The added work is
  a payload parse and a bounded string scan on a command line; the hook already ran for every
  Bash call via `lesson-advice`, so the process-spawn cost is not new.

## Migration Plan

No state-schema change, so no `MIGRATIONS` entry. Behaviour lands with the plugin version: a
repo picks it up with plugin update plus `/reload-plugins`; `/pm:upgrade` is not required for
the hook itself, since `hooks/hooks.json` ships with the plugin rather than with repo state.

**The rules-block half is the exception and lands on the other schedule.** The managed rules block
is REPO state written into `CLAUDE.md`, so the sentence this change adds to it reaches a repo only
when `/pm:upgrade` runs there. Until then the mechanism is live and its instruction-layer twin is
stale — the message the guard prints still carries the obligation, which is why the Risks
mitigation rests on the message first and the block second, and not the other way round.
Rollback is reverting the matcher in `hooks/hooks.json` — the engine change is inert without it,
because an unmatched tool never reaches the verb.

## Coordination

The sibling 0.46.0 change `operations-ship-their-inverses` also edits
`openspec/specs/gate-integrity/spec.md` (the detour-stack / reconcile-obligation area, roughly
requirements at lines 1604–1930 of the current main spec, plus `epic-disposition`). This change
ADDS exactly one requirement there — "The reconcile block covers a Bash write, and declares what
it cannot see" — and MODIFIES nothing in that file, so the two deltas should not collide. It
also MODIFIES `state-write-guard`'s "Hooks never write over an unreadable state file and report
it where it can be acted on" and `tracker-sync`'s "Mechanical enforcement of the refresh gate is
opt-out"; if the sibling needs either, that is the release-level cross-spec pass's call.

This change also adds a fourth delta, `managed-rules-block` — one clause of one requirement, which
justified its shell remedy with "because while a reconcile is owed Edit and Write are blocked".
That sentence stops being true here, so the delta lands with this change rather than at sweep
time, which would be after the release's cross-spec verdict has hashed the spec set.

**What this change COMMITS TO for the sibling's `drop-detour`.** The sibling's frame-drop verb is
the escape from a detour-stack jam, and an escape reachable only when the jam is absent is no
escape. This change therefore binds itself: an invocation of pm's own engine is never a
command-word write shape, stated normatively in the `gate-integrity` delta with a scenario over
the engine invocations the gate names as its own exit. `drop-detour` matches no shape today, but
that is a property of the current list, and the list is expected to grow — the commitment is what
makes it durable. Two bounds the sibling should rely on rather than a wider promise: the exemption
does NOT cover a redirection in the same segment (`node … conductor.mjs drop-detour p > out.txt`
still blocks, and that is deliberate — otherwise the exemption is a bypass), and it does not touch
the unreadable-record path, which allows Bash outright. The sibling's lens A found the jam hazard
is NARROWER than first claimed — `gateGuardCheck()` keys on the ACTIVE non-archived epic, which in
the canonical jam is the detour and owes nothing — so the exemption is kept to exactly this and no
more.

**Both 0.46.0 changes rewrite the emitted managed rules block in `scripts/lib/rules.mjs` and its
goldens under `scripts/test/fixtures/` (this change's task 3.6; the sibling's task 1.11), and THIS
CHANGE LANDS FIRST** — it owns the matcher, the closed shape list and the `managed-rules-block`
delta, so the sibling regenerates those fixtures against a block this change has already rewritten
rather than against 0.45.0's. Whoever lands second regenerates from the tip, never from a
remembered baseline.

One item genuinely belongs to the sibling's area and is NOT done here: whether an archived
paused epic can leave the guard reading a stale obligation is `archived-paused-epic-jams-detour-stack`'s
question, not this one.

## Open Questions

None that would change the specs, the approach or the task breakdown.
