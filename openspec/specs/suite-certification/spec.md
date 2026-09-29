# suite-certification Specification

## Purpose
How this repository's test suite is divided into a half that must run on every commit and a half that
runs only when the thing it certifies has changed, how the two halves are held together so neither
drifts from the other, and how a claim that the slower half passed is recorded and checked
mechanically rather than remembered.

## Requirements

### Requirement: The suite has two halves with different triggers and different costs

The suite SHALL be divided into an **assertion** half and a **functional** half. The assertion half
SHALL be the half that runs on every commit. The functional half SHALL run only when the change under
test has touched something that only the functional half is able to verify.

The halves SHALL be distinguishable on disk. The trigger that selects the functional half SHALL be
derived from the repository's own contents rather than from a list maintained by hand, so a module
added later cannot silently fall outside it.

**The trigger SHALL be derived from what the functional half OBSERVES, not from how a module reaches
git.** The functional half's **subject** SHALL be the union of six sets:

- every tracked file reachable by import from a functional test file, from the engine entry point,
  or from an assertion-half test file the functional half executes (below): a static `from`, an
  `export … from`, a bare side-effect `import "…"`, and a literal dynamic `import("…")`, relative
  specifiers only;
- the functional test files themselves;
- every assertion-half test file the functional half EXECUTES, that is, one whose path
  (`assert/<name>.test.mjs` or `unit/<name>.test.mjs`, optionally prefixed `scripts/test/`) a
  closure file under `scripts/test/` spells, in its CODE, as a single- or double-quoted string.
  Comments are removed before the match, so a twin named in a comment is not matched however it is
  quoted. A functional test that runs such a file as a nested test run makes its result depend on
  that file, so a change to it can change the functional result;
- every tracked file under `scripts/`, `.githooks/` or `hooks/` whose file name a closure file under
  `scripts/test/` spells as a string literal, or as the last `/`-separated segment of one. This covers what the half runs or reads without importing it,
  such as the pre-commit hook and the hook configuration. A file the half reads through a path
  assembled at run time is in the subject only when its name is ALSO spelled as a literal, so such
  a read SHALL be written with the name spelled out.
- every tracked file under a shipped-surface root (`commands/`, `skills/`, `agents/`, `hooks/`,
  `.claude-plugin/`) that a closure file under `scripts/test/` spells as a path segment. The root is
  taken whole, because the half walks those roots as well as reading named files from them.
- `README.md`, `CLAUDE.md` and `docs/parity-ledger.json`, when a closure file under `scripts/test/`
  spells their names.

The repository's own RECORD SHALL NOT be in the subject: `openspec/`, `.conductor/`, `CHANGELOG.md`
and `docs/` other than the parity ledger. The functional half does read some of it: it walks
`openspec/changes/archive/`, it reads the repository's live `.conductor/state.json` (to run the
integrity checks over the real record), and it reads `CHANGELOG.md` both as a shipped markdown file
and through the engine, which reads the plugin root's `CHANGELOG.md` at run time. The exclusion is a
deliberate trade of demand frequency, not a claim that the half never observes these files.
`openspec/`, `.conductor/` and `docs/` are edited by nearly every change. `CHANGELOG.md` is edited
mostly by the release commit, which also bumps `.claude-plugin/plugin.json` and so demands the
functional half through the subject regardless, and the structural check the half applies to it also runs on
every commit in the assertion half. A record-only change that breaks a functional test is caught
by CI, which runs every bucket on every push, and not before the commit.

Every OTHER assertion-half file SHALL NOT be in the subject: the per-commit gate runs it on every
commit, and a functional file naming a twin in a comment does not make the twin something the
functional half executes. A staged change to any file in the subject SHALL demand a fresh functional result. A
module SHALL NOT fall outside the subject because it reaches git by another route, or because it
does not reach git at all.

**The sweep bucket's subject** SHALL be the whole engine source (the entry point and every
`scripts/lib/*.mjs` module) plus every tracked `scripts/test/sweeps/*.mjs` file (its tests AND the
code they run, such as `output-interpolations.mjs`) plus `scripts/test/js-lexer.mjs`, which the
sweep imports. A change to the sweep's own method is a change to its result. Whenever any one of those paths
is staged, the WHOLE set is judged, never only the staged path.

**A staged change** is any path the staged diff names: an addition, a modification (content or
mode), or a deletion. A path is in a subject when it is in the subject derived from the index, or,
for a path the index no longer holds, when it was in the subject derived from the current HEAD. A
staged deletion of a subject path therefore demands the bucket exactly as an edit does.

**The assertion half SHALL itself be divided into two RUNGS, and the division SHALL be by what a
test OBSERVES rather than by how fast it is.**

- **The unit rung** holds tests whose observable is a **VALUE** the engine produced: a verb's result,
  a refusal, or any value the record holds, obtained through the store the test supplies rather than
  by reading a path. A test asserting what the record **SAYS** (the values in `state.json`) belongs
  to this rung and runs over an in-memory store. The rung is the home of the record's values, not of
  its file.
- **The file rung** holds tests whose observable is **BYTES on disk**, that is, a test that needs the
  bytes the engine WROTE to exist at a path. Examples are the rendered `PROJECT.md`, the record file
  itself, the write-conflict log and the managed rules block. A test whose observable is a value the
  store could hand it does not belong on the file rung merely because that value is persisted in the
  record.

