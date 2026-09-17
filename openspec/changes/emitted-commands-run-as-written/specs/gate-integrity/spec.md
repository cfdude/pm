## MODIFIED Requirements

### Requirement: An update to an archived epic does not break an obligation its archive met

This requirement binds an `update-epic` invocation when ALL of these hold (the outcome and the status
are read from the epic as stored BEFORE the invocation):

- the epic's recorded outcome is `delivered`;
- the invocation does not carry `--status archived`;
- the record will be archived when the invocation returns: EITHER the epic's change directory is
  archived on disk (the predicate on which the archive-drift heal, run by the invocation's own
  render, archives it, whatever its stored status), OR its stored status is `archived` and the
  invocation carries no `--status`.

For such an invocation, `update-epic` MUST compare the delivered-outcome obligations on the record
before the invocation with those on the record it would leave. The obligations are:

- **the Gate 2 demand** — openspec lane, a present passing Gate 2 that is neither stale nor
  attribution-withdrawn;
- **the handoff demand** — no outstanding work, unless the disposition names where it was carried.

The comparison is PER OBLIGATION. The invocation MUST be refused, writing nothing and announcing no
write, where some obligation the record met before is failed by the record after, whatever the
other obligation's state. A whole-record comparison would let an already-failing handoff mask a
Gate 2 the invocation breaks.

The archive gate and this check MUST decide the obligations from ONE definition, so they cannot
disagree about what "met" means. Sharing the definition does not make this check the archive
transition's handoff guard: `epic-disposition`'s rule that the handoff refusal names `--carried-to`
and the lifecycle marker binds the interactive archive verb's refusal only, and this refusal is not
one.

An obligation the record already failed before the invocation MUST NOT be a ground for refusal.
Archived records from before a rule existed fail rules they were never held to, and refusing every
update to them would lock notes, links and priority on a record for a defect the update did not cause.

**The refusal's wording.** It MUST state that the update would break an obligation the archived
record met, and name that obligation. It MUST NOT contain the text `cannot archive`, which opens every
archive-gate refusal. The printed invocation below MUST be the only line of the refusal that begins
with `  update-epic `, and no ENGINE-WRITTEN text on any other line may name `--carried-to`,
`--outcome` or `--reason`, flags that take effect only alongside `--status archived`. A value a user
supplied (a story title, a reason, a note) MUST NOT start a line of the refusal. Where the invocation carried a non-archived `--status`,
the refusal MUST say that status is dropped from the printed invocation because the change directory
archived on disk re-archives the epic.

**The printed invocation.** The refusal MUST print a runnable invocation that makes the same change
and records the disposition it implies. It is the invocation's own argument tokens, as given, minus
`--status`, `--outcome`, `--reason`, `--carried-to`, `--correct-disposition` and the deferral flags
(with their values), plus `--status archived`, an `--outcome` placeholder naming the agent outcomes,
`--reason "<why>"`, and exactly the flags the bullets below add under their conditions — nothing else.
Which token is a
dropped flag's value follows the engine's own flag walk: an inline `--flag=value` token drops alone,
and a following token drops with its flag only where that token is not itself flag-shaped. A flag
given with no value echoes with no value, a repeated flag echoes once per occurrence, and an inline
`--flag=value` token echoes as one token. Every echoed token MUST be quoted so that the printed line, with only its placeholders
filled, runs in a POSIX shell with each token arriving whole, including a value containing an
apostrophe. The printed invocation MUST stay on ONE physical line. A token containing a newline or other
control character is NOT echoed as a value: its position carries the flag and a placeholder, and the
refusal says which flag's value must be re-entered. A shell cannot reliably rebuild such a value on one line (command substitution strips a
trailing newline), and a promise of byte-for-byte reconstruction there would be false.
- It MUST carry `--correct-disposition "<why the recorded one was wrong>"` if and only if the recorded
  disposition is agent-recorded. An engine-stamped disposition is replaced by recording an outcome,
  and the correction flag is refused against it.
- It MUST carry the placeholder `<--no-deferrals | --deferral "<epicId>:<section>">` if and only if
  the epic has no deferral assertion. A deferral assertion is a claim to be made, not a default to
  print.
