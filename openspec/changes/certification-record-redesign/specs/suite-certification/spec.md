## MODIFIED Requirements

### Requirement: The suite has two halves with different triggers and different costs

The suite SHALL be divided into an **assertion** half and a **functional** half. The assertion half
SHALL be the half that runs on every commit. The functional half SHALL run only when the change under
test has touched something that only the functional half is able to verify.

The halves SHALL be distinguishable on disk. The trigger that selects the functional half SHALL be
derived from the repository's own contents rather than from a list maintained by hand, so a module
added later cannot silently fall outside it.

**The trigger SHALL be derived from what the functional half OBSERVES, not from how a module reaches
git.** The functional half's **subject** SHALL be the union of three sets:

- every tracked file reachable by static or dynamic import from a functional test file or from the
  engine entry point;
- the functional test files themselves;
- every tracked file under `scripts/`, `.githooks/` or `hooks/` whose file name a test file or
  fixture in that closure spells as a literal. This covers what the half runs or reads without
  importing it, such as the pre-commit hook and the hook configuration.
- every tracked file under a shipped-surface root (`commands/`, `skills/`, `agents/`,
  `.claude-plugin/`) that a closure file spells as a path segment. The root is taken whole, because
  the half walks those roots as well as reading named files from them.
- `README.md`, `CLAUDE.md` and `docs/parity-ledger.json`, when a closure file spells their names.

The repository's own RECORD SHALL NOT be in the subject: `openspec/`, `.conductor/`, `CHANGELOG.md`
and `docs/` other than the parity ledger. Nearly every change edits them, and a functional test that
reads them is reading history rather than the code the half verifies. CI still runs such a test on
every push.

The assertion half's files SHALL NOT be in the subject: the per-commit gate runs them on every
commit, and a functional file quoting a twin's name does not make the twin something the functional
half executes. A staged change to any file in the subject SHALL demand a fresh functional result. A
module SHALL NOT fall outside the subject because it reaches git by another route, or because it
does not reach git at all.

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

#### Scenario: A file the functional half runs without importing is in the subject

- **WHEN** a commit changes `.githooks/pre-commit`, which a functional test copies into a fixture and
  runs by name
- **THEN** the change demands a fresh functional result, exactly as a change to an imported module
  does

#### Scenario: An assertion-half file is not in the functional subject

- **WHEN** a commit changes only an assertion-half test file, including the twin of a functional test
  that spells its name
- **THEN** no functional result is demanded for it, and the per-commit gate runs it

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

- **The declaration** is a trailer in the commit message's final paragraph, one per exempted id:
  `Twin-Unchanged: <id> — <reason>`. Comment lines are ignored.
- **Where it is checked.** Only the commit-msg hook can read the message, so the coupling check SHALL
  run there, in the same drift script, over the same index the pre-commit gate judged.
- **What is refused.** The check SHALL refuse a declaration that names an id whose functional file is
  not staged, and a declaration with an empty reason.
- **What passes.** A declared id SHALL pass without its twin. Every declared id SHALL be printed on
  the accepting run, so the exemption is visible where the commit was made.
- **Who may declare.** The committer may. The exemption is audited, not pre-authorised: Gate 2 lists
  every `Twin-Unchanged` trailer in the range it reviews, and judges whether each declared change
  really left the subject untouched.

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
path in the bucket's subject to that path's content as the run's index held it. The subject includes
the test files that ran, so the manifest names the tests the claim rests on by construction.

**The record SHALL be keyed by content and SHALL be append-only.**

- **Naming.** An entry's name SHALL be derived from the content its manifest describes.
- **Writing.** Writing an entry SHALL create it, never rewrite a file another run wrote, so no run
  can overwrite, drop or corrupt another run's entry.
- **Pruning.** The record MAY prune its oldest entries. A pruned entry can only cause a demand for a
  new run, never a pass.

**The gate SHALL decide freshness from the RECORDED CONTENT, not from the age of the record and not
from a commit identity.** A commit is fresh for a bucket when at least ONE passing entry for that
bucket agrees with the commit's index on EVERY staged path in the bucket's subject:

- the same content, where the index holds the path;
- the path's absence from the manifest, where the commit deletes it.

Staged paths SHALL NOT be satisfied piecemeal by different entries, because a combination of
contents that no run observed together is not a result. A subject whose content is unchanged SHALL
NOT require a new run however long ago the record was written. A subject whose content has changed
SHALL require one however recent the record is.

**An entry that does not agree with the commit's index is not about this tree, and SHALL NOT apply
to it.** It is neither a pass nor a refusal. So a renamed module, a deleted functional test and a
removed conformance row are each a staged change to the subject, and each demands a run over the new
content. The gate SHALL NOT refuse over an entry's pointers into some other tree.

**The format SHALL change cleanly.**

- A record in a superseded format SHALL NOT be read as a certification. It SHALL be removed by the
  first write in the current format.
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

- **WHEN** the gate cannot find an entry agreeing with a staged subject path: no record at all, only
  entries for another bucket, or only entries over different content
- **THEN** the refusal names the changed paths and the run that would satisfy it, and the commit
  does not proceed

#### Scenario: A certification split across two commits stays fresh for each

- **WHEN** a run certifies an index holding changes to two subject files, and they are then committed
  one at a time, each commit staging only one of them
- **THEN** each commit is fresh, because the one entry agrees with each commit's index on every path
  that commit stages

#### Scenario: Two runs' contents are not combined into one pass

- **WHEN** a commit stages two subject paths, one entry agrees on the first path only, and another
  entry agrees on the second path only
- **THEN** the commit is refused, because no single run observed that combination

#### Scenario: Deleting a functional test demands a run

- **WHEN** a commit deletes a functional test file, or removes a row from the conformance set, with
  every engine module unchanged
- **THEN** the gate demands a functional run over the new content, rather than accepting the commit
  on an entry whose manifest still holds the deleted file or row

#### Scenario: An entry from another tree neither passes nor refuses

- **WHEN** the record holds an entry whose manifest names a functional test that does not exist in
  this tree, and this commit stages nothing that entry agrees with
- **THEN** that entry is ignored, and the commit is judged only by the entries that agree with its
  index

#### Scenario: A superseded record is not a certification

- **WHEN** the git common dir still holds a record written in the superseded single-file format
- **THEN** the gate reads no certification from it, and the first run in the current format removes
  it

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
NOT start a git fixture or drive git against a repository. Its whole access to git SHALL be reading
the index through the permitted read-only subcommands: what is tracked, what is staged, the staged
bytes and their object ids, and where the common directory is. The permitted set SHALL be enforced
where the call is made. It reads the commit message as a file.

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

The observation SHALL be made by the certification runner, not by the per-commit gate. It has two
stated limits:

- A file read only by a process that is not a Node process started by the half (a shell script
  reading a file on its own) is not observed.
- A read of the repository's record (`openspec/`, `.conductor/`, `CHANGELOG.md`, and `docs/` other
  than the parity ledger), which the subject excludes by rule, is not a refusal.

#### Scenario: A missed observation fails the certification

- **WHEN** a functional test reads a tracked file under `scripts/` whose name appears nowhere in the
  closure's source, and the certification runs
- **THEN** the certification fails naming that file, and no entry is written

#### Scenario: A complete derivation certifies

- **WHEN** every tracked file the functional half imports, reads or executes is in the derived subject
- **THEN** the observation adds no refusal, and a passing run records its entry