Both rungs are members of the assertion half by TRIGGER: they run on every commit, and a commit runs
both in ONE invocation of the test runner, with one count floor over both. How many processes that
runner starts is the RUNNER's business and not a property of the half; the runner MAY execute the
half's files in parallel, one process per file. A rung is not a half. The functional trigger, the
functional half's membership and the change-triggered bucket are unchanged by this division, and no
test in either rung may spawn a process or reach git.

The two rungs SHALL be named on disk, so a test's rung is derived from its path and never declared in
a registry.

#### Scenario: A commit that touches nothing certified runs the assertion half only

- **WHEN** a commit's content changes no file in the functional subject and no file either half is
  written in
- **THEN** the pre-commit gate runs both rungs of the assertion half in one runner invocation and
  does not run the functional half

#### Scenario: A commit that touches a certified module requires a fresh functional result

- **WHEN** a commit changes a file in the functional subject
- **THEN** the pre-commit gate requires a fresh functional result for that commit's content, refuses
  the commit when there is none, and names the run that would satisfy it. It does not start that run
  itself.

#### Scenario: An engine module that never reaches git is still in the subject

- **WHEN** a commit rewords a refusal in an engine library module that makes no gateway call, and a
  functional test asserts on that refusal's text
- **THEN** the module is in the functional subject because the half imports it. The pre-commit gate
  refuses the commit until a functional run over the new content has passed.

#### Scenario: Deleting a functional test file demands the functional half

- **WHEN** a commit's only staged change is the deletion of a functional test file
- **THEN** the deleted path is in the subject derived from HEAD, so the change demands a fresh
  functional result, and the pre-commit gate refuses the commit until a run over the new content
  has passed

#### Scenario: A change to the sweep's own method demands the sweep bucket

- **WHEN** a commit's only staged change is to `scripts/test/sweeps/output-interpolations.mjs`, which
  is not a test file
- **THEN** the path is in the sweep bucket's subject, so the change demands a fresh sweeps result,
  and the pre-commit gate refuses the commit until a sweeps run over the new content has passed

#### Scenario: A file the functional half runs without importing is in the subject

- **WHEN** a commit changes `.githooks/pre-commit`, which a functional test copies into a fixture and
  runs by name
- **THEN** the change demands a fresh functional result, exactly as a change to an imported module
  does

#### Scenario: An assertion-half file is not in the functional subject

- **WHEN** a commit changes only an assertion-half test file that no functional test executes,
  including the twin of a functional test that names it in a comment
- **THEN** no functional result is demanded for it, and the per-commit gate runs it

#### Scenario: An assertion-half file the functional half executes is in the subject

- **WHEN** a functional test runs an assertion-half test file as a nested test run, naming its path
  as a quoted string, and a commit changes only that assertion file
- **THEN** the change demands a fresh functional result, because the functional test's result
  depends on the file it runs

#### Scenario: The unit rung is not a half and demands no functional counterpart

- **WHEN** a test is added under the unit rung and no test of any other kind carries its id
- **THEN** nothing is refused, because the unit rung is a rung of the assertion half rather than a
  third half, and the twin rule's one direction binds only the functional half

#### Scenario: The runner's isolation mode is not a flag the gate probes for

- **WHEN** the pre-commit gate runs the assertion half on any supported Node major
- **THEN** it invokes the runner with the runner's default isolation, carries no probe for an
  isolation flag and no cached answer to one, and uses the same command line on every supported
  major

### Requirement: Every tracked test file has exactly one home, and the floor counts what the runner was given

The enumeration of the suite SHALL cover every tracked test file under the test directory, and each
one SHALL have exactly one home: the assertion half's unit rung, the assertion half's file rung, the
functional half, or a named change-triggered bucket whose run writes the record entry that covers it.
A tracked test file in none of them SHALL be a refusal that names the file — a file in no home is run
by nothing and counted by nothing, and that state SHALL NOT be reachable by silence. The
change-triggered bucket is not a half: its members run no git and start no engine, and the twin rule
does not reach them.

The pre-commit gate's test-count floor — the check that aborts a commit when the runner ran fewer
tests than the suite declares — SHALL enumerate the declared count from the tracked files of exactly
the set the runner was given in that invocation, and not from the runner's own glob nor from any
superset of it. Where one invocation is handed MORE THAN ONE rung, the declared count SHALL be
enumerated from the same list of rungs that invocation was handed, and from no rung it was not. What
the floor compares is what the runner RAN against what the runner was GIVEN, so the two counts agree
by construction on a healthy tree and can disagree only in the direction the floor exists to catch.

#### Scenario: A test file in neither half is refused

- **WHEN** a tracked test file exists under the test directory outside the four named homes
- **THEN** the pre-commit gate refuses the commit naming that file, rather than running and counting
  nothing

#### Scenario: A collapsed half still fires the floor

- **WHEN** the files the runner is handed for a rung are fewer than the tracked test files that rung
  holds — a glob that stopped matching a directory, or a file renamed out of it
- **THEN** the floor fires, because the declared count was enumerated from the tracked set and not
  from the same expansion the runner was handed

#### Scenario: A two-rung invocation's floor covers both rungs and neither more nor less

- **WHEN** the runner is handed the unit rung and the file rung in one invocation
- **THEN** the declared count is the tracked files of those two rungs together, and the floor does not
  abort on the functional half's or the change-triggered bucket's files, which that invocation was not
  given

#### Scenario: The change-triggered bucket is demanded only when its subject moves

- **WHEN** a commit changes engine source, in no rung of the assertion half
- **THEN** the gate demands a fresh run of the change-triggered bucket and names it, and the
  per-commit assertion half is unaffected

