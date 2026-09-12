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

- [x] 4.1 Call-site sweep, DONE MECHANICALLY and it earned itself. `rg` over every
      writeFileSync/appendFileSync/rmSync/renameSync in the engine touching `.conductor/` returned
      13 sites across 9 files. Five suppressed, per the spec's criterion: commit-watch.json,
      detours.log, brief.txt, session-claim.json, activity/*.log. Four NOT suppressed with their
      reasons in the spec: write-conflicts log+latch (a fact about the repository, not a session),
      honcho-memories.log (an outbox whose absence loses work), render-stamp.json (the project's
      own rendered output, and TRACKED — it is what the warning is about), state.json (it IS the
      record). Removals (clearRepoClaim, the write-conflicts rmSync pair) need no guard.
      THE SWEEP FOUND ONE: activity-log.mjs was still writing after the other four were done, and
      had no test — the absent-edit shape, inside the change that ships the rule against it
- [x] 4.2 Enumerate the INVERSE of every operation added — SETTLED IN design.md under "The inverse
      of each operation added": neither suppression nor the warning ships an override, because every
      detached population (deploys, CI, bisect) wants neither the writes nor an opt-out
- [x] 4.3 No read-only verb acquired the warning — asserted over the DECLARED read-only set read
      from VERB_EFFECTS at test time, not a typed list, so a verb reclassified later is covered

## 5. Gates

- [x] 5.1 Gate 1 — spec review before code, fresh-context reviewers over the artifacts BY PATH.
      Record with `record-gate-review --gate 1 --verdict pass --artifact <path>…` (0.41.0 form)
- [ ] 5.2 Gate 2 — implementation review over the committed range, two lenses under `thorough`
- [ ] 5.3 Attribute every commit at the moment it is made; the archive commit is excluded

## 6. Documentation and release

- [ ] 6.1 `commands/upgrade.md` and `README.md`
- [ ] 6.2 Mintlify sync in the same PR cycle
- [ ] 6.3 Full suite green
- [ ] 6.4 Archive this change <!-- pm:lifecycle -->
