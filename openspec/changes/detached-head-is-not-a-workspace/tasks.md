## 1. The probe

- [ ] 1.1 RED: test that the probe returns `detached` on a detached HEAD, `attached` on a branch,
      `attached` on an unborn HEAD, and `unknown` where git cannot answer
- [ ] 1.2 Implement the three-state probe in `scripts/lib/git.mjs` using
      `git symbolic-ref --quiet HEAD`, NOT `rev-parse --abbrev-ref HEAD` — the latter returns the
      literal `HEAD` when detached, which is also a legal ref name
- [ ] 1.3 Cache the answer per process; assert the probe is not re-run per call site

## 2. Breadcrumb suppression

- [ ] 2.1 RED: a detached fixture writes no commit watermark
- [ ] 2.2 RED: a detached fixture writes no detour log entry
- [ ] 2.3 RED: a detached fixture writes no brief snapshot and no activity event
- [ ] 2.4 Implement suppression at each write site; SILENT, with no output
- [ ] 2.5 Assert a branch fixture is byte-identical to its pre-change behaviour — the regression
      that matters, since every managed repo is on a branch

## 3. The mutating-verb warning

- [ ] 3.1 RED: a mutating verb in a detached tree warns AND still writes — assert both halves, since
      a warning that also refused would pass a warning-only assertion
- [ ] 3.2 RED: the warning names the tag when HEAD is exactly at one, and omits it otherwise
- [ ] 3.3 RED: every `read-only` verb is silent in a detached tree
- [ ] 3.4 Implement, gated on `verb-effects.mjs`'s existing declaration — no new list of verb names

## 4. Call-site completeness sweep, including inverse operations

- [ ] 4.1 Enumerate ALL breadcrumb write sites mechanically (`rg`), state where suppression holds
      and where it does not, and justify each omission. A guard at one site with an untouched
      sibling is a FINDING even though the unedited site never appears in the diff
- [ ] 4.2 Enumerate the INVERSE of every operation added. Suppression has no inverse to ship (there
      is no "write it anyway" flag) — state whether that is right, or a gap
- [ ] 4.3 Confirm no read-only verb acquired the warning, re-running the check 0.41.0 used

## 5. Gates

- [ ] 5.1 Gate 1 — spec review before code, fresh-context reviewers over the artifacts BY PATH.
      Record with `record-gate-review --gate 1 --verdict pass --artifact <path>…` (0.41.0 form)
- [ ] 5.2 Gate 2 — implementation review over the committed range, two lenses under `thorough`
- [ ] 5.3 Attribute every commit at the moment it is made; the archive commit is excluded

## 6. Documentation and release

- [ ] 6.1 `commands/upgrade.md` and `README.md`
- [ ] 6.2 Mintlify sync in the same PR cycle
- [ ] 6.3 Full suite green
- [ ] 6.4 Archive this change <!-- pm:lifecycle -->