### Requirement: Every functional test has an assertion twin sharing its id

Every test in the functional half SHALL have an assertion twin in the assertion half, and the two
SHALL be identified by the same id. The id SHALL be derived from the two files' place on disk rather
than declared in a registry, so a pair whose halves are renamed apart is not silently paired with
something else.

The coverage SHALL hold in ONE direction: a functional test with no assertion twin is a refusal. An
assertion-half file with no functional twin is NOT a refusal and SHALL NOT be treated as one. A test
whose subject is not git's behaviour belongs in the assertion half precisely because it needs no
real git. Demanding a functional counterpart for it would either invent an empty one or pull every
assertion file into the triggered half.

**A change to a functional file SHALL carry its twin in the same commit, unless the commit DECLARES
that the change does not touch what the file tests.**

- **The declaration** is a git trailer, one per exempted id: `Twin-Unchanged: <id> — <reason>`.
  What counts as a trailer SHALL be decided by git's own trailer parser
  (`git interpret-trailers --parse --no-divider`), which stops at a `commit -v` scissors line and,
  like the `%(trailers)` format, does not treat a `---` line as the end of the message, so the check
  and Gate 2's `%(trailers:key=Twin-Unchanged)` audit read the same declarations by construction. A
  line that git does not parse as a trailer (for example one inside a prose paragraph) declares
  nothing.
- **The value's split.** The id SHALL be the value's first whitespace-delimited token, and it SHALL
  be followed by a spaced separator, ` — `, ` -- ` or ` - `; the reason is everything after that
  separator. So a hyphenated id (`conductor-09`) and a reason that itself contains `-` are read
  whole. A value with no spaced separator after its first token has an empty reason.
- **Where it is checked.** Only the commit-msg hook can read the message, so the coupling check SHALL
  run there, in the same drift script, over the same index the pre-commit gate judged.
- **What is refused.** The check SHALL refuse a declaration that names an id whose functional file is
  not staged, and a declaration with an empty reason.
- **What passes.** A declared id SHALL pass without its twin. Every declared id SHALL be printed on
  the accepting run, so the exemption is visible where the commit was made.
- **Who may declare.** The committer may. The exemption is audited, not pre-authorised: Gate 2 lists
  every `Twin-Unchanged` trailer in the range it reviews, and judges whether each declared change
  really left the subject untouched. Gate 2 reviews the development range before any squash into the
  main branch, so a squash that drops trailers loses nothing the audit needed.

An edit to the twin made only to satisfy the check is no longer the way through.

**A merge commit SHALL NOT be judged by the coupling check.** git runs the commit-msg hook for a merge
but not the pre-commit hook. A merge's staged set is every change the other parent brings in, and
each of those commits was judged, with its own declarations, when it was made. A declaration on a
merged-in commit is not on the merge's message. So judging the merge would refuse a change that
already passed. A squash commit is an ordinary commit and IS judged.

#### Scenario: A functional test with no twin is refused

- **WHEN** a test is added to the functional half and no test carrying its id exists in the assertion
  half
- **THEN** the pre-commit gate refuses the commit, naming the missing id

#### Scenario: A functional test changed without its twin is refused

- **WHEN** a commit changes a functional test's file, does not change its assertion twin, and
  declares no exemption for that id
- **THEN** the commit-msg hook refuses the commit, naming the id and the twin's path

#### Scenario: A declared subject-free change passes without its twin

- **WHEN** a commit changes a functional test's file without its twin, and its message carries
  `Twin-Unchanged: <that id> — <reason>`
- **THEN** the commit is accepted, and the accepting run names the exempted id and the reason

#### Scenario: A declaration that exempts nothing staged is refused

- **WHEN** a commit message carries `Twin-Unchanged: <id> — <reason>` for an id whose functional file
  is not in the staged set
- **THEN** the commit is refused, naming the id, because an exemption that names nothing staged is a
  stale or mistyped claim

#### Scenario: A trailer-shaped line that git does not parse as a trailer declares nothing

- **WHEN** a commit message's only `Twin-Unchanged:` line sits in a paragraph that also holds prose,
  or after a `commit -v` scissors line, or the message is a subject line alone
- **THEN** no exemption is read, the commit is judged as if undeclared, and it is refused when its
  functional file is staged without its twin

#### Scenario: A declaration with no reason is refused

- **WHEN** a commit message carries `Twin-Unchanged: <id>` with an empty reason
- **THEN** the commit is refused, naming the id, because an exemption Gate 2 cannot judge is not an
  exemption

#### Scenario: A merge that brings in an exempted change is not refused

- **WHEN** a branch commit changed a functional file without its twin under a `Twin-Unchanged`
  declaration, and that branch is merged with a merge commit whose message carries no declaration
- **THEN** the commit-msg hook does not refuse the merge, because a merge is not judged by the
  coupling check

### Requirement: The doubles cannot drift from the git they stand in for

The assertion half's git double SHALL answer with output that is byte-identical to what the real git
on the machine produces for the same invocation. The functional half SHALL include a check that
proves this against the real binary, so a difference introduced by a git version, a configuration or
an edit to the double is a failure rather than a silently wrong assertion.

Where the real output legitimately changes — a new git version formats a field differently — the
failure SHALL name the field that differs, and refreshing the double SHALL be a deliberate edit that
the record in the next requirement then re-certifies.

#### Scenario: A double that disagrees with live git fails

- **WHEN** the double's canned output for an invocation differs by even one byte from the real git's
  output for the same invocation
