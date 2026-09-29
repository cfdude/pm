## MODIFIED Requirements

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
- **Writing.** Writing an entry SHALL create it, never rewrite a file another run wrote, so no run
  can overwrite, drop or corrupt another run's entry.
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

## ADDED Requirements

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

### Requirement: Concurrent worktrees cannot invalidate each other's certification

Several worktrees of one clone SHALL be able to certify and commit at the same time, with no lock
held across certification and commit. They are safe by construction:

- entries are named by content and created, never rewritten;
- freshness is judged per commit against the entries that agree with that commit's own index.

So one worktree's run SHALL NOT remove, replace or stale another worktree's entry, and an entry
describing another tree's content SHALL NOT refuse this tree's commit.

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

It has four stated limits:

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

#### Scenario: A missed observation fails the certification

- **WHEN** a functional test reads a tracked file under `scripts/` whose name appears nowhere in the
  closure's source, and the certification runs
- **THEN** the certification fails naming that file, and no entry is written

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