- It MUST carry `--carried-to <epicId>` if and only if the record the invocation leaves has a checkbox
  task source (a `tasks.md` or plan file) whose open tasks break the handoff demand — so the
  `delivered` it offers would otherwise be refused, and no verb ticks a checkbox. The handoff's
  `--reason` is the one the invocation already carries, printed once, never a second time. Whether a
  flag is already carried is decided by the invocation's own template, never by an echoed token: a
  user value naming `--carried-to` or `--reason` is data. The handoff goes only with `delivered`, and
  the refusal MUST say so in prose naming `delivered` and no archive-only flag; for any other outcome
  the flag is removed (before Gate 2 R-I1 the flag was absent and the filled invocation was refused
  "task(s) outstanding").

An update to an archived epic never passes through `--status archived`, so the archive gate never
sees it. Reproduced on 0.42.0:
- `update-epic <id> --lane openspec` on an archived `delivered` `claude-code` epic exits 0 and leaves a
  `delivered` openspec-lane epic with no Gate 2, which `integrity` names nowhere.
- `update-epic <id> --status queued --attribute-commit <descendant>` on an archived `delivered`
  openspec epic whose change directory is archived on disk exits 0. The heal re-archives it in the same
  call with a stale Gate 2.

#### Scenario: Switching an archived delivered epic into the openspec lane is refused

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 ever recorded runs
  `update-epic <id> --lane openspec --notes "moved to the openspec lane"`
- **THEN** it exits non-zero naming the missing passing Gate 2, its message does not contain
  `cannot archive`, and `state.json` is byte-identical

#### Scenario: Attributing a commit an archived delivered epic's Gate 2 does not cover is refused

- **WHEN** an archived `delivered` openspec-lane epic carries a passing Gate 2 whose `headSha` is its
  last attributed commit, and `update-epic <id> --attribute-commit <a commit descending from that
  headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: A non-archived status does not escape the check while the heal will re-archive

- **WHEN** the epic of the previous scenario has its change directory under
  `openspec/changes/archive/`, and `update-epic <id> --status queued --attribute-commit <a commit
  descending from that headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, the refusal says `--status` is dropped from
  the printed invocation because the change directory archived on disk re-archives the epic, and
  `state.json` is byte-identical

#### Scenario: Adding a story to an archived delivered epic is refused without naming a dead remedy

- **WHEN** an archived `delivered` `claude-code`-lane epic whose stories are all done runs
  `update-epic <id> --add-story "s"`
- **THEN** it exits non-zero naming the outstanding story, no line of the refusal other than the one
  beginning `  update-epic ` names `--carried-to`, `--outcome` or `--reason`, and `state.json` is
  byte-identical

#### Scenario: Withdrawing the only attribution of an archived delivered epic is refused

- **WHEN** an archived `delivered` openspec-lane epic attributes exactly one commit, covered by its
  passing Gate 2, and `update-epic <id> --withdraw-commit <that sha> --withdrawal-reason "x"` runs
- **THEN** it exits non-zero naming the Gate 2 demand, and `state.json` is byte-identical

#### Scenario: A queued epic the heal will archive does not escape the check