- **THEN** the functional half fails and names the invocation and the differing field

#### Scenario: A double captured against a frozen fixture does not rot

- **WHEN** the machine's git produces output a test author did not anticipate
- **THEN** the check fails visibly and names the difference, rather than the assertion half passing
  against a stale capture

### Requirement: A functional result is recorded and checked, never remembered

A passing run of a triggered bucket SHALL record what was certified, over what content, and when. The
record SHALL be durable and machine-readable.

**One passing run SHALL write one entry, and an entry SHALL be a MANIFEST.** A manifest maps every
path in the bucket's subject that the index holds to that path's mode and content identity as the
run's index held it (what `git ls-files -s` reports). A path the subject's derivation names but the
index does not hold has no mode or content identity, and is not in the manifest. The subject includes the test files that ran, so the manifest
names the tests the claim rests on by construction.

**The record SHALL be keyed by content and SHALL be append-only.**

- **Naming.** An entry's name SHALL be derived from the content its manifest describes.
- **Writing.** Writing an entry SHALL create it, and SHALL never rewrite the CONTENT of an entry
  another run wrote (its manifest, bucket, result, counts and provenance), so no run can overwrite,
  drop or corrupt another run's entry. A run over content already recorded MAY refresh that entry's
  run time, replacing the entry whole and atomically with every other field unchanged, so that pruning
  ranks the re-certification as recent. A file under an entry's name that cannot be parsed is no entry:
  a run over that content SHALL replace it whole and atomically, the gate SHALL refuse it naming the
  file, and pruning SHALL remove it.
- **Pruning.** The record MAY prune its oldest entries. A pruned entry can only cause a demand for a
  new run, never a pass.

**The gate SHALL decide freshness from the RECORDED CONTENT, not from the age of the record and not
from a commit identity.** A commit that stages a change in a bucket's subject is fresh for that
bucket only when ONE passing entry for that bucket agrees with the commit's index on the bucket's
WHOLE subject:

- the same path set: the manifest holds exactly the paths of the subject derived from the index
  that the index holds;
- the same mode and the same content identity for every one of those paths.

Agreement on the staged paths alone SHALL NOT suffice, because a run's result depends on every file
in its subject, staged or not. Two entries SHALL NOT be combined, because a combination of contents
that no run observed together is not a result. A subject whose content is unchanged SHALL NOT
require a new run however long ago the record was written. A subject whose content has changed,
including a mode-only change, SHALL require one however recent the record is.

**An entry that does not agree with the commit's whole subject is not about this tree, and SHALL NOT
apply to it.** It is neither a pass nor a refusal. Because agreement is equality of the whole
manifest, two different subject contents can never both agree with one index. So a renamed module, a
deleted functional test and a removed conformance row are each a staged change to the subject, and
each demands a run over the new content. The gate SHALL NOT refuse over an entry's pointers into some
other tree.

**The format SHALL change cleanly.**

- A record in a superseded format SHALL NOT be read as a certification by the current gate, and the
  current runner SHALL NOT remove it. The two formats coexist: neither gate reads the other's record,
  so a rollback to the superseded gate finds its own record where it left it. Retiring the
  superseded record is later work, not this requirement's.
- A clone with no record at all SHALL behave as a record with no entries: a commit that stages
  nothing in a subject demands nothing, and one that stages something demands a run.

An assertion SHALL never satisfy this requirement. A subject whose content changed SHALL require a
run of its bucket even where the assertion half covers the same behaviour.

#### Scenario: An unchanged module needs no new run

- **WHEN** a module in the functional subject has been untouched for months and a commit changes
  something outside every subject
- **THEN** no functional run is required, and the gate does not ask for one

#### Scenario: A changed module needs a new run however recent the record

- **WHEN** a module in the functional subject is edited immediately after a certified run over it
- **THEN** no entry agrees with the new content, and the gate refuses the commit until the functional
  half is run again

#### Scenario: A stale record is not a silent pass

- **WHEN** the gate cannot find an entry agreeing with the commit's whole subject manifest: no record
  at all, only entries for another bucket, or only entries over different content
- **THEN** the refusal names the changed paths and the run that would satisfy it, and the commit
  does not proceed

#### Scenario: A certification split across two commits demands a run for each

- **WHEN** a run certifies an index holding changes to two subject files, and they are then committed
  one at a time, each commit staging only one of them
- **THEN** the first commit is refused, because its index holds the other file's old content and so
  its whole subject differs from the run's manifest; each split commit needs a run over its own index

#### Scenario: A mode-only change demands a run

- **WHEN** a commit changes only the executable bit of a file in a subject, and an entry agrees with
  the previous mode
- **THEN** no entry agrees with the commit's whole subject, and the gate demands a run

#### Scenario: Two runs' contents are not combined into one pass

- **WHEN** a commit stages two subject paths, one entry agrees on the first path only, and another
  entry agrees on the second path only
- **THEN** the commit is refused, because no single run observed that combination

#### Scenario: Deleting a functional test demands a run

- **WHEN** a commit deletes a functional test file, or removes a row from the conformance set, with
  every engine module unchanged
- **THEN** the gate demands a functional run over the new content, rather than accepting the commit
  on an entry whose manifest still holds the deleted file or row, and no entry written before the
  deletion agrees with the new subject

#### Scenario: An entry from another tree neither passes nor refuses

- **WHEN** the record holds an entry whose manifest names a functional test that does not exist in
  this tree, so that entry does not agree with the commit's whole subject manifest
