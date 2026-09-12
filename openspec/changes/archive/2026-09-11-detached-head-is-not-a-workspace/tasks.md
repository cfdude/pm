## 1. The probe

- [x] 1.1 RED: test that the probe returns `detached` on a detached HEAD, `attached` on a branch,
      `attached` on an unborn HEAD, and `unknown` where git cannot answer
- [x] 1.2 Implement the three-state probe in `scripts/lib/git.mjs` using
      `git symbolic-ref --quiet HEAD`, NOT `rev-parse --abbrev-ref HEAD` — the latter returns the
      literal `HEAD` when detached (also a legal ref name) and exits 128 on an unborn HEAD.
      DISCRIMINATE THE EXIT STATUS: only status 1 is `detached`; 128 and any throw are `unknown`.
      Follow `isAncestor()`'s `e && e.status === 1 ? false : null`, do not write a fresh rule
- [x] 1.3 Cache the answer per process; assert it with a SPAWN COUNT (stub `execFileSync` and count
      invocations), not by inspection. Note the consequence for tests: a fixture that changes HEAD
      within one process sees the cached value
- [x] 1.4 Assert the probe runs with `cwd: ROOT`, under a `CLAUDE_PROJECT_DIR` that differs from
      `process.cwd()` — the warning prints beside one that exists precisely for that divergence

## 2. Breadcrumb suppression

- [x] 2.1 RED: a detached fixture writes no commit watermark
- [x] 2.2 RED: a detached fixture writes no detour log entry
- [x] 2.3 RED: a detached fixture writes no brief snapshot and no activity event
- [x] 2.4 Implement suppression at each write site named in the spec's table; SILENT, with no output
- [x] 2.4b Suppress commit-nudge's REACTION, not only its watermark — a suppressed watermark alone
      leaves every run on the pre-observation text heuristic (gh#104) and still reaches a state write
- [x] 2.5 Assert a branch fixture is byte-identical to its pre-change behaviour — the regression
      that matters, since every managed repo is on a branch

## 3. The mutating-verb warning

- [x] 3.1 RED: a mutating verb in a detached tree warns AND still writes — assert both halves, since
      a warning that also refused would pass a warning-only assertion
- [x] 3.2 RED: the warning names the tag when HEAD is exactly at one, and omits it otherwise
- [x] 3.3 RED: every `read-only` verb is silent in a detached tree
- [x] 3.4 Implement, gated on `verb-effects.mjs`'s existing declaration — no new list of verb names

## 4. Call-site completeness sweep, including inverse operations

- [x] 4.1 Call-site sweep, DONE MECHANICALLY and it earned itself twice. `rg` over
      writeFileSync/appendFileSync/rmSync/renameSync restricted to `.conductor/` paths returns
      **15 sites across 10 files** — an earlier note said "13 across 9", which was the count for a
      NARROWER query (no rmSync/renameSync) and is corrected here rather than left standing.
      Five suppressed, per the spec's criterion: commit-watch.json, detours.log, brief.txt,
      session-claim.json, activity/*.log. Not suppressed, with reasons in the spec: the
      write-conflicts log and latch (a fact about the repository, not a session — and the latch is
      consumed by a read-only verb the warning cannot reach), honcho-memories.log (an outbox whose
      absent line is work lost), render-stamp.json (the project's own rendered output, TRACKED, and
      the thing the warning is ABOUT), state.json (it IS the record). Removals need no guard:
      clearRepoClaim, the write-conflicts rmSync pair, and activity-log's pruneToCap — the last
      being unreachable once appendEvents returns early.
      THE SWEEP FOUND TWO. activity-log.mjs was still writing after the other four were done, with
      no test — the absent-edit shape, inside the change that ships the rule against it. And Gate 2
      found `scripts/agent-log.sh` writing `.conductor/agent-logs/`, which a `*.mjs` glob is
      STRUCTURALLY blind to: a maintainer shell tool, no in-repo caller, gitignored, and it resolves
      its root through `--git-common-dir` so it writes to the main checkout rather than a linked
      worktree. Left writing, deliberately, and recorded here rather than absent from the list.
- [x] 4.2 Enumerate the INVERSE of every operation added — SETTLED IN design.md under "The inverse
      of each operation added": neither suppression nor the warning ships an override, because every
      detached population (deploys, CI, bisect) wants neither the writes nor an opt-out
- [x] 4.3 No read-only verb acquired the warning — asserted by RUNNING every verb in the DECLARED
      read-only set, read from VERB_EFFECTS at test time rather than typed out, so a verb
      reclassified later is covered. (The first version iterated a sample of four and claimed
      otherwise; Gate 2 caught the gap between the claim and the code.)

## 5. Gates

- [x] 5.1 Gate 1 — spec review before code, fresh-context reviewers over the artifacts BY PATH.
      Record with `record-gate-review --gate 1 --verdict pass --artifact <path>…` (0.41.0 form)
- [x] 5.2 Gate 2 — implementation review over the committed range, two lenses under `thorough`
- [x] 5.3 Attribute every commit at the moment it is made; the archive commit is excluded

## 6. Documentation and release

- [x] 6.1 `commands/upgrade.md` and `README.md`
- [x] 6.2 Mintlify sync in the same PR cycle
- [x] 6.3 Full suite green
- [x] 6.4 Archive this change <!-- pm:lifecycle -->
