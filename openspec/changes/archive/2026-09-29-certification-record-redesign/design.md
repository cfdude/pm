# Design: certification-record-redesign

## Context

See `proposal.md` (Why) for the four defects and the 0.50.0 evidence. This section covers only the
machinery as it stands at c96240ab.

**The record.**

- **Where it lives.** One JSON file, `$(git rev-parse --git-common-dir)/pm-suite-certification.json`
  (`scripts/test/certification.mjs:27-30`).
- **Its keys.** It is keyed by entry id: one entry per certified module, plus one `engine-source`
  trigger entry.
- **What an entry holds.** Each entry holds a sha256 over path-tagged bytes (`contentHash()`,
  `:222-226`), a `covers` list derived by basename mention (`coversFor()`, `:252-272`) and, for
  `conductor.mjs`, the conformance ROWS (`:277-286`).
- **How it is written.** `writeEntry()` reads the whole file, sets one key and renames a temp file
  over it (`:346-369`).

**The certify runner.**

- **Where it runs.** `runBucket()` runs `node --test` with `cwd` set to the checkout
  (`scripts/test/certify.mjs:78-88`).
- **What it hashes.** `moduleEntry()` and `triggerEntry()` hash working-tree bytes
  (`certification.mjs:293-323`).
- **What a functional run writes.** It writes one entry per `certifiedModules()` id
  (`certify.mjs:111-129`).

**The drift script.**

- **How it reads.** It reads every set from the index (`indexReaders()`, `drift.mjs:120-132`), and
  the record from disk (`:147-148`).
- **What it refuses.** `recordRefusals()` refuses a staged certified id with no matching entry
  (`certification.mjs:410-437`). It then resolves `covers` and `conformanceRows` for EVERY entry
  against the current tree, staged or not (`:439-483`).
- **Where it runs.** The pre-commit hook runs the SNAPSHOT's own `drift.mjs` against the index git
  handed it (`.githooks/pre-commit:146-159`). Each commit is therefore judged by the drift script it
  contains.