- **THEN** that entry is ignored, and the commit is judged only by an entry agreeing with the
  commit's whole subject manifest

#### Scenario: A superseded record is not a certification

- **WHEN** the git common dir still holds a record written in the superseded single-file format
- **THEN** the gate reads no certification from it, and a run in the current format leaves that file
  as it found it

#### Scenario: A fresh clone demands a run only for what it stages

- **WHEN** a clone holds no record and a commit stages a file in the functional subject
- **THEN** the gate refuses the commit and names the run, while a commit staging nothing in any
  subject is not refused

### Requirement: The pre-commit gate checks the record without running the functional half

The checks that enforce the requirements above SHALL be performed by one script that reads files. The
pre-commit gate runs three of them: the enrolment check, the twin pair and the record's freshness. The
commit-msg hook runs the diff-coupling check, which is the only check that must read the commit
message.

The script SHALL NOT run the functional half. It SHALL NOT spawn a test runner or the engine. It SHALL
NOT start a git fixture or drive git against a repository. Its whole access to git SHALL be READS
through a permitted set of read-only subcommands: what is tracked, what is staged, the staged bytes
and their modes and object ids, the current HEAD's tree (to judge a staged deletion), where the
common directory and the per-worktree git paths are, and git's own parse of the commit message's
trailers. The permitted set SHALL be enforced where the call is made.

Run with no phase named, the script SHALL perform every check that can be judged from a working
tree: the pre-commit checks, and the coupling check with the declarations of a message file when one
is given and with none otherwise. A developer's bare run therefore never reports fewer refusals than
the two hooks together would.

The property being protected is that enforcing the link cannot start the thing whose result it is
checking, and cannot make every commit as slow as the thing the link exists to keep out of the way.

The script SHALL be development-only: it SHALL NOT be part of what the plugin ships, and it SHALL add
no runtime or development dependency.

#### Scenario: The gate stays fast

- **WHEN** the pre-commit gate runs on a commit that touches the functional subject
- **THEN** the refusal or the acceptance is produced by reading files, with no engine process and no
  git fixture started by the check itself

#### Scenario: The script is not shipped

- **WHEN** the plugin's shipped files are enumerated
- **THEN** the drift script is not among them, and the engine's dependency count is unchanged

#### Scenario: The coupling check judges the index the commit is made from

- **WHEN** a commit is made as a plain commit, with `-a`, with a path argument, or from a linked
  worktree
- **THEN** the commit-msg run of the coupling check reads the staged set from the index git hands that
  hook, which is the index the commit is made from

#### Scenario: Coupling is enforced in exactly one place

- **WHEN** a staged functional file lacks its twin and no declaration exempts it
- **THEN** the commit-msg hook refuses the commit and names the id and the twin's path, and the
  pre-commit run does not also report it

### Requirement: A fixture is built once per file and restored per test

Where a file's tests share a starting repository, that repository SHALL be built ONCE for the file and
each test SHALL start from a RESTORATION of it rather than from a fresh build. The restoration SHALL
NOT re-run the engine and SHALL NOT perform a durability flush per file.

The restoration SHALL be faithful: a test that mutates the state, writes a record or moves the active
pointer SHALL NOT be able to affect the next test in the file, and a test that reads a file the
fixture built SHALL read the bytes the fixture wrote.

#### Scenario: A test that mutates the restored fixture does not affect the next test

- **WHEN** two tests in one file share a fixture and the first changes the state the second reads
- **THEN** the second sees the state the fixture was built with, not the first test's mutation

#### Scenario: Restoration does not re-run the engine

- **WHEN** a test restores a fixture that a previous test has already built
- **THEN** no engine subprocess is started and no engine verb is called to produce the restored tree

### Requirement: A rung's membership is decided by what a test observes, and a rung that stops observing it moves

A test SHALL be placed in the rung matching its observable at the moment it is written, and a test
whose observable changes SHALL move rungs in the same commit rather than staying where it was filed.
The two failure directions are both real and both silent: a test that observes a value but lives in
the file rung pays for filesystem work it does not read, and a test that observes a file but lives in
the unit rung either fails or, worse, passes while observing a stub instead of the artifact.

Neither direction is made loud by the unit rung's guard: the guard scans `scripts/test/unit/` only, so
a test left on the file rung that asserts on the record's values goes undetected. What carries the
first direction is the per-file judgment of the migration (task 4.1), which sorts a file's tests by
observable as each file moves. The second direction is loud where the test actually reads: a
unit-rung test that asserts on a file has to read one, and reading one is what the unit rung's guard
refuses.

#### Scenario: A test moved between rungs keeps its assertions

- **WHEN** a test whose observable is a value is moved from the file rung to the unit rung
- **THEN** its assertions are unchanged — the same values are asserted — and only the mechanism it
  obtains them through moves

#### Scenario: A unit test cannot satisfy its assertion from a stub of the artifact it stopped reading

- **WHEN** a test that asserts on a written file is filed in the unit rung
- **THEN** it is refused by the unit rung's guard rather than passing against a substitute, because
  the guard refuses the read the assertion would have needed

### Requirement: No test in the assertion half spawns a process or runs git

No TEST in the assertion half SHALL start a child process: a test SHALL NOT start an engine
subprocess, and it SHALL NOT run a real `git` binary — git behaviour it depends on SHALL be supplied
by an injected double. The prohibition binds the half's TESTS and the fixtures they call; it does not
bind the test RUNNER, which MAY start one process per test file and is the only thing in the per-commit
path that runs work in parallel.

