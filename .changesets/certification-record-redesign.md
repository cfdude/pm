* **Contributor tooling only — nothing a plugin user installs or runs changes.** The engine, the
  commands, skills, agents and hooks the plugin ships are untouched; everything below is how this
  repository certifies its own triggered test buckets.
* **The certification record is one file per passing run, named by what it certified, so parallel
  worktrees certify with no lock (#226).** `certify.mjs` used to rewrite one shared
  `pm-suite-certification.json`, and every commit resolved every entry's `covers` list against its
  own tree, so a peer worktree's certification could refuse a commit it was not about, and two
  certifies could lose each other's write. The record is now
  `$(git rev-parse --git-common-dir)/pm-suite-certification.d/<bucket>/<key>.json`, created and never
  rewritten, and a commit is fresh only when ONE passing entry's manifest — the mode and blob id of
  every path in the bucket's subject — equals that subject in the index. A staged deletion of a
  subject path demands a run too. Entries are pruned to the newest 50 per bucket. The old file is
  neither read nor removed; its retirement is deferred to a later release.
* **Certify runs over the index, not the working tree (#230).** It copies the index once, runs the
  bucket in a `git clone --shared` checked out from that copy, and records the copy's manifest, so a
  partial stage is certified as its staged half and an edit made during a run of several minutes
  never enters the record. It never writes the working tree, the index, the stash or the worktree
  list, and removes its run directory on exit and on Ctrl-C.
* **The functional half is demanded by what it observes (#229).** Its subject was the engine modules
  that call the git gateway, so a change to a module the half imports but that never reaches git —
  a refusal's wording in `archive-gate.mjs` — skipped it. The subject is now the half's import
  closure, the assertion files it executes, the files it names, the shipped roots it walks, and
  `README.md`/`CLAUDE.md`/`docs/parity-ledger.json` when named. Over the 0.50.0 build this moves the
  functional demand from 15 of 126 commits to 70. A run-time observer loaded into every Node process
  the half starts fails the certification, naming the file, when the half reads a tracked file the
  derivation missed or starts a Node child whose `NODE_OPTIONS` drops the observer.
* **Diff coupling moved to a new `commit-msg` hook, with a declared, audited exemption (#227).** A
  staged functional test still needs its assertion twin in the same commit, unless the message
  carries a `Twin-Unchanged: <id> — <reason>` git trailer saying the change leaves what the file
  tests untouched. git parses the trailer; Gate 2 lists and judges every one in the reviewed range
  (a new numbered step in the `pr-workflow` skill). The pre-commit hook now runs enrolment, twin
  coverage and freshness; a bare `node scripts/test/drift.mjs` still runs all four checks.