- **Its git access.** The permitted git subcommands are `ls-files`, `diff`, `show` and `rev-parse`
  (`drift.mjs:52-60`), pinned by `assert/drift-script.test.mjs:312`. This change grows the set by two
  read-only subcommands: `ls-tree` at L2 (D1, a staged deletion is judged against HEAD's tree) and
  `interpret-trailers` at L4 (D4, git parses the trailers).

**The locks.**

- **`pm-suite.lock`** (`pre-commit:81-110`) is the hook's own lock. It serializes the assertion half
  across worktrees, to limit machine load.
- **`pm-certify.lock`** is not in the repository. It is the lock 0.50.0's agents hand-rolled around
  certify-and-commit.

**CI** runs the functional half and the sweeps unconditionally and never reads the record
(`.github/workflows/ci.yml:215-259`).

## Goals / Non-Goals

**Goals:**

- Each worktree's certification is correct by construction, with no lock.
- What certify runs, what it records and what the gate judges are the same bytes.
- The functional trigger is what the functional half observes.
- A subject-free change to a functional file has a declared, audited way past check 3.

**Non-Goals:**

- **Running the functional half per commit.** It stays triggered, because it takes minutes. See
  Baseline.
- **Changing CI's buckets.** CI never reads the record.
- **Replacing `pm-suite.lock`.** Machine load is a separate concern from certification correctness.
- **An operation-level map** of which functional test drives which engine call. D3 rejects it.
- **Any change to the engine or to the shipped surface.**

## Baseline (measured 2026-09-28, on c96240ab; re-measured on the day by task 0.3)

**The trigger.** Measured over the 126 non-merge commits of the 0.50.0 build,
`e71c63a3..presquash/pr-234` (tag `presquash/pr-234` is the pre-squash head of #234). Each commit is
judged by the sets derived from ITS OWN tree (`measure.mjs`, `measure-0.50.0.json`):

| Trigger for the functional half | Commits that would demand it |
|---|---|
| Today: calls `gitOps(`, plus `conductor.mjs` | 15 |
| Static, bare side-effect and dynamic import closure of `functional/*` and `conductor.mjs` | 59 |
| The closure, plus files under `scripts/`, `.githooks/` or `hooks/` that closure tests name (assertion half excluded) | 60 |
| **That, plus the shipped-surface roots and `README.md`, `CLAUDE.md`, `docs/parity-ledger.json` (D3's choice)** | **70** |
| D3's choice, with a deleted path judged against the parent's subject (D1) | 70 |
| Any engine module (`conductor.mjs` and `scripts/lib/*.mjs`) | 51 |
| Any engine module, plus `scripts/test/{functional,fixtures}/` | 58 |
| Declared observation map | not measurable: no map exists |

**Other counts over the same range:**

- 51 commits touched engine source. They demanded the sweeps.
- 36 of those never demanded the functional half.
- 21 commits touched a functional test file.
- No commit in the range deleted a subject path: `measure.mjs` reports
  `commitsDeletingOrLeavingSubjectPath: 0`, and
  `git log --no-merges --diff-filter=D e71c63a3..presquash/pr-234` over the subject's directories
  lists no deletion either. So judging deletions against HEAD (D1) changes no count here.

`measure.mjs` follows a bare side-effect `import "…"` since Gate 1 (M1). Re-run on 2026-09-28, every
commit count above is unchanged. Only the closure grew, by `scripts/test/fixtures/hermetic-git.mjs`,
which six functional files import bare and which the named-literal rule had already caught.

Since Gate 1 round 2 (C1), `measure.mjs` also takes an assertion-half file the functional half
EXECUTES as a closure root (D3), and judges subject(HEAD) only for a path the commit's tree no longer
holds (m2). Re-run on 2026-09-28: every commit count above is unchanged (70 of 126, 0 deletions).
The closure grew from 129 to 132: `assert/parity.test.mjs` and `assert/engine-resolution.test.mjs`,
which `functional/temp-dir-cleanup.test.mjs:64-65` runs as nested `node --test` children, plus
`fixtures/assert-git-shim.mjs`, which they import and which the named-literal rule had already
caught.

Since Gate 1 round 3, `measure.mjs` strips comments before the executed-file match (R4) and takes
`hooks/` as a shipped-surface root. Re-run on 2026-09-28: every commit count above is unchanged (70
of 126, 0 deletions), the closure is still 132 and the full subject still 178. The root rule now
admits 37 files rather than 35, but the two it adds, `hooks/hooks.json` and `hooks/README.md`, were
already in the subject by name.

**Sizes at c96240ab:**

- the certified set today: 8 files;
- the import closure: 132 files, including all 65 engine files and the 2 executed assertion files
  (129 before C1, 128 before the bare-import fix);
- the closure plus the named files: 143 (141 before C1);
- D3's full subject: 178 (176 before C1; the shipped-surface roots and root docs add 35).
- The named files add `.githooks/pre-commit`, `hooks/hooks.json`, `scripts/test/drift.mjs` and 7
  fixtures (8 before C1 moved `assert-git-shim.mjs` into the closure; 9 before the bare-import fix
  moved `hermetic-git.mjs`). They also add one false positive, `hooks/README.md`, because
  "README.md" appears as a literal.

**Timing.** Measured on Node 26.10.0 with 16 CPUs. The machine was under heavy parallel load: load
average 142 at the start, rising above 260. These numbers are an upper bound, not a benchmark.

| Measurement | Result |
|---|---|
| `certify.mjs sweeps` | 74 s, 25/25 |
| `certify.mjs functional` | 672 s, 1,227/1,227 |
| Index export, `checkout-index -a` into `$TMPDIR` | 0.45 s for 968 files, 17 MB |
| Shared clone, plus index copy, plus `checkout-index -a -f` (D2's choice) | 0.755 s |
| The functional half run from a bare `checkout-index` export with no `.git` | exit 1 after 539 s. 1,188 of 1,192 passed and 4 failed; 35 of the 1,227 tests never ran. Every failure is `fatal: not a git repository`. |

The lesson's own figures, taken under the 0.50.0 load: a failed functional certify took 418 s, and a
re-certify took 173 s.

**commit-msg probe (git 2.55.0, `commit-msg-probe.log`).**

- The commit-msg hook receives the index the commit is made from in all four forms:
  - a plain commit: `.git/index`, relative;
  - `-a`: `<abs>/.git/index.lock`;
  - `<path>`: `<abs>/.git/next-index-<pid>.lock`;
  - a linked worktree: `<common>/worktrees/<name>/index`.
- `git diff --cached` under that hook lists exactly the staged set of each form. For example, the
  `<path>` form listed only the named path while another path was staged.
- The message file carries the trailer.

## Decisions

### D1. The record is a directory of content-named manifests, created, whose content is never rewritten (design question 1)

**Layout.**

- The record is a DIRECTORY, `$(git rev-parse --git-common-dir)/pm-suite-certification.d/`, with one
  sub-directory per bucket (`functional/`, `sweeps/`).
- Each passing run writes one file there, `<key>.json`:

  ```json
  {"version": 2, "bucket": "functional", "manifest": {"<path>": "<mode> <blob id>", ...},
   "result": "pass", "counts": {...}, "ranAt": "...", "engineSha": "...", "worktree": "<git-dir>"}
  ```

- `<key>` is the sha256 of the manifest, serialized as `path NUL mode SP blob-id NUL` over the
  sorted paths. Mode and blob id are what `git ls-files -s` reports, so a chmod-only change is a
  different manifest.
- `worktree` is informational, like `engineSha`. Nothing gates on it.
- `ranAt` is set when the entry is WRITTEN, not when the run started, and is REFRESHED when a later run
  certifies the same content (Gate 2 re-review F3), so the pruner (below) never ranks a just-finished
  run as the oldest, whether it created its entry or found it already recorded.

**Writing.**

- The file is written under a unique temp name (`<key>.<pid>.<random>.tmp`) and then LINKED to
  `<key>.json` (a rename until Gate 2 m1: a rename replaces an existing file, and the spec says an entry
  is created, and an entry's content is never rewritten; only `ranAt` is refreshed, atomically). The temp
  name is then removed.
- No run reads another run's file in order to write its own, so two concurrent runs cannot lose an
  update. This is the defect in today's read-modify-rename (`certification.mjs:361-367`).
- Two runs over IDENTICAL content produce the same key. The second link fails with `EEXIST` and the
  first entry's CONTENT is kept: every field as the first run wrote it, except `ranAt`, which the second
  run refreshes by writing the existing entry with its own `ranAt` to a temp name and renaming it over
  (Gate 2 re-review F3). The rename is atomic, so a reader sees one whole entry or the other, and two
  concurrent refreshes differ only in `ranAt`. A file under the key that cannot be parsed is no entry
  (a writer killed mid-write through the no-link fallback leaves one; Gate 2 final W1): the run replaces
  it with its own entry the same atomic way, and certify prints "recorded".
  certify then prints "already recorded", never "recorded".
- Why refresh rather than keep the first file and rank by something else: the pruner ranks by `ranAt`,
  the one ordering the record carries and its tests inject; a file mtime would rank every entry the
  tests write in one instant as equal. Keeping the first bytes whole would evict an entry just
  re-certified as the oldest, which then demands a re-run it already had.
- A filesystem without hard links (`linkSync` failing with ENOTSUP, EPERM or EXDEV; Gate 2 re-review F2)
  falls back to an EXCLUSIVE create of `<key>.json` (`open(file, 'wx')`). EEXIST still keeps the first
  entry. What the fallback gives up is the whole-file view: a reader can see the entry mid-write, and
  reads it as corrupt, never as a pass. A failed write through it removes the file it created.

**Content identity is the mode and git blob id.** Drift reads them with `git ls-files -s`
(`ls-files` is already permitted), and certify reads them from its copy of the index. Both, and the
fixture helper of D7, get the subject and its manifest from ONE function drift exports,
`indexManifest(root, bucket, { indexFile })` (Gate 1 round 4, T2): it derives the bucket's subject
over the index at `indexFile` (the inherited index when omitted), intersects it with that index's
paths, and reads modes and blob ids with `ls-files -s` under the same `GIT_INDEX_FILE`. It returns
`{ subject, manifest, key }`. No other code parses `ls-files -s` for a manifest. This replaces
sha256-over-bytes. It is cheaper, because there is no `show :path` per file, and it is exactly the
identity the commit will record.

**Freshness** (Gate 1 B1 and B2: the WHOLE subject, and deletions).

1. Let D be the staged paths, `diff --cached --name-only --no-renames`. It lists additions,
   modifications (content or mode) and deletions.
2. The bucket is DEMANDED when some path in D is in subject(index), or, for a path in D that the
   index no longer holds, in subject(HEAD) (the spec's "A staged change"; one definition, used here,
   in Latency below and in `measure.mjs`). subject(HEAD) is the same derivation over HEAD's tree
   (`ls-tree -r -z HEAD` for the listing, `show HEAD:<path>` for bytes), and it is empty when there
   is no HEAD. It is what catches a staged deletion: the index no longer holds the path, so
   subject(index) cannot name it. A path the index still holds is judged by subject(index) alone.
3. If the bucket is demanded, compute M, the manifest of subject(index) from `ls-files -s`, and its
   key K. M holds only the subject paths the index holds (subject ∩ index paths): a derivation may
   name a path the index lacks (`engineSourceFiles()` always names `scripts/conductor.mjs`, which a
   hook fixture writes and never tracks), and such a path has no mode or blob to record. A staged
   deletion is still demanded, through subject(HEAD) in step 2. The commit is fresh when `<bucket>/<K>.json` exists, has `result: "pass"`, and its manifest
   equals M exactly: the same path set, and the same mode and blob per path.
4. Otherwise the refusal names the staged subject paths and the run.

**Why the whole subject, not the staged paths.** A run's pass depends on every file in its subject,
staged or not. An earlier draft accepted an entry that agreed on the staged paths only, and that let
a split commit be judged fresh against a run that had held the OTHER file's new content, which the
split commit does not contain. So each commit's index must equal a run's, whole. The cost is that a
certified change split across commits needs a run per commit.

**The sweeps keep today's whole-engine hashing.** Today one staged engine file makes drift hash
EVERY engine-source file (`certifiedSet()`'s `ENGINE_SOURCE` entry, `certification.mjs:211-216`, set at `:214`;
drift's `hashStaged`, `drift.mjs:159-170`). Under B1 the sweeps manifest is the whole sweeps subject
by the same rule, so nothing is weakened: the sweeps subject is that engine source plus every
tracked `scripts/test/sweeps/*.mjs` and `scripts/test/js-lexer.mjs`. Today's rule is that entry
alone: it covers `engineSourceFiles()` (the entry point and every `scripts/lib/*.mjs`) and NO file
under `scripts/test/sweeps/`, neither the sweep's tests nor its method (`output-interpolations.mjs`),
so either can change with no sweeps run; widening it closes that #229-shaped gap for the sweeps bucket.

Because freshness is equality of the whole manifest, it is a LOOKUP by key: drift computes K and
opens one file. It never scans the directory, and no entry can combine with another.

**Why content-keyed and not per worktree (`--git-dir`).**

- **Unnecessary for isolation.** Per-worktree records would isolate worktrees, but the content key
  isolates them already. An entry agrees with an index only when its manifest EQUALS that index's
  whole subject manifest, so two different subject contents cannot both agree with one index. This
  is true by construction under B1's whole-subject rule; under the draft's staged-paths rule it was
  not.
- **What per-worktree costs.** It also costs sharing. Two worktrees holding the same content could
  not reuse one run, and a record whose worktree was removed would be orphaned under `worktrees/`.
- **A leftover race.** Per-worktree keeps the read-modify-write race for two shells in one worktree.
- **"Both" adds nothing.** The content key already gives what the worktree key would.

**A covered id that does not exist in this tree** (the second failure mode of #226).

- **The covers list goes.** `covers` and `conformanceRows` stop being separate data. The manifest
  holds the test files that ran, so it IS the covers, and it cannot name a test the run did not have.
- **Foreign entries do not apply.** An entry whose manifest names a test absent here does not agree
  with this index on that path. So it does not apply, and it is ignored, not refused.
- **7.2's cases become freshness demands.**
  - A deleted functional test is a staged deletion of a path in subject(HEAD) (Freshness, step 2).
  - A renamed module is a delete plus an add.
  - A removed conformance row is an edit to `functional/conformance.test.mjs`.

  Each has no agreeing entry until a run over the new tree exists.
- **What retires.**
  - `dangling-entry`, `dangling-covers`, `coversFor()`, `conformanceRows()` and `CONFORMANCE_ID`'s
    role;
  - the per-module `KIND_MODULE` entries;
  - the empty-covers writer refusal.

  The refusal of an empty run survives, as `countRefusal()` (`certify.mjs:92-98`). A new check
  refuses to write a manifest holding no test file of its bucket.

**Pruning** (the inverse of writing). Certify prunes each bucket's directory to its newest 50
entries by `ranAt` after it writes its own. It also removes (Gate 1 M6):

- orphan `*.tmp` files in the bucket directories older than 1 hour, which a writer killed between
  its write and its link leaves behind (a live writer holds its temp name for milliseconds);
- stale run directories, `pm-certify-run.*` under the temp directory, older than 24 hours, which a
  SIGKILL'd certify leaves behind (a functional run takes minutes, 672 s at worst in the Baseline);
- entries that cannot be parsed, older than 1 hour, which a writer killed mid-write leaves (Gate 2
  final W1; a live writer without links fills its file in place for milliseconds). The drift script's
  reader refuses such a file by name, naming the certify that replaces it.

- A pruned entry can only turn a would-be pass into a demand, which is the loud direction.
- Pruning never removes the entry the run just wrote.
- A reader that lists an entry which a concurrent pruner then removes treats it as absent, never as
  an error: an entry that vanishes mid-read can only turn a pass into a demand.
- 50 covers several days of parallel work: 0.50.0 had 70 demanding commits in the whole release.

### D2. Certify runs over a copy of the index, in a shared clone (design question 2)

**The sequence.**

1. Resolve the index. Use `$GIT_INDEX_FILE` if it is set, else
   `git rev-parse --path-format=absolute --git-path index`, which gives the per-worktree index in a
   linked worktree.
2. Copy it to a temp file. Everything after this reads the COPY, so the manifest and the exported
   bytes come from one moment. An edit or a `git add` during a multi-minute run changes neither.
3. Read the manifest: `GIT_INDEX_FILE=<copy> git ls-files -s`.
4. Build the run directory: `git clone --shared --no-checkout -q <common dir> <tmp>/tree`. Then
   `git -C <tmp>/tree update-ref --no-deref HEAD <this worktree's HEAD>`. Then copy the index copy
   in as `<tmp>/tree/.git/index`, and run `git -C <tmp>/tree checkout-index -a -f`.
5. Run the bucket with `cwd` set to `<tmp>/tree`, then remove `<tmp>` on exit and on
   INT/TERM/HUP, as the hook does (`pre-commit:45-61`).

**Why a shared clone, not the hook's bare `checkout-index` export.** The functional half, unlike the
assertion half, contains tests that need a repository around the content:

- `functional/gate-artifact-evidence.test.mjs:33-34` runs `git rev-parse HEAD` and `HEAD~1` in
  `engineRoot()`;
- `functional/conductor-37.test.mjs:281` runs `git show <ref>:skills/conductor/SKILL.md` against
  REPO.

A bare export under `$TMPDIR` has no `.git`. Measured, it failed four files:

- `conductor-15` and `gate-artifact-evidence` died as whole files;
- `conductor-13` failed test "16.3" on `git rev-parse --short HEAD`;
- `conductor-37` failed its 0.31.0 history read.

Only 1,192 of 1,227 tests reported at all (`functional-in-snapshot.out`).

A `clone --shared` has a real `.git`, a real HEAD and the whole object store through `alternates`.
Measured: the same four files, run in a shared clone built exactly as step 4 describes, passed
183/183 in 128 s at a load average above 140 (`shared-clone-four-files.out`). `git worktree list`
was unchanged afterwards.

- **Cost.** It copies no objects: measured at 0.755 s under load, including the checkout.
- **What it leaves alone.** It registers no worktree, touches no stash, and writes nothing in the
  user's repository. `git worktree list` was unchanged after the measurement.
- **HEAD.** It is set explicitly, because `clone` would otherwise check out the common repository's
  default HEAD rather than this worktree's.

**Alternatives rejected.**

- **A temporary `git worktree add --detach`.** It registers a worktree in the shared common dir. An
  orphan left by a SIGKILL crashes every Claude Code instance on the machine, per the user's global
  rules, and it needs a trap AND a prune on every path.
- **Exporting `GIT_DIR`/`GIT_WORK_TREE` into the run.** It points every test's child git at the
  user's repository. That is the leak the hook's env scrub exists to stop (`pre-commit:16-21`).
- **Rewriting the tests that assume an enclosing repository.** Possible. But it makes this change
  depend on editing an unbounded set of functional tests, and the clone makes the bucket pass as it
  does in a checkout.

**The runner's own code is the index's, or it does not run (Gate 2 follow-up S2).** certify computes the
manifest key with the copies of `certify.mjs`, `certification.mjs`, `drift.mjs`, `js-lexer.mjs` and
`fixtures/observe-reads.mjs` it imported, from the working tree, while the commit's drift runs the index's.
So before step 2 it fails closed: when any of them differs between the working tree and the index, it
refuses, naming the file, and tells the user to stage or stash the edit. Nothing is built or written.

**The known limit.** The clone's HEAD is the worktree's HEAD. A test that compares HEAD with the
working content therefore sees staged-but-uncommitted content as uncommitted, just as it does in a
checkout.

**Partial staging.** A partially staged file is exported as its staged half, and its blob id in the
manifest is the staged blob's. Untracked files are absent from the export and from the manifest.

**Latency.** The run adds one index copy, one shared clone and one `checkout-index`, together under
a second (Baseline), to a bucket that takes minutes.

The drift script's freshness read does NOT get cheaper when a subject path is staged. Deriving the
functional subject reads the bytes of every closure file, about 132 `git show :path` per derivation
at c96240ab (Baseline), where today's check 4 reads at most the 65 engine-source files. The manifest
itself is one `ls-files -s` and one keyed file open. drift derives subject(HEAD) only when D holds a
path the index no longer holds (step 2), so an ordinary commit pays for one derivation, not two.

**The skip.** When no path in D lies under a subject ROOT (`scripts/`, `.githooks/`, `hooks/`,
`commands/`, `skills/`, `agents/`, `.claude-plugin/`, or the three root files `README.md`,
`CLAUDE.md`, `docs/parity-ledger.json`), drift skips both derivations and demands nothing. This is
sound: every rule in D3 and the sweeps subject only ever ADMIT paths under those roots, so neither
subject(index) nor subject(HEAD) can hold a path outside them, and the demand in step 2 is false
without deriving. The root list is one constant that the derivation also filters on, so the two
cannot diverge. A docs-only or record-only commit (`openspec/`, `.conductor/`, `CHANGELOG.md`) pays
for no derivation at all.

### D3. The functional subject is derived from what the half observes (design question 3; #229)

**The definition.** The subject is:

- the import closure (static `from`, `export … from`, bare side-effect `import "…"`, and literal
  dynamic `import("…")` specifiers, relative only) of every `scripts/test/functional/*.test.mjs` and
  of `scripts/conductor.mjs`;
- the functional test files themselves;
- every assertion-half test file the functional half EXECUTES (Gate 1 round 2, C1, option (a)): one
  whose path, `assert/<name>.test.mjs` or `unit/<name>.test.mjs` (optionally prefixed
  `scripts/test/`), a closure file under `scripts/test/` spells, in its CODE, as a single- or
  double-quoted string. Comments are stripped first, by the same regex-aware lexer the static
  `NODE_OPTIONS` guard uses (below; Gate 1 round 3, R4; round 4, T1). It is a closure ROOT, so its own imports
  are in the subject too. Today these are
  `assert/parity.test.mjs` and `assert/engine-resolution.test.mjs`, which
  `functional/temp-dir-cleanup.test.mjs:64-65` lists in `SITE_RUNS` and `nestedRun()` (`:79-88`)
  runs as a nested `node --test` child. A change to either can change that functional result, and
  the observer would record them, so leaving them out would make the observer refuse today's tree.
  A twin named only in a comment (`functional/drift-script.test.mjs:4`, `git-shim.test.mjs:12` and
  the rest) is not matched, whether the comment quotes it or not;
- every tracked file under `scripts/`, `.githooks/` or `hooks/` whose file name a closure file under
  `scripts/test/` spells as a string literal, or as the last `/`-separated segment of one. This is the `coversFor()` basename
  precedent (`certification.mjs:252-272`), moved to where it is sound;
- every tracked file under `commands/`, `skills/`, `agents/`, `hooks/` or `.claude-plugin/` when a
  closure file under `scripts/test/` spells that root as a path segment, and `README.md`, `CLAUDE.md`
  and `docs/parity-ledger.json` when one spells the name.

**Why the shipped surface is in.** The functional half reads it: `conductor-13:265`, `conductor-36:407`
and `conductor-15:412-413` read `commands/*.md` and `README.md` from REPO; `parity:159` reads
`docs/parity-ledger.json`; and `fixtures/parity-helpers.mjs:13` (`PARITY_ROOTS`) walks all five
shipped roots, `hooks/` among them, so `hooks/` is a root of this rule as well as a scope of the
named-literal rule. Leaving them out would make a command-doc edit that a functional test pins #229
again. A first draft of this design scoped the named-literal rule to `scripts/`, `.githooks/` and
`hooks/` only (60 of 126); a review found these reads, and the subject was widened before any code.

**Reads by a built path (Gate 1 round 3, R1).** The named-literal rule sees a file only when its name
is spelled. A read through a path assembled at run time is invisible to it, and the observer would
refuse it. Detected mechanically at 59461425: every tracked path under a subject root that is
outside the derived subject (14 files) was searched for by name and by name fragment in
`scripts/test/{functional,fixtures}/` and the engine, and every `readdirSync` and every `path.join`
or `path.resolve` over a repository-rooted base with a non-literal argument there was read. Result:
- **One built-path read of a tracked, out-of-subject file:** `functional/conductor-14.test.mjs:229`
  reads `rules-0.26.0-${name}.txt`, reaching `fixtures/rules-0.26.0-github-scoped.txt` and
  `fixtures/rules-0.26.0-github-scopeless.txt` (`:279`, `:320`, `:381`, `:429`, `:445`), which no
  closure file names. The third, `rules-0.26.0-jira-scoped.txt`, is in only because
  `conductor-15.test.mjs:63` spells it. DECIDED: `conductor-14` spells all three names as literals
  (task 3.2), which puts the two in the subject by the existing rule.
- **Built paths whose targets are already in the subject:** directory walks of `scripts/lib/`
  (`conductor-13`, `conductor-31:199`, `git-gateway-guard:52`, `tool-currency:306`,
  `output-text-integrity:636,793`, `emitted-invocations:2814`, `sweeps/output-interpolations.mjs:73`),
  of `scripts/test/functional/` (`hermetic-git:59`), of the shipped roots
  (`emitted-invocations:57,64`, `conductor-37:93`, `parity-helpers:49`), and the executed assertion
  files (`temp-dir-cleanup:123`).
- **Built-path reads of the record, excluded by rule:** `conductor-15:1335,1431,1436`
  (`openspec/changes/archive/`).
- Every other `path.join` with a non-literal argument in those directories is rooted in a fixture
  repository or a temp directory, not in REPO.

**Why the repository's record is out.** Putting it in the subject would demand the functional half on
almost every commit. `openspec/`, `.conductor/` and the rest of `docs/` are edited by nearly every
change; `conductor-15:1335-1436` reads `openspec/changes/archive/`, which is history rather than the
code the half verifies, and `conductor-15.test.mjs:806` and `conductor-18.test.mjs:21` (`liveState()`)
read the repository's live `.conductor/state.json` to run `runIntegrity()` over the real record,
which changes on nearly every commit. `CHANGELOG.md` is different, and the exclusion is a trade, not a claim that
the half does not observe it: `conductor-37.test.mjs:87,255-256` checks it as shipped markdown, and
the engine reads the plugin root's `CHANGELOG.md` at run time (`plugin-meta.mjs:33`), which
`conductor-31.test.mjs:90` drives with `changelog --since 0.0.1`. It is still excluded because it
changes mostly in the release commit (one of 126 in 0.50.0, `2c8f0a29`), which also bumps
`.claude-plugin/plugin.json` and so demands the functional half through the subject anyway. It is
not only there: `9f52b475` repaired two CHANGELOG lines after the release (it also staged
`CLAUDE.md`, which is in the subject, so that one demanded the half too); the
release checklist runs the functional bucket at step 1; and the structural check also runs on every
commit in `assert/conductor-37.test.mjs:27,120`. A CHANGELOG-only fix outside a release is the gap,
and CI, which runs every bucket on every push, is what catches it. The spec and the observer's limits
state the exclusion.

Every other file under `scripts/test/{assert,unit}/` is excluded. The subject is derived from the
INDEX by the same `indexReaders()` drift already uses.

**Why not "any engine module".** It measured 51 against 70 and misses what the half RUNS or READS without
importing:

- `.githooks/pre-commit` (functional `conductor-09`);
- `hooks/hooks.json` (`verb-surface`, `commit-observation`);
- `scripts/test/drift.mjs` (`drift-script`, and `conductor-09` IX-k);
- the fixtures.

A change to the pre-commit hook would demand nothing, which is #229 again one directory over.

**Why not a declared map.** A declared observation map is a list maintained by hand. The first
requirement of `suite-certification` forbids exactly that for the trigger, and the map is also the
rejected operation-level map (Non-Goals).

**Correctness against frequency.**

- **The price.** The chosen subject demands the functional half on 70 of 126 commits, 4.7 times
  today's 15.
- **What the extra demands are.** 36 of the 55 extra demands are engine commits that reach the
  functional half today only in CI or at the next certify. b4ffe164 is one of them. The rest are
  changes to functional files, fixtures or the hook.
- **Why it is affordable.** The run is minutes. Under D1 it can run in every worktree at once with
  no lock, and it is required only where the commit changes something the half observes. CI runs
  it regardless, so the local demand decides only whether a break is caught before the commit or
  after the push.

**The guard (ADDED requirement "The functional subject's derivation is checked against what a run
observes").**

- **The observer.** Certify functional runs the half with
  `NODE_OPTIONS=--import <observer>`, so every Node process the half starts inherits it. The
  observer records every path under the run directory that is resolved as a module, read through
  `fs`, or passed to `child_process` as a script. Each process writes its observations to its OWN
  file, `<run>/observe/<pid>.<random>.json`, never to a shared one, so the observer does not rebuild
  #226's shared-file race inside the run.
- **Which observer loads (m9).** `NODE_OPTIONS` names the RUN DIRECTORY's copy,
  `<run>/tree/scripts/test/fixtures/observe-reads.mjs`, exported from the index copy like every other
  file, so the observer that runs is the staged one. It excludes its own path from the report: its
  own load is not a read by the half.
- **The observer must survive into every child (Gate 1 B4).** `functional/conformance.test.mjs:210`
  sets `NODE_OPTIONS` for a child to `--require …inject-state-conflict.cjs`, and its `asProcess`
  spreads that over `process.env` (`:146-152`), so the child loses the observer. Two mechanisms:
  - **Run-time detection, for DIRECT Node children.** The observer patches `node:child_process`
    (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `fork`, and then
    `module.syncBuiltinESMExports()`, so a test's named ESM import sees the patch; `--import` runs
    before the test module). When the command is `process.execPath` or `node`, it writes a unique
    `PM_OBSERVE_TOKEN` into the child's environment, whatever environment the test passed, and
    records the token as EXPECTED with the test file and argv. The child's observer, if it loads,
    records the token as ARRIVED, SYNCHRONOUSLY at load (`fs.writeFileSync` of its own file before
    any test code runs), so a child that calls `process.exit()` at once has still arrived (m1). An
    expectation is CANCELLED when the spawn itself failed, which the patch sees as the child's
    `error` event or a `spawnSync` result carrying `r.error`: a child that never started cannot
    report. After the run, certify fails closed on any live expected token that never arrived,
    naming the test file and argv, and writes no entry. Measured on Node 26.10.0:
    `--import` runs for `-e`, `-p`, `--input-type=module -e` and `--check`, and does NOT run for
    `--version`. So an argv of only `--version`, `-v`, `--help`, `-h` or `--v8-options` expects no
    arrival. The functional half starts `node -e ""` today
    (`functional/state-file-refuses-to-guess.test.mjs:532,779`), which does load the observer.
  - **A static guard, for INDIRECT Node children.** A Node process that git or a shell starts
    cannot be matched to a token, because the half spawned `git` or `sh`, not Node. For those,
    certify functional refuses, before the bucket runs and over the exported index copy, any file
    under `scripts/test/{functional,fixtures}/` whose CODE assigns a `NODE_OPTIONS` value which does
    not carry `process.env.NODE_OPTIONS`. It matches CODE assignments only (I3).
    - **The tokenizer (round 4, T1): the sweep's regex-aware lexer, shared, and failing closed.**
      The round-3 tokenizer had no regex-literal state. Measured at c96240ab by a scan that flags a
      non-template string spanning an unescaped newline, it lost string/comment parity in 13
      tracked files under `scripts/test/{functional,fixtures}/` (for example
      `functional/conformance.test.mjs:470`, where `/process\.on\(\s*["'`]exit["'`]/` opens a
      string at its `"`, `functional/output-text-integrity.test.mjs:185`, where the backtick in
      `/md\.push\(\s*(["'`])\|/g` opens a template, `functional/archive-gate-order.test.mjs:142` and
      `fixtures/spawn-derivation.mjs:50`). So the round-3 claim that the whole-tree case "pins that
      today's tree is read as intended" was false: text after each of those lines was read in the
      wrong state. Two decisions replace it:
      - **(a) One lexer, already in the tree.** `lex()` and `KEYWORDS_BEFORE_REGEX`
        (`scripts/test/sweeps/output-interpolations.mjs:78-146`) already recognise regex literals:
        a `/` is division after a number, string, template, regex, identifier not in
        `KEYWORDS_BEFORE_REGEX`, or `)`/`]`/`}`, and a regex literal (with its `[…]` classes)
        everywhere else. Task 3.1 MOVES both into a new shared module, `scripts/test/js-lexer.mjs`,
        which `output-interpolations.mjs` and `certification.mjs` both import. The move is additive
        for the sweep: `lex()` also returns the comment ranges it skipped and a `misparse` list, and
        the sweep ignores both, so its classifications are unchanged. The call sites that move are
        the definition (`output-interpolations.mjs:79-80`, replaced by the import) and its twelve
        uses (`:296`, `:315`, `:316`, `:348`, `:372`, `:423`, `:450`, `:456`, `:464`, `:499`, `:520`,
        `:550`), which keep their text; the new importers are `certification.mjs`'s comment stripper
        (the executed-file match, R4) and `nodeOptionsRefusals()`.
      - **(b) Fail closed.** `lex()` records a misparse when a quoted (non-template) string or a
        regex literal meets an unescaped newline, when a `/*` comment is unterminated, or when the
        input ends inside a string, template, `${…}` or regex. `certification.mjs`'s two callers
        THROW on any misparse, naming the file and line; certify fails and writes no entry. This
        covers only a misread that crosses a newline or reaches the end of input — it is not "never
        answer from a misread". **The limit (round 5):** `lex()` reads a `/` after `)` or `}` as
        division, so a regex literal in STATEMENT position after one (`if (ok) /re/.test(s)`, or a
        statement opening with a regex after a block's `}`) is misread, and when the misread closes on
        its own line nothing is recorded: a regex holding `//` (read as a line comment), a matched
        pair of quotes, or backticks that pair up across two such regexes. Probed with the round-4
        lexer (`gate1-re5/correctness/adv.mjs`, `adv2.mjs`): `if (ok) /[//]/.test(s); run("…");`
        hides the string with misparse 0, and two `if (a) /`/.test(s)` lines hide a `NODE_OPTIONS`
        object key between them with misparse 0. For the subject derivation the run-time observer
        (3.2) is the backstop for a path hidden this way; for the static guard there is none, so it
        is the guard's fourth stated limit (spec, "It has five stated limits"). None of the 0-of-138
        measurement below contradicts it: that measures misparses, and this misread records none.
      - **Measured under this design** (a scratch copy of `lex()` with (b) added, run over the
        tracked `.mjs`/`.cjs`/`.js` files at c96240ab): 0 misparsed of 70 files under
        `scripts/test/{functional,fixtures,sweeps}/`, and 0 of 138 with the engine and
        `scripts/test/{certify,certification,drift}.mjs` added. `measure.mjs` carries the same lexer
        (it measures commits that predate the shared module) and threw on none of the closure files
        of the 126 measured trees; its output is byte-identical to `measure-0.50.0.json`.

      The same lexer strips comments for the executed-file match (R4), which keeps string and
      regex text and drops only comments.
    - **A string in KEY or SUBSCRIPT position is code.** A string token followed, after
      whitespace, by `:` (an object key), or standing alone inside `[`…`]` that is followed by `=`
      (a subscript assigned to), is kept as code for the match. Every other string's text is
      skipped.
    - **Two syntactic shapes are matched, and nothing else.** An OBJECT KEY, bare or quoted
      (`NODE_OPTIONS:`, `"NODE_OPTIONS":`, `'NODE_OPTIONS':`); a key overriding a spread,
      `{ ...process.env, NODE_OPTIONS: … }`, is this shape. A PROPERTY ASSIGNMENT, dotted or
      subscripted with a bare or quoted name (`env.NODE_OPTIONS =`, `env["NODE_OPTIONS"] =`,
      `env['NODE_OPTIONS'] =`), never `==` or `===`.
    - The value is the text up to the end of that property or statement. So
    `fixtures/future-clock.mjs:6`, a comment showing `NODE_OPTIONS="--import …"`, is not refused,
    and over today's tree the guard flags exactly `functional/conformance.test.mjs:210`. The check
    is a pure function with a unit test.
  - **The exact residual limits.** A Node process started indirectly whose `NODE_OPTIONS` is
    replaced by a value assembled at run time (not a literal the static guard can read) is neither
    detected nor refused. Nor is one whose environment OMITS `NODE_OPTIONS`: an `env` built without
    spreading `process.env` (`{ PATH: … }` handed to git), or one the variable was `delete`d from.
    The child loads no observer, and there is no assignment for the guard to refuse. The spec
    states both.
  - **The fix to the one case today.** `conformance.test.mjs:210` appends:
    `${process.env.NODE_OPTIONS ?? ""} --require …`. It edits a functional file at L3, before L4
    brings the trailer, so it carries its twin edit.
- **The check.** Certify then refuses if any observed path that is tracked in the index copy lies
  outside the derived subject. It names the path, and writes no entry.
- **The observation file, and the torn-tail rule (Gate 2 G2 and its re-review F1).** Each process
  appends one JSON line per event to `<pid>.<random>.jsonl` (its header, arrival, expectations,
  cancellations, each NEW read, and `exit` from its exit listener), each written synchronously
  BEFORE the operation it observes, so a kill tears at most the last line. A failed write (ENOSPC,
  EFBIG) tears it too and loses everything after it, and swallowing it failed open (reproduced: 305
  reads, 129 recorded, nothing refused). So at load, after opening its file, the process creates a
  sentinel `<pid>.<random>.ok`, and on its FIRST failed write it removes the sentinel and writes
  nothing more (a removal needs no free space; a failure marker would). `readObservations()` then
  refuses, naming the file: a `.jsonl` without its `.ok`; a `.ok` without its `.jsonl`; a torn
  last line after an `exit` event; any other corrupt line. It drops a torn last line ONLY when the
  `.ok` is present and there is no `exit` event, the process having ended without its exit
  listener, which is a kill. Why the missing `exit` and not the parent: only a DIRECT Node child has
  a parent-side token, while a test file or a process git or a shell starts has none, so a missing
  `exit` is the one kill signal every process carries. A process that cannot open its file while the
  observation directory exists throws at load, as a missing `registerHooks` does; a directory
  already gone means the run is over, and it reports nothing. The residual limit, stated in the
  spec: a failed write whose sentinel removal also fails reads as a kill.
- **Armed only after a report-only pass over the real tree (C1).** Before the refusal is armed (task
  3.2's GREEN), the observer is run REPORT-ONLY over this repository's own functional half, and the
  out-of-subject paths it records are written to `observer-report-3.2.txt`. It runs AFTER task
  3.2's two tree edits, the `conformance.test.mjs:210` append (without which that child reports
  nothing) and `conductor-14`'s literal fixture names (R1). The expected list is therefore NOT
  empty: it holds the record reads the rule excludes, each marked "excluded by rule" (at least
  `openspec/changes/archive/` from `conductor-15:1335-1436`, `.conductor/state.json` from
  `conductor-15:806` and `conductor-18:21`, and `CHANGELOG.md` from `conductor-37:256` and from the
  engine, `plugin-meta.mjs:33`). A static search found no read of
  any other tracked file outside the subject roots and the record (`.claude/`, `.github/`,
  `.changesets/`, `evals/`, `img/`, `PROJECT.md`, `.gitignore`, `CONTRIBUTING.md`, `LICENSE`,
  `SECURITY.md`): every engine read of such a path under `engineRoot()` that the half drives is
  rooted in a fixture. But the root list is CLOSED, so such a path, if the run shows one, cannot be
  admitted by any `functionalSubject()` fix; it is a finding for the orchestrator, not a literal
  edit. Run before the
  `conductor-14` edit, it would also list `fixtures/rules-0.26.0-github-scoped.txt` and
  `-scopeless.txt`. Any other path on it is a derivation gap to fix in `functionalSubject()`, and is
  named there before the refusal lands.
- **Why here.** This catches a path assembled at run time, which no source scan can see. It runs at
  certify time, never per commit.
- **Its limit.** A file read by a non-Node process on its own, for example a shell script reading a
  file, is not observed; nor is an indirect Node child whose `NODE_OPTIONS` is replaced by a value
  assembled at run time, or whose environment omits `NODE_OPTIONS` altogether. The spec states all
  three.

**The false positive.** `hooks/README.md` enters the subject by its common name. It over-demands,
which is the loud direction. The derivation does not special-case it.

**The comment at `scripts/lib/store.mjs:624-631`** exists only because the `gitOps(` scan counted
comments. Retiring the scan makes it stale, so it is rewritten in the same commit (task 3.4).

### D4. Coupling takes a declared trailer, checked in the commit-msg hook (design question 4; #227)

**Why a trailer, and why commit-msg.** The pre-commit hook runs before the message exists, so a
message trailer can only be read by `commit-msg`.

- **The move.** Check 3 moves there: `.githooks/commit-msg` runs
  `node <snapshot>/scripts/test/drift.mjs --root <root> --phase commit-msg --message <file>` with the
  captured `GIT_INDEX_FILE`, exactly as the pre-commit hook does.
- **The split.** The pre-commit run becomes `--phase pre-commit` and performs checks 1, 2 and 4.
  Check 3 therefore runs in exactly one place.
- **No `--phase` (Gate 1 M5).** A bare `node scripts/test/drift.mjs`, which `CLAUDE.md:31` tells a
  contributor to run, performs every check that can be judged from a working tree: checks 1, 2 and 4,
  and check 3 with the declarations of `--message <file>` when one is given, and with none
  otherwise. So a bare run never reports fewer refusals than the two hooks together.
- **Its own export.** The pre-commit snapshot is removed when that hook exits, so `commit-msg` makes
  its own `checkout-index` export to run the snapshot's drift, measured at 0.45 s (Baseline). It
  keeps the pre-commit hook's fallback exactly (`pre-commit:150-154`): the working tree's
  `drift.mjs` runs only when the index holds none, the hook-fixture shape (Gate 1 round 4).
- **Merges are not judged.** git runs `commit-msg`, not `pre-commit`, for a merge commit, and
  `MERGE_HEAD` is present while it runs (`commit-msg-probe.log`, merge probe 2). Drift finds it with
  `git rev-parse --git-path MERGE_HEAD` (Gate 1 M3), which names the per-worktree path in a linked
  worktree, where `.git` is a file and `.git/MERGE_HEAD` does not exist. A merge's staged set
  is everything the other parent brings in, and a `Twin-Unchanged` trailer on a merged-in commit is
  not on the merge's message, so judging it would refuse a change that already passed (merge probe 1:
  the merge's staged set held the exempted file and no trailer). So coupling skips when `MERGE_HEAD`
  exists. A squash commit has no `MERGE_HEAD` and is judged like any other.
- **The probe.** It verified that git 2.55 hands `commit-msg` the commit's own index in all four
  commit forms (Baseline).

**The declaration.**

- **Its form.** `Twin-Unchanged: <id> — <reason>`, one per id, as a git trailer.
- **Who parses it (Gate 1 B3, round 2 I2).** git does: drift runs
  `git interpret-trailers --parse --no-divider <message>`. `--no-divider` is required: without it,
  `interpret-trailers` treats a `---` line as the end of the message, and `%(trailers)` does not, so
  the two disagree in BOTH directions (`trailer-divider-probe.log`, git 2.55.0: a trailer after a
  `---` paragraph is found only with `--no-divider` and by `%(trailers)`; a trailer before a later
  `---` line is found by plain `--parse` and by neither of the others). `--no-divider` still stops at
  the scissors line (same log, m3). So the permitted subcommands grow by `interpret-trailers` at L4.
- **The value's split (round 2 I1).** The id is the value's first whitespace-delimited token. It
  must be followed by a SPACED separator, ` — `, ` -- ` or ` - `, and the reason is everything after
  it. Splitting at the first `-` anywhere would cut `conductor-09` into `conductor` and `09 — …`, and
  a reason may itself contain ` - `; the first-token rule reads both whole. A hand-written JavaScript parser would have to
  re-implement git's trailer-block rule, and any disagreement would let drift accept a declaration
  that Gate 2's `%(trailers:key=Twin-Unchanged)` then cannot see, or the reverse. Measured on git
  2.55.0 (`interpret-trailers --parse`, and `%(trailers:key=Twin-Unchanged,valueonly)` on a commit):
  - a subject-only message yields no trailer;
  - a `Twin-Unchanged:` line inside a paragraph that also holds prose yields none, from both;
  - a `commit -v` message yields the trailer above the scissors line and nothing after it. git runs
    `commit-msg` before it strips the scissors tail, so the hook sees that tail and relies on git's
    parser to stop there.
- **The message path.** git hands `commit-msg` a path relative to the top level
  (`.git/COMMIT_EDITMSG`, or the per-worktree git dir's in a linked worktree). The hook makes it
  absolute before it changes directory, exactly as `pre-commit:33-34` does for `GIT_INDEX_FILE`.
- **What is refused.** A declared id whose functional file is not staged: a stale or mistyped claim.
  An empty reason: nothing for Gate 2 to judge.
- **What passes.** A declared id passes check 3 without its twin, and the accepting run prints
  `drift: coupling exemption <id> — <reason>`.

**Who declares, and who audits.**

- **Who declares.** The committer, as they do today when they choose to add a comment to a twin.
- **The audit.**
  - **Gate 2 (required).** Gate 2 enumerates the trailers over its `BASE..HEAD` on `dev`
    (`git log --format='%H %(trailers:key=Twin-Unchanged)' BASE..HEAD`) and judges each: did the
    declared change leave the file's subject untouched?
  - **Squash is harmless to it.** Gate 2 runs on `dev` BEFORE any squash into `main`
    (`.claude/skills/pr-workflow/SKILL.md` step 6 records Gate 2 before the squash-merge). A squash
    that drops trailers loses nothing the audit needed, because the audit has already read them.
  - **It binds future epics (Gate 1 B8).** The audit is a NUMBERED step in the pr-workflow skill
    (task 6.6), not only this change's 8.1. The repository's `CLAUDE.md` "gate procedure" list was
    rejected as the home: it sits inside the pm-managed rules block (`CLAUDE.md:96` onwards),
    which the engine emits from `scripts/lib/rules.mjs:158,732`. A hand edit there is overwritten by
    the next `/pm:upgrade`, and changing `rules.mjs` would ship a pm-repository rule to every user of
    the plugin. The pr-workflow skill is repository-local, and every commit that reaches `main` goes
    through it.
  - **CI (not added).** A CI step listing trailers on the PR is optional and is not added here.

**Alternatives rejected.**

- **An allowlist of change shapes** (a `removeAtExit(` wrap, an import line). It is a moving target
  that has to be taught every new hygiene edit, and a shape-matcher is easy to satisfy by accident.
- **An environment variable.** It leaves no durable trace to audit.
- **Documenting the comment as the escape hatch.** That is the ceremony #227 is about.

**D3 does not replace coupling.** D3 already demands a functional RUN when a functional file
changes. That proves the file still passes, but not that the per-commit twin learned anything, so
coupling keeps its own purpose.

### D5. Migration from the single-file record (design question 5)

- **The new path.** The new format lives at a NEW path, `pm-suite-certification.d/`. The old
  `pm-suite-certification.json` is never parsed by the new drift script, and the old drift script
  never reads the directory.
- **Why no translation.** Its hashes are sha256-over-bytes of working-tree content with per-module
  keys, not blob-id manifests, and translating them would invent a claim no run made.
- **The formats coexist (Gate 1 B5).** Nothing in this change deletes the old file. A rollback, or a
  checkout of an older commit whose hook runs the old drift, finds the old record where it was left.
  At worst that record is stale, and a stale record demands a run, which is the loud direction.
- **Retirement is DEFERRED to a later release.** A later change removes the old file with an
  idempotent `rm -f`, on the precedent of the hook's permanent `pm-isolation-flag` cleanup
  (`pre-commit:161-168`), once no supported commit's hook can read it. It is registered as a planned
  epic and recorded as a `--deferral` on this epic's disposition (task 8.2).
- **A fresh clone,** or a clone upgraded mid-flight, has an empty directory or none. It demands a run
  only when it stages subject content, which is the same behaviour as today's missing file
  (`certification.mjs:327-341`).

### D6. Parallel worktrees need no certify lock (design question 6)

**`pm-certify.lock` becomes unnecessary.**

- **Overwrite.** D1 removes it: entries are named by content, and an entry's content is never rewritten;
  only `ranAt` is refreshed, atomically.
- **Foreign-covers blocking.** D1 removes it too: entries that do not agree with this index do not
  apply.
- **Certify-versus-commit windows.** D2 removes them: the manifest is the index copy's, not the
  working tree's.

**`pm-suite.lock` stays.** It limits how many assertion-half runs load the machine at once, and
correctness never depended on it.

**Certify takes no lock.** It would hold the hook's lock for minutes and block every worktree's
commit.

**CONTRIBUTING gains a "Parallel worktrees" section.**

- **What is safe.** Certify and commit freely in each worktree, with no lock.
- **Machine load.** Parallel certifies each start one process per test file, so an orchestrator
  should limit how many run at once.
- **Retire the hand-rolled lock.** Any hand-rolled `pm-certify.lock` should be deleted.

### D7. Landing order: the gate works at every commit (the guardrail)

**Why the order matters.** Each commit is judged by the `drift.mjs` it contains, because the hook
runs the snapshot's copy. A record written by certify must be readable by the drift script in the
same commit. So every step below lands as ONE commit, and every step either keeps the old reader or
arrives together with its own writer. Before each commit that changes a subject, the applier stages
the commit, then runs the STAGED certify (the working-tree `certify.mjs`, which equals the staged
copy) to write the entry that commit's drift will read.

| Step | Lands | Who writes the record | Who reads it | Why the gate still works |
|---|---|---|---|---|
| L1 | Certify over the index (D2): index copy, shared clone, run there. It still writes the OLD single file and per-module entries, now hashed from the index copy. | old format, index bytes | old drift, unchanged | The drift script is unchanged; only the bytes certify hashes change, toward what drift already reads. Fixes #230 alone. |
| L2 | The manifest record (D1) and D5. The INTERIM functional subject is a set of path classes both certify and drift derive from the same index: today's `certifiedModules()`, plus every tracked file under `scripts/test/functional/` and `scripts/test/fixtures/`, plus `scripts/test/certify.mjs`, `scripts/test/certification.mjs`, `scripts/test/drift.mjs` and `scripts/test/js-lexer.mjs` (which `certification.mjs` imports from 3.1 on; until 3.1 creates it the index holds no such path and the subject ∩ index rule drops it). The sweeps subject is `engineSourceFiles()` plus every tracked `scripts/test/sweeps/*.mjs` and `scripts/test/js-lexer.mjs`. The test files must be in the subject from L2 on, because L2 retires the dangling checks and a deleted functional test must already be a staged subject change. Drift gets whole-manifest freshness and `ls-tree` for HEAD; the dangling checks retire, and so does `certifiedSet()` with its `ENGINE_SOURCE` entry (R3), because drift stops using it once the interim subject lands. Hook-fixture tests that stage a subject path seed an agreeing entry (R2, below). Certify writes the new directory and leaves the old file. | new format | new drift, same commit | The commit is judged by its own new drift, reading the entry the applier's new certify wrote. The new drift ignores the old file; it stays for a rollback (D5). |
| L3 | The observed subject (D3) and the run-time observer. `certifiedModules()` retires; `store.mjs:624` is rewritten. | new format, wider subject | new drift | The commit stages `certification.mjs`, which the closure contains (`drift-script` imports it), so it demands a functional certify over itself. The applier runs it first. |
| L4 | `.githooks/commit-msg` plus `--phase`, and `interpret-trailers` in the permitted set: check 3 leaves the pre-commit run and enters commit-msg, in ONE commit. | — | pre-commit (snapshot drift, 1/2/4) and commit-msg (working-tree hook, snapshot drift, 3) | Coupling is never enforced in zero places or in two. The new hook file is present in the working tree when this commit's commit-msg phase runs. |
| L5 | Docs: CONTRIBUTING, the CLAUDE.md "Tests:" bullet, the lessons, the pr-workflow skill, `.changesets/`. | — | — | `CLAUDE.md` IS in D3's subject (a closure file spells its name, Baseline), so 6.2's commit demands a functional certify, run first. CONTRIBUTING, the lessons, the skill and the changeset are outside every subject. |

**Hook-fixture tests under the new gate (Gate 1 round 3, R2).** From L2 on, a fixture repository's
own pre-commit hook runs the new drift, and a fixture that stages a path in a bucket's subject is
refused for freshness unless its common dir holds an agreeing entry. So a fixture helper,
`seedAgreeingEntry(cwd, bucket, { indexFile })` in `fixtures/helpers.mjs`, writes one: it calls
drift's `indexManifest(cwd, bucket, { indexFile })` (D1, "Content identity"), the SAME function
drift's freshness check and certify call, and writes the `manifest` it returns with
`writeManifestEntry()`. It parses no `ls-files -s` output and derives no subject of its own. So the
seeded entry's key is the key drift computes for that index, for the same `drift.mjs` bytes: the
agreement holds by construction because there is one computation, not two that are kept equal. What
the construction does NOT cover is a DIFFERENT drift. The hook runs the fixture's copy of
`drift.mjs` (its snapshot's, or the working tree's when the index holds none, `pre-commit:150-154`),
and the helper imports the repository's; every hook fixture copies the repository's `drift.mjs` in
(`runHookAgainstFixture`), so the two are the same bytes except in a test that replaces a fixture
copy on purpose. There are two such cases. IX-k replaces the copy the hook runs and seeds nothing.
The other is 4.3's working-tree fallback RED, and it is safe for a stated reason: its fixture's
INDEX holds `drift.mjs`, so the hook runs the snapshot's copy (`pre-commit:153-155`), and only the
UNSTAGED working-tree copy is replaced (`process.exit(0)`), which no hook runs while the index holds
one. So the snapshot's `drift.mjs` must be able to load: the fixture must also TRACK what it imports,
`scripts/test/certification.mjs` and, from 3.1, `scripts/test/js-lexer.mjs`, or the snapshot copy
fails at import and the commit is refused for the wrong reason. Those tracked copies are the
repository's bytes, the same the helper imports, so the seed's key is the key the hook's drift
computes; and because all three are in the interim functional subject, the seed is taken over that
index with them in it, by the same `indexManifest()`. The RED's second arm (an index holding no
`drift.mjs`) runs the working-tree copy, which is the repository's unmodified bytes. `runHookAgainstFixture`
calls it after `setup` when given `seed: ["functional"|"sweeps", …]`. For a `commit -a` or
`commit <path>` case the seed is taken over an index built the way git builds that commit's
temporary index (a copy of the index updated with `add -u`, or `read-tree HEAD` plus `add <path>`),
because that, not `.git/index`, is the index the hook is handed. Found mechanically (`rg` for a
staged `scripts/test/{functional,sweeps,fixtures}/`, `scripts/lib/`, `scripts/conductor.mjs` or
`scripts/test/{certify,certification,drift}.mjs` path in `runHookAgainstFixture` calls and in
`fixtures/helpers.mjs`; `conductor-09` is the only file that calls it):
- **Expect acceptance, and would be refused from L2: seed them.** `conductor-09` G-I3
  (`:332-367`, stages `functional/marker.test.mjs`, expects `2/2 passing`) and 1.3 (`:490-518`,
  stages `sweeps/marker.test.mjs`, expects the empty-rung refusal from the suite step, which a drift
  ABORT would pre-empt). They move in task 2.4.
- **Expect a refusal and still get one.** IX-i (`:694-711`), IX-j (`:713-729`) and IX-k
  (`:731-748`) stage subject paths and assert a refusal naming the id or module. Drift renders
  every refusal in one ABORT (`drift.mjs:182-205`), so the named refusal is still printed beside the
  new freshness one. They need no seed; task 2.4 re-runs them to confirm. IX-j's refusal is
  itself a freshness refusal, and WHICH bucket makes it changes (Gate 1 round 4): its staged
  `scripts/lib/zz-probe.mjs` calls `gitOps(`, so from L2 it is in the interim functional subject
  (through `certifiedModules()`) AND in the sweeps subject (`engineSourceFiles()`), and both
  buckets demand; from L3 nothing imports it, so it leaves the functional subject and only the
  sweeps bucket demands. Tasks 2.4 and 3.3 each re-run IX-j asserting the bucket(s) named, and its
  title stops saying "uncertified module".
- **The shared lexer (L3, task 3.1).** The fixture copies `scripts/test/{drift,certification}.mjs`
  in (`fixtures/helpers.mjs:351-353`), and IX-k tracks the same two through `extraFiles`. Once
  `certification.mjs` imports `scripts/test/js-lexer.mjs`, a fixture without it cannot load drift
  at all, so the copy list and IX-k's `extraFiles` gain that file in 3.1's commit.
- **Must reach commit-msg (L4).** Every 4.3 and 4.4 case that stages a functional file, accepted or
  refused, must first pass pre-commit's freshness check, or commit-msg never runs; each seeds.
- `functional/drift-script.test.mjs` runs drift directly rather than through the hook, and moves to
  the directory format in 2.4 already.

**The windows where the gate cannot see its own machinery (Gate 1 B9).** Before L2, the old drift
judges freshness only over `certifiedModules()`, which holds none of `certify.mjs`,
`certification.mjs` or `drift.mjs`. So the L1 commits (tasks 1.1-1.3) and the pre-switch L2 commits
(2.1-2.3) change the certification machinery, and a functional file, with no functional demand.
Two remedies were weighed:

- **Widen the interim subject** to include `scripts/test/{certify,certification,drift}.mjs` from L2.
  Chosen for L2 onward. It is a mechanism rather than a habit, the rule
  `an-uncertified-module-change-skips-the-functional-half` exists to teach, and it costs nothing
  extra: every L2 and L3 commit already stages a functional or fixture file or one of the three.
- **A by-hand step.** The only remedy before L2, because L1 must not change the old reader. Tasks
  1.1, 1.2, 1.3, 2.1, 2.2 and 2.3 each carry an explicit step: run `certify.mjs functional` over the
  staged commit before committing, and paste the pass line into that task's `red-<task>.txt`.

**The ordering constraints behind the table.**

- **L1 before L2.** An index-hashed old record is what lets L2's own commit be certified by a runner
  that has already been reviewed.
- **L2 before L3.** Widening the subject under the old per-trigger record would multiply the
  overwrite race D1 removes.
- **L4 last among code.** It is independent of the record.

**The TDD pairs.** Each step's tests land in that step's commit: a RED saved to `red-<task>.txt`,
the GREEN in the same commit. The hook runs the whole assertion half, so a RED cannot be committed
alone.

## Risks / Trade-offs

- **Functional-half demands rise from 15 to 70 of 126.**
  → Measured and accepted (D3). Certify is lock-free and can run per worktree. The Baseline states
  the cost as an upper bound taken under load. Task 0.3 re-measures on the day.
- **The shared clone's alternates point into the user's object store.** A `git gc --prune=now`
  during a run could delete an object the clone needs.
  → The run reads only reachable objects plus the index's blobs. Staged blobs are unreachable, but
  gc keeps loose objects for 2 weeks by default, so the risk is a user running
  `gc --prune=now` mid-certify. The run fails loudly, and a failed run writes nothing.
- **The observer misses non-Node reads.**
  → Stated in the spec. The source derivation is still the primary mechanism.
- **Gate 2 must actually audit the trailers.**
  → It is a numbered task item in 8.1 for this change, and a numbered step in the pr-workflow skill
  for every later one (task 6.6), not prose.
- **A trailer-exempted change that did touch the subject.**
  → D3 still demands a functional run for any change to a functional file. The exemption waives only
  the twin edit, never the run.
- **The record directory grows.**
  → Pruning to 50 per bucket (D1).
- **Hooks installed by an older clone.** `core.hooksPath` is `.githooks`, so the new `commit-msg`
  takes effect at checkout. A clone that is not using `core.hooksPath` runs neither hook. That is
  unchanged, and CONTRIBUTING already requires the setting.

## Migration Plan

- **The rollout.** It is D5 plus D7's order.
- **Rollback.** Revert the step's commit. The old reader ignores `pm-suite-certification.d/` and
  finds the old file still in place (D5). If that file is stale, the old drift demands a run, which is
  the loud direction.
- **CI.** Unaffected throughout.

## Open Questions

- Whether CI should also list `Twin-Unchanged` trailers on the PR. It is optional under D4, and
  deferring it changes no spec.

## Deferred

- **Retiring `pm-suite-certification.json`.** The old record coexists with the new directory (D5).
  Removing it is a later release's task, registered as a planned epic and recorded as a
  `--deferral` by 8.2.