A test SHALL exist that fails when a file in the assertion half spawns a child process or invokes
git, so the property is enforced rather than merely intended. The guard SHALL observe the half at RUN
TIME as well as in its source: a git invocation reached by calling a library function directly — one
whose spawn is written three modules away, and never in the test file that caused it — is the same
violation and SHALL fail the run. Because the runner MAY give every file its own process, the run-time
observation SHALL be installed in EVERY process the runner starts for the half: every test file of
both rungs SHALL install it itself, rather than relying on another file having installed it in a
process they share, and a rung file that does not install it SHALL be refused by the source guard
with the file named.

**The UNIT RUNG carries a further prohibition, and it is what makes the rung worth having: a test file
in it SHALL perform no filesystem work at all.** It SHALL NOT import the filesystem module, SHALL NOT
read, write, create or remove a path, and SHALL NOT flush a file to disk. This is the property the
rung exists for — the assertion half's cost was measured as durability flushing, thousands of calls
per run, on tests that assert on a value — so a unit-rung file that has drifted into doing disk work
SHALL fail a guard rather than merely run slowly, and the guard's refusal SHALL name the file and the
call shape it found. The run-time git counter that every rung file installs (above) is not the TEST's
filesystem work: the harness installs it at import time and removes its directory at process exit,
both outside any test's window. The unit rung's run-time filesystem counter watches only while a test
runs, and its source scan reads the test file's own code, never the harness it imports — so the two
rules do not collide.

#### Scenario: A spawn added to the assertion half fails a guard

- **WHEN** a file in the unit rung or the file rung is edited to spawn a child process or to run git
- **THEN** the guard test names that file and the assertion half fails

#### Scenario: The runner parallelizes and the tests still spawn nothing

- **WHEN** the assertion half is run in the repository, under the runner's default process-per-file
  isolation
- **THEN** every file's tests run, the run reports one summary for both rungs, and no test in either
  rung starts an engine subprocess or runs a real `git`

#### Scenario: A real git call in any file's process fails the run

- **WHEN** a test in a file that does not share a process with any other test file reaches the real
  `git` binary through a library call
- **THEN** that file's process reports the invocation and the run fails, exactly as it would if the
  file had shared a process with the rest of the half

#### Scenario: A rung file that does not install the run-time counter is refused

- **WHEN** a test file is added to either rung without installing the run-time git counter itself
- **THEN** the source guard names that file and the run fails, rather than the file running with the
  real `git` reachable and nothing counting

#### Scenario: A unit test that writes to disk fails a guard

- **WHEN** a file under the unit rung's directory is edited to read or write a file, or to import the
  filesystem module
- **THEN** the guard test names that file and the run fails, rather than the rung silently costing
  what the file rung costs

#### Scenario: The unit-rung guard is seen to discriminate

- **WHEN** the guard's check is exercised directly against a source that imports the filesystem module,
  against one that calls a write, and against one that only mentions either inside a comment
- **THEN** the first two are refused with the file named and the third is not refused, so the guard is
  a check that has been observed to fail rather than one assumed capable of it

### Requirement: Every run the suite is counted from reads one summary format, and a count it cannot read refuses

Every place that runs a bucket of the suite in order to COUNT it — the pre-commit gate, each of CI's
bucket steps, the runner that writes the certification record, and the release procedure's published
test count — SHALL force the same test reporter and SHALL disable colour in that reporter's output, so
the summary line is the same bytes on every supported Node major and under any colour setting the
environment carries. Each of those places SHALL parse exactly that one format.

A run whose summary cannot be parsed, or whose summary reports zero tests, SHALL be a refusal at every
one of those places, and SHALL NOT be reported as a pass. The count floor is only as good as the count
it reads: a floor skipped because the count was unreadable is a floor that did not run.

Where a place also holds a declared count, the count floor SHALL be compared FIRST: a run that reports
fewer tests than are declared — zero included — is refused as a shortfall naming both counts. Only when
the declared count is itself zero is the refusal that the bucket holds no test file, so a run that
collapsed while the index still holds tests is never reported as an empty bucket.

A pattern handed to the runner that matches no file SHALL NOT fail the run on its own: the files the
other patterns matched still run and are counted, and the count floor, not the unmatched pattern,
decides whether anything is missing.

#### Scenario: A colour setting in the environment does not change the count

- **WHEN** the assertion half is run by the pre-commit gate in an environment that forces colour
  output
- **THEN** the gate reads the same test count it reads without that setting, and the floor compares
  it

#### Scenario: An unreadable summary refuses the commit

- **WHEN** the runner exits zero but its output carries no summary line in the format the gate parses
- **THEN** the gate refuses the commit and says the count could not be read, rather than reporting the
  tests as passing and skipping the floor

#### Scenario: A run of zero tests refuses the commit

- **WHEN** neither rung of the assertion half holds a tracked test file, so the declared count is zero
  and the runner reports zero tests
- **THEN** the gate refuses the commit naming the two rungs it found empty, and at no point is the
  runner invoked without a path — which would fall back to the runner's default discovery and reach
  the triggered halves

#### Scenario: A collapsed run is a shortfall, not an empty rung

- **WHEN** the rungs' tracked files declare tests but the runner reports zero
- **THEN** the gate refuses the commit as a shortfall naming both counts, and does not say the rungs
  hold no test file

#### Scenario: A CI bucket that ran nothing fails

- **WHEN** a CI bucket step's runner reports zero tests, whatever its declared count
- **THEN** the step fails, rather than passing because zero is not less than zero

#### Scenario: One rung that matches nothing does not stop the other