- **WHEN** an openspec-lane epic archived `delivered` over a passing Gate 2 covering its one attributed
  commit is set `--status queued` while nothing is archived on disk, its change directory is then
  moved under `openspec/changes/archive/`, and `update-epic <id> --attribute-commit <a commit
  descending from that headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: Restoring a record the check accepted is judged like any other change

- **WHEN** an archived openspec-lane epic with an agent-recorded `delivered` disposition and a Gate 2
  `fail` recorded after archive runs
  `update-epic <id> --lane claude-code`, which is accepted, and then `update-epic <id> --lane openspec`
- **THEN** the second call is refused naming the Gate 2 demand, and the invocation it prints, filled
  with `--outcome superseded`, a reason and a correction reason, exits 0

#### Scenario: An already-failing handoff does not mask a Gate 2 the update breaks

- **WHEN** an openspec-lane epic with one outstanding story was archived `delivered --carried-to z`
  over a passing Gate 2 covering its one attributed commit, and `remove-epic z` then stripped its
  `carriedTo` so its handoff demand fails, and `update-epic <id> --withdraw-commit <that sha>
  --withdrawal-reason "x"` runs
- **THEN** it exits non-zero naming the Gate 2 demand, and `state.json` is byte-identical

#### Scenario: A user-supplied value cannot forge a line of the refusal

- **WHEN** an archived agent-recorded `delivered` `claude-code`-lane epic whose stories are all done
  runs `update-epic <id> --add-story` with a title that does not begin with `--` and contains
  `--carried-to`, a newline, and `  update-epic x`
- **THEN** it is refused; exactly one line of the refusal begins `  update-epic `; no line of the refusal
  begins with any part of the title after its newline; and the printed invocation carries a placeholder
  for that `--add-story` value instead of echoing it

#### Scenario: A refused update announces no cleared field

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2, ranked in P2, runs
  `update-epic <id> --priority P1 --lane openspec`
- **THEN** it exits non-zero, stderr carries no rank-clear line, and `state.json` is byte-identical

#### Scenario: A record that already failed is not locked

- **WHEN** an archived `delivered` openspec-lane epic had a Gate 2 `fail` recorded by
  `record-gate-review` after it was archived, and `update-epic <id> --attribute-commit <sha>` runs
- **THEN** it exits zero and the commit is attributed, because the record failed the Gate 2 demand
  before the call

#### Scenario: An epic that ended another way carries no obligation

- **WHEN** an archived `claude-code`-lane epic with outcome `superseded` runs `update-epic <id> --lane
  openspec --add-story "s"`
- **THEN** it exits zero

#### Scenario: An unknown outcome carries no obligation

- **WHEN** an archived `claude-code`-lane epic whose outcome is `unknown` with an engine `recordedBy`
  runs `update-epic <id> --lane openspec`
- **THEN** it exits zero

#### Scenario: The invocation printed for an agent-recorded disposition names the correction

- **WHEN** the lane-switch refusal above fires on an epic whose `delivered` disposition was recorded by
  `update-epic … --status archived --outcome delivered --no-deferrals`
- **THEN** the invocation it prints carries `--correct-disposition` and no deferral placeholder, because
  the epic already carries a deferral assertion

#### Scenario: The invocation printed for an engine-stamped disposition does not name the correction

- **WHEN** an archived epic whose `delivered` disposition was stamped by the 0.27.0 migration (a
  pre-0.27.0 state file carrying a passing Gate 2, run through `upgrade`), and whose stories are all
  done, runs `update-epic <id> --add-story "s"`
- **THEN** it is refused, and the invocation it prints carries no `--correct-disposition` and carries
  the deferral placeholder, because a migration stamp records no deferral assertion

#### Scenario: The printed invocation runs

- **WHEN** an archived agent-recorded `delivered` `claude-code`-lane epic with no Gate 2 ever recorded
  runs `update-epic <id> --lane openspec --notes "Rob's move" --clear-links --reason=--x --add-story
  "two words" --add-story=--x`, which is refused, and the invocation it prints is run through `sh -c` with its
  placeholders filled as `--outcome superseded`, a reason, and a correction reason
- **THEN** it exits zero; the epic is an archived `superseded` openspec-lane epic whose prior
  `delivered` disposition is kept under `superseded`; its latest note is `Rob's move`; it has no links;
  and it gained exactly the two stories `two words` and `--x`

#### Scenario: A checkbox source's open tasks travel on the printed invocation

- **WHEN** an archived agent-recorded `delivered` `superpowers`-lane epic whose plan was fully ticked runs
  `update-epic <id> --plan <a plan with a task still open>`, once with no other flag and once with
  `--title "moved --carried-to later"`
- **THEN** each is refused; each printed invocation carries `--carried-to <epicId>` and exactly one
  `--reason` outside the echoed title; the refusal says the handoff goes only with `delivered`; and
  each invocation, filled with `delivered`, a reason, a correction reason and a receiving epic, exits
  zero with the plan re-pointed (before Gate 2 F-I1 the title suppressed the flag and the filled
  invocation was refused "task(s) outstanding")

#### Scenario: Leaving the archive is not refused where nothing re-archives the epic

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 ever recorded and no change directory
  archived on disk runs `update-epic <id> --status queued --lane openspec`
- **THEN** it exits zero and the epic is `queued`, and a later `update-epic <id> --status archived
  --outcome delivered --reason r --correct-disposition c --no-deferrals` is refused for the missing
  passing Gate 2
