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
  (`drift.mjs:52-60`).

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
| Static and dynamic import closure of `functional/*` and `conductor.mjs` | 59 |
| The closure, plus files under `scripts/`, `.githooks/` or `hooks/` that closure tests name (assertion half excluded) | 60 |
| **That, plus the shipped-surface roots and `README.md`, `CLAUDE.md`, `docs/parity-ledger.json` (D3's choice)** | **70** |
| Any engine module (`conductor.mjs` and `scripts/lib/*.mjs`) | 51 |
| Any engine module, plus `scripts/test/{functional,fixtures}/` | 58 |
| Declared observation map | not measurable: no map exists |

**Other counts over the same range:**

- 51 commits touched engine source. They demanded the sweeps.
- 36 of those never demanded the functional half.
- 21 commits touched a functional test file.

**Sizes at c96240ab:**

- the certified set today: 8 files;
- the import closure: 128 files, including all 65 engine files;
- the closure plus the named files: 141;
- D3's full subject: 176 (the shipped-surface roots and root docs add 35).
- The named files add `.githooks/pre-commit`, `hooks/hooks.json`, `scripts/test/drift.mjs` and 10
  fixtures. They also add one false positive, `hooks/README.md`, because "README.md" appears as a
  literal.

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

### D1. The record is a directory of content-named manifests, created and never rewritten (design question 1)

**Layout.**

- The record is a DIRECTORY, `$(git rev-parse --git-common-dir)/pm-suite-certification.d/`, with one
  sub-directory per bucket (`functional/`, `sweeps/`).
- Each passing run writes one file there, `<key>.json`:

  ```json
  {"version": 2, "bucket": "functional", "manifest": {"<path>": "<blob id>", ...},
   "result": "pass", "counts": {...}, "ranAt": "...", "engineSha": "...", "worktree": "<git-dir>"}
  ```

- `<key>` is the sha256 of the manifest, serialized as `path NUL blob-id NUL` over the sorted paths.
- `worktree` is informational, like `engineSha`. Nothing gates on it.
- `ranAt` is set when the entry is WRITTEN, not when the run started, so the pruner (below) never
  ranks a just-finished run as the oldest.

**Writing.**

- The file is written under a unique temp name (`<key>.<pid>.<random>.tmp`) and then renamed to
  `<key>.json`.
- No run reads another run's file in order to write its own, so two concurrent runs cannot lose an
  update. This is the defect in today's read-modify-rename (`certification.mjs:361-367`).
- Two runs over IDENTICAL content produce the same key. The second rename replaces a file with an
  equivalent claim, so nothing is lost.

**Content identity is the git blob id.** Drift reads the blob ids with `git ls-files -s` (`ls-files`
is already permitted), and certify reads them from its copy of the index. This replaces sha256-over-
bytes. It is cheaper, because there is no `show :path` per file, and it is exactly the identity the
commit will record.

**Freshness.**

1. Let S be the staged paths (`diff --cached --name-only --no-renames`) that fall in a bucket's
   subject, where the subject is derived from the INDEX as today.
2. If S is empty, the bucket is not demanded.
3. Otherwise the commit is fresh when ONE entry with `result: "pass"` agrees on every path in S:
   - the same blob id where the index holds the path;
   - no manifest key where the index does not hold it.
4. Otherwise the refusal names S and the run.

Requiring ONE entry means drift never combines two runs into a tree nobody ran. It still lets a
certified change be split across commits, because each commit's S is a subset of what the one run
held.

**Why content-keyed and not per worktree (`--git-dir`).**

- **Unnecessary for isolation.** Per-worktree records would isolate worktrees, but the content key
  isolates them already: entries about different content never agree with each other's index.
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
  - A deleted functional test is a staged deletion inside the subject.
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
entries by `ranAt` after it writes its own.

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

**The known limit.** The clone's HEAD is the worktree's HEAD. A test that compares HEAD with the
working content therefore sees staged-but-uncommitted content as uncommitted, just as it does in a
checkout.

**Partial staging.** A partially staged file is exported as its staged half, and its blob id in the
manifest is the staged blob's. Untracked files are absent from the export and from the manifest.

**Latency.** The run adds one index copy, one shared clone and one `checkout-index`, together under
a second (Baseline), to a bucket that takes minutes. The drift script gets FASTER: `ls-files -s`
replaces one `git show :path` per certified file.

### D3. The functional subject is derived from what the half observes (design question 3; #229)

**The definition.** The subject is:

- the import closure (static `from`, `export … from`, and literal dynamic `import("…")` specifiers,
  relative only) of every `scripts/test/functional/*.test.mjs` and of `scripts/conductor.mjs`;
- the functional test files themselves;
- every tracked file under `scripts/`, `.githooks/` or `hooks/` whose file name a closure file under
  `scripts/test/` spells as a quoted literal or a path tail. This is the `coversFor()` basename
  precedent (`certification.mjs:252-272`), moved to where it is sound;
- every tracked file under `commands/`, `skills/`, `agents/` or `.claude-plugin/` when a closure file
  spells that root as a path segment, and `README.md`, `CLAUDE.md` and `docs/parity-ledger.json` when
  one spells the name.

**Why the shipped surface is in.** The functional half reads it: `conductor-13:265`, `conductor-36:407`
and `conductor-15:412-413` read `commands/*.md` and `README.md` from REPO; `parity:159` reads
`docs/parity-ledger.json`; and `fixtures/parity-helpers.mjs:14` walks all five shipped roots. Leaving
them out would make a command-doc edit that a functional test pins #229 again. A first draft of this
design scoped the named-literal rule to `scripts/`, `.githooks/` and `hooks/` only (60 of 126); a
review found these reads, and the subject was widened before any code.

**Why the repository's record is out.** `openspec/`, `.conductor/`, `CHANGELOG.md` and the rest of
`docs/` are edited by nearly every change. `conductor-15:1335-1436` reads `openspec/changes/archive/`,
which is history, not the code the half verifies. Putting the record in the subject would demand the
functional half on almost every commit. The exclusion is stated in the spec and in the observer's
limits; CI still runs those tests on every push.

`scripts/test/{assert,unit}/` is excluded. It is derived from the INDEX by the same `indexReaders()`
drift already uses.

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
  `fs`, or passed to `child_process` as a script.
- **The check.** Certify then refuses if any observed path that is tracked in the index copy lies
  outside the derived subject. It names the path, and writes no entry.
- **Why here.** This catches a path assembled at run time, which no source scan can see. It runs at
  certify time, never per commit.
- **Its limit.** A file read by a non-Node process on its own, for example a shell script reading a
  file, is not observed. The spec states this.

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
- **Its own export.** The pre-commit snapshot is removed when that hook exits, so `commit-msg` makes
  its own `checkout-index` export to run the snapshot's drift, measured at 0.45 s (Baseline).
- **Merges are not judged.** git runs `commit-msg`, not `pre-commit`, for a merge commit, and
  `MERGE_HEAD` is present while it runs (`commit-msg-probe.log`, merge probe 2). A merge's staged set
  is everything the other parent brings in, and a `Twin-Unchanged` trailer on a merged-in commit is
  not on the merge's message, so judging it would refuse a change that already passed (merge probe 1:
  the merge's staged set held the exempted file and no trailer). So coupling skips when `MERGE_HEAD`
  exists. A squash commit has no `MERGE_HEAD` and is judged like any other.
- **The probe.** It verified that git 2.55 hands `commit-msg` the commit's own index in all four
  commit forms (Baseline).

**The declaration.**

- **Its form.** `Twin-Unchanged: <id> — <reason>`, one per id, in the message's final paragraph,
  with lines beginning `#` ignored. It is parsed in JavaScript from the file, so the permitted git
  subcommands do not grow.
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
  - **Why Gate 2, not `main`.** Squash merges fold dev commits into one on `main` and do not
    reliably keep trailers, so Gate 2 on the dev range is the audit of record.
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
  `pm-suite-certification.json` is never parsed by the new drift script.
- **Why no translation.** Its hashes are sha256-over-bytes of working-tree content with per-module
  keys, not blob-id manifests, and translating them would invent a claim no run made.
- **Removal.** Certify removes the old file with an idempotent `rm -f`-equivalent on every write. The
  precedent is the hook's permanent `pm-isolation-flag` cleanup (`pre-commit:161-168`).
- **A fresh clone,** or a clone upgraded mid-flight, has an empty directory or none. It demands a run
  only when it stages subject content, which is the same behaviour as today's missing file
  (`certification.mjs:327-341`).

### D6. Parallel worktrees need no certify lock (design question 6)

**`pm-certify.lock` becomes unnecessary.**

- **Overwrite.** D1 removes it: entries are named by content and never rewritten.
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
| L2 | The manifest record (D1) and D5, with today's certified set plus the functional and fixture files the run executed as the functional subject, and `engine-source` plus `scripts/test/sweeps/*` as the sweeps subject. The test files must be in the subject from L2 on, because L2 retires the dangling checks and a deleted functional test must already be a staged subject change. Drift gets `ls-files -s` freshness; the dangling checks retire. Certify writes the new directory and removes the old file. | new format | new drift, same commit | The commit is judged by its own new drift, reading the entry the applier's new certify wrote. Old drift is gone in this commit, so nothing reads the old file. |
| L3 | The observed subject (D3) and the run-time observer. `certifiedModules()` retires; `store.mjs:624` is rewritten. | new format, wider subject | new drift | The commit stages `certification.mjs`, which the closure contains (`drift-script` imports it), so it demands a functional certify over itself. The applier runs it first. |
| L4 | `.githooks/commit-msg` plus `--phase`: check 3 leaves the pre-commit run and enters commit-msg, in ONE commit. | — | pre-commit (snapshot drift, 1/2/4) and commit-msg (working-tree hook, snapshot drift, 3) | Coupling is never enforced in zero places or in two. The new hook file is present in the working tree when this commit's commit-msg phase runs. |
| L5 | Docs: CONTRIBUTING, the CLAUDE.md "Tests:" bullet, the lesson's `enforced_in`, `.changesets/`. | — | — | The docs touch no subject. |

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
  → It is a numbered task item in 9.1, not prose.
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
- **Rollback.** Revert the step's commit. The old reader ignores `pm-suite-certification.d/`, and
  the next old-format certify recreates the old file.
- **CI.** Unaffected throughout.

## Open Questions

- Whether CI should also list `Twin-Unchanged` trailers on the PR. It is optional under D4, and
  deferring it changes no spec.