- **WHEN** one rung's directory holds no test file while the other rung's does
- **THEN** the other rung's tests run and are counted, the run is not refused for the unmatched
  pattern, and the count floor compares what ran against what the index declares

#### Scenario: The same summary on every supported major

- **WHEN** the same test files are run under the forced reporter on each supported Node major
- **THEN** the summary lines are byte-identical apart from the reported duration

### Requirement: A test that waits asynchronously on a child process bounds the wait

A test that starts a child process ASYNCHRONOUSLY and waits for the child's close or exit event SHALL
bound that wait. When the bound expires the test SHALL kill the child and SHALL fail, naming the
invocation that did not finish and the bound it exceeded. A hung child SHALL therefore cost one failed
test, never a run that does not end.

A source check SHALL exist that refuses a test-suite helper which waits on a child's close or exit
event — through an event listener, a one-shot listener, or the events module's promise form — without
a bound, so a sibling of a fixed helper cannot reintroduce the hang unnoticed.

A SYNCHRONOUS spawn is outside this requirement: it blocks one test file's process rather than leaving
an awaited promise unresolved, most of the suite's synchronous spawns carry no per-call bound today,
and in CI every one of them is bounded by the job's time limit. This requirement does not claim more
than that.

#### Scenario: A hung child fails its test instead of hanging the run

- **WHEN** a child a test is waiting on never exits
- **THEN** the child is killed when the bound expires, the test fails with a message naming the
  invocation and the bound, and the rest of the run proceeds

#### Scenario: An unbounded wait is refused at the source

- **WHEN** a helper in the suite is written to wait for a child's close or exit event with no bound,
  in any of the three forms
- **THEN** the source check names the file and the run fails

### Requirement: Certification runs over the index the commit will be made from

The runner that writes the record SHALL run a bucket over the content of the INDEX, not over the
working tree, and it SHALL record the manifest of that same content.

- **One copy.** It SHALL take one copy of the index. It SHALL export that copy's files, and read that
  copy's per-path content identities, so the bytes that ran and the bytes recorded cannot come from
  two different moments.
- **What runs.** A partially staged file SHALL be run and recorded as its staged half. An untracked
  file SHALL be neither run nor recorded.
- **What it leaves alone.** The runner SHALL NOT write the working tree, the index, the stash or a
  worktree registration. An interrupted run SHALL leave nothing the user owns changed, and nothing in
  the record.
- **Where the tests run.** Where a test in the bucket needs a repository around the content it runs
  over (a HEAD, a parent commit, a readable object), the runner SHALL supply one without touching the
  user's repository. The bucket SHALL pass there as it passes in a checkout, or the difference SHALL
  be named in the test.

#### Scenario: A partial stage certifies the staged half

- **WHEN** a certified file has one change staged and another left unstaged, and the runner is run
- **THEN** the bucket runs over the staged content, the manifest records the staged content's
  identity, and a commit of exactly that index is fresh

#### Scenario: An unstaged edit made during a run does not enter the record

- **WHEN** the working tree is edited while a run is in progress
- **THEN** the run's manifest describes the index copy taken at its start, and does not describe the
  edit

#### Scenario: A run leaves the user's repository as it found it

- **WHEN** a run completes, fails, or is interrupted
- **THEN** the working tree, the index, the stash and the list of worktrees are unchanged, and a
  failed or interrupted run has written no entry

#### Scenario: The runner refuses when its own code differs from the index

- **WHEN** `certify.mjs`, `certification.mjs`, `drift.mjs`, `js-lexer.mjs` or `fixtures/observe-reads.mjs`
  differs between the working tree and the index being certified, and the runner is run
- **THEN** it refuses before running the bucket, naming each differing file and telling the user to stage or
  stash the edit, exits non-zero, and writes nothing: no run directory and no entry
- **AND** once the edit is staged, so the two copies match, the runner runs and records as usual

### Requirement: Concurrent worktrees cannot invalidate each other's certification

Several worktrees of one clone SHALL be able to certify and commit at the same time, with no lock
held across certification and commit. They are safe by construction:

- entries are named by content and created, and an entry's content is never rewritten; only its run
  time (`ranAt`) is refreshed, atomically;
- freshness is judged per commit against the entries that agree with that commit's own index.

So one worktree's run SHALL NOT remove, replace or stale another worktree's entry, and an entry
describing another tree's content SHALL NOT refuse this tree's commit. One stated exception: on a
filesystem without hard links, a writer whose exclusive-create write FAILS removes the file it created
by path, and if a second worktree has meanwhile replaced that torn file with a whole entry for the
same key, that entry is removed with it. It needs a failed write plus a concurrent certify of the
same content; the result is a fresh demand to certify, never a false pass.

A lock that limits MACHINE LOAD, such as the pre-commit gate's suite lock, is outside this
requirement and MAY remain. It limits how much runs at once, and correctness does not depend on it.

#### Scenario: Two worktrees certify different content and both commit

- **WHEN** worktree A and worktree B each run the functional certification over different content,
  in either order or at the same time, and then each commits
- **THEN** both commits are fresh, and neither run's entry is missing or altered after the other's
  write

#### Scenario: A peer's uncommitted test does not block this worktree

- **WHEN** worktree B certifies content that includes a functional test that exists only on B's
  branch, and worktree A then commits a change to its own subject after its own run
- **THEN** A's commit is judged by A's entry alone, and B's entry does not refuse it

#### Scenario: Concurrent writers lose no entry

- **WHEN** two runs finish and write their entries at the same instant
- **THEN** the record afterwards holds both entries, whole

### Requirement: The functional subject's derivation is checked against what a run observes

The functional subject is derived from source text, and a test can reach a repository file in a way
that text does not show: a path assembled at run time, or a file read through a helper. So the
functional certification SHALL observe, while the half runs, which tracked repository files are
imported, read or executed. Any observed file outside the derived subject SHALL fail the
certification. The refusal SHALL name the file and say that the derivation missed it, and SHALL
record no entry.

The observation SHALL be made by the certification runner, not by the per-commit gate.

**The observer SHALL survive into every Node process the half starts.** A test that sets the
environment's Node options for a child SHALL append to the inherited value, never replace it. The
runner SHALL detect a Node child that the half starts DIRECTLY and that loads code but never reports
to the observer, and SHALL then fail the certification closed, naming the test file and the child's
argument vector, and SHALL record no entry. A Node child that only prints its version or its help
loads no code and is not expected to report, and a child that failed to start (the spawn reported an
error) is not expected to report either. A child's report SHALL be written synchronously when the
observer loads, so a child that exits at once has still reported. A Node process started
INDIRECTLY, by a non-Node process the half starts (git running a hook, a shell), cannot be matched to
an expectation at run time; for it a static check SHALL refuse any functional test or fixture whose
CODE assigns the Node options variable a value not carrying the inherited value. An assignment is
either an object key (bare or quoted, including a key that overrides a spread environment) or a
property assignment (dotted with a bare name, or subscripted with a quoted name). Text in a comment, or in a
string that is not itself the key or the subscript of such an assignment, is not an assignment and
SHALL NOT be refused.

**A failed observation write SHALL fail the certification closed.** Each Node process SHALL write its
observations to its own file, one event per line, each event written when it happens and before the
operation it observes, and a process that ends normally SHALL record that it exited. A process killed
mid-write can tear only its LAST line. A failed write (a full disk, a file-size limit) tears the last
line too and loses every event after it, so each process SHALL hold a sentinel beside its file from
load, and SHALL remove it on its first failed write. The runner SHALL refuse, naming the process's
file and recording no entry: a file whose sentinel is absent, torn or not; a sentinel without its file;
a torn last line from a process that recorded its own exit; and any corrupt line other than the last.
A torn last line SHALL be dropped, and the rest of the file read, ONLY from a process that holds its
sentinel and recorded no exit, which is a process killed by a signal. A process that cannot open its
file while the run's observation directory exists SHALL fail rather than run unobserved.

It has five stated limits:

- A file read only by a process that is not a Node process started by the half (a shell script
  reading a file on its own) is not observed. Nor is a Node process started indirectly whose options
  were replaced by an expression the static check cannot read (a value assembled at run time).
- A Node process started indirectly whose environment OMITS the Node options variable (an
  environment built without spreading the inherited one, or one the variable was deleted from) does
  not load the observer, and no assignment exists for the static check to refuse. It is not
  observed.
- A read of the repository's record (`openspec/`, `.conductor/`, `CHANGELOG.md`, and `docs/` other
  than the parity ledger), which the subject excludes by rule, is not a refusal.
- The static check reads source with a lexer that decides between a regex literal and division from
  the preceding token, and reads a `/` after `)` or `}` as division. A regex literal in statement
  position after one of those (`if (x) /re/.test(s)`, or a statement that begins with a regex after
  a block's closing brace) is misread. The check refuses to answer only when the misread meets an
  unescaped newline or the end of input. A misread that does not (a regex holding `//`, read as a
  line comment, or a matched pair of quotes, or backticks that pair up across two such regexes)
  records nothing, and an assignment of the Node options variable inside the misread span is not
  refused.
- A failed observation write whose sentinel removal ALSO fails (the observation directory itself
  unwritable at that instant) is indistinguishable from a kill: its torn last line is dropped and the
  events after the failure are lost.

#### Scenario: A missed observation fails the certification

- **WHEN** a functional test reads a tracked file under `scripts/` whose name appears nowhere in the
  closure's source, and the certification runs
- **THEN** the certification fails naming that file, and no entry is written

#### Scenario: A failed observation write fails the certification closed

- **WHEN** a Node child the half starts reads a tracked file outside the subject after a write to its
  observation file has failed (the child's file-size limit is reached), and the half passes
- **THEN** the certification fails naming that child's observation file and the failed write, and no
  entry is written

#### Scenario: A child killed after a read still reports the read

- **WHEN** a Node child reads a tracked file outside the subject and is then killed by a signal
- **THEN** its observation holds the read (a torn last line, if any, is dropped), and the
  certification fails naming the file

#### Scenario: A Node child that drops the observer fails the certification closed

- **WHEN** a functional test starts a Node child that loads code with an environment whose Node
  options replace the inherited value, so the observer is not loaded in the child
- **THEN** the certification fails naming the test file and the child's arguments, and no entry is
  written

#### Scenario: A comment that mentions the Node options variable is not an assignment

- **WHEN** a fixture's comment shows a command line that sets the Node options variable, and no code
  in the fixture assigns it
- **THEN** the static check does not refuse the fixture

#### Scenario: A Node child that loads no code is not an unobserved child

- **WHEN** a functional test starts `node --version`
- **THEN** the observer expects no report from it, and the certification is not refused for it

#### Scenario: A complete derivation certifies

- **WHEN** every tracked file the functional half imports, reads or executes is in the derived subject
- **THEN** the observation adds no refusal, and a passing run records its entry
