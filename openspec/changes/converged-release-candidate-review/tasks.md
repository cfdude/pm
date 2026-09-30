# Tasks

## Commit mechanics

These rules bind every section below.

- **TDD.** Every behaviour task is RED then GREEN, landed in ONE commit, because the pre-commit hook
  runs the whole assertion half. Save the failing run as `red-<task>.txt` in this directory, and name
  that file in the commit message.
- **Rungs.** A test's rung follows what it OBSERVES:
  - **UNIT**: values over an in-memory store. The `rulesBlock()` string, the `release show` output
    over a fixture state, and the budget derivation.
  - **FILE** (`assert/`): bytes on disk. `CLAUDE.md` carrying the section after `write-rules`.
  - **FUNCTIONAL**, plus an assertion twin: only where real git is the subject. That is the staleness
    of a converged verdict recorded before a fix, which resolves shas through `git`. Its twin runs
    over the git double in `scripts/test/fixtures/`.
- **Commits.**
  - One conventional commit per task, with `git add` of explicit paths.
  - Certify when the hook names a bucket, then run a plain `git commit`.
  - Never `--no-verify`.
  - After each commit, run `git show --stat <sha>` (5.2) and
    `update-epic converged-release-candidate-review --attribute-commit <sha>` (5.3).

## 0. Before any code

- [ ] 0.1 **Gate 1**, at this epic's effective review: one fresh-context reviewer over `proposal.md`,
      `design.md`, `specs/release-candidate-review/spec.md` and this file, BY PATH. Check the
      WHEN/THEN rungs, whether D2's rejection of a new verb holds against the staleness spec, and
      consistency with `execution-profile-layered-settings`'s `review` resolution. Fix Critical and
      Important findings, and run `openspec validate converged-release-candidate-review --strict`.
      Record the verdict with `record-gate-review converged-release-candidate-review --gate 1 …`.
- [ ] 0.2 **Cross-spec review** (required item 5). This is covered by the single 0.51.0 cross-spec
      pass in `execution-profile-layered-settings` task 0.2, which MUST include this change's spec.
      Verify: `release show 0.51.0` shows a current verdict whose hashed set includes
      `specs/release-candidate-review/spec.md`.

## 1. The shipped skill

- [x] 1.1 Write `skills/release-candidate/SKILL.md` with the six steps and the rules on budget, cap,
      classification, recording and attribution from the spec. Include the per-member
      `record-gate-review` loop and the `update-epic --attribute-commit` rule for fix commits, as
      exact invocations using the engine-resolution preamble the command docs use. Add it to a
      capability in `docs/parity-ledger.json`, in the same commit. Verify:
      `node --test scripts/test/parity.test.mjs` passes, and every invocation in the skill is accepted
      by `node scripts/conductor.mjs <verb> --help` for its verb (the emitted-invocations check, if it
      covers skills; otherwise run each by hand and save the output to `invocations-1.1.txt`).

## 2. Emission

- [x] 2.1 **Shared chokepoint.** `execution-profile-layered-settings` task 4.1 (rulesBlock, rules
      fixtures, `commands/review-mode.md`) lands FIRST. This task rebases on it and does not start
      until that commit is in. TDD (UNIT): `rulesBlock` emits a "Release candidate" section naming the skill, the
      budget-is-the-maximum rule, the one-round cap with Critical-only reopen, and the
      same-range-per-member recording rule. Update the rules fixtures and managed-rules assertions in
      the same commit. Cover "The rules block points to the procedure".
- [x] 2.2 TDD (FILE): after `write-rules`, `CLAUDE.md` on disk carries the section once, inside the
      managed markers.

## 3. Read-back

- [x] 3.1 TDD (UNIT): `release show <id>` prints the derived "candidate review" line (design D3). Cover
      "Converged members", "A member with a divergent head is named" and "A member with no verdict
      is named", "A withdrawn Gate 2 is named as missing" and "Archived and unbuilt members are not
      candidate members", plus a release with no candidate members printing no line. Candidate
      members are the release members that are not archived and have at least one attributed commit
      in `<base>..<head>`. Verify: the store is unchanged after the read.
- [x] 3.2 TDD (FUNCTIONAL plus assertion twin): "A verdict recorded before a fix is stale". This uses
      the real git in a temp repo: attribute two commits, record Gate 2 at the first head, attribute
      a fix commit descending from it, and assert the verdict renders stale and a `delivered` archive
      is refused naming the fix. Then re-record at the new head and assert a pass. This pins that D2
      needs no new verb. The twin asserts the same over the git double.

## 4. Command docs

- [x] 4.1 `commands/review-mode.md`: the budget applies per candidate as the maximum over members, and
      links the skill. `commands/release.md` (or whichever doc covers `release show`): the candidate
      review line. Verify: `rg -n "release-candidate" commands` names both.

## 5. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] 5.1 **Call-site completeness sweep, including inverses.**
      - Derive with `rg -n "record-gate-review|gateReview|gate2|releaseShow|release show" scripts commands skills`
        every site that writes, reads or removes a Gate 2 record, or renders a release.
      - State where the "same range for every member" rule is emitted, which is the skill and the
        rules block, and where it is deliberately not, which is every per-change surface. Justify each.
      - **DATA references:** this change stores none. Say so, citing design D2.
      - **Inverses:** the recording inverse is the existing `update-epic <id> --withdraw-gate-review 2
        --withdrawal-reason …`, applied per member. The skill must name it for the case where a
        converged verdict is withdrawn, and the withdrawal applies to every member.
      - Save the result as `call-site-sweep-5.1.txt`.
- [x] 5.2 **Verify each task against its commit.** For every task, run `git show --stat <sha>` and
      assert that every claimed file is in THAT commit. Save the result as
      `commit-verification-5.2.txt`.
- [x] 5.3 **Attribute every commit.** Run
      `node scripts/conductor.mjs update-epic converged-release-candidate-review --attribute-commit <sha>`
      at each commit, including the proposal commit. Never attribute the archive move (8.4). Verify
      that the attribution array lists the commits in landing order.
- [x] 5.4 **Lifecycle marker.** 8.3 and 8.4 carry `<!-- pm:lifecycle -->` on their task lines. Verify:
      `rg -n "pm:lifecycle" openspec/changes/converged-release-candidate-review/tasks.md`.
- [ ] 5.5 **Dogfood it.** Run 0.51.0 itself through this procedure, as the first candidate. Record the
      tokens spent reviewing and building against the `certification-record-redesign` baseline
      (5.8M / 2.0M), and put the numbers in the closeout. The measurement is evidence for the
      practice, and without it the practice reads as a preference.
- [x] 5.6 **Route what the work taught you.** Name each item as a practice, as tooling friction
      (`/pm:feedback`) or as a process failure (`docs/lessons/`), with evidence. "None" must say what
      was looked at.

## 6. Gate 2

- [ ] 6.1 **Gate 2** via the converged 0.51.0 candidate review (this procedure, by construction). Fix
      Critical and Important findings. Record the verdict with
      `record-gate-review converged-release-candidate-review --gate 2 --verdict pass --base-sha <rc base> --head-sha <rc head> --reviewer "<identity>"`,
      at the same range as every other 0.51.0 CANDIDATE member (release members that are not
      archived and have an attributed commit in `<rc base>..<rc head>`). Archived and unbuilt
      members are not recorded. Verify: `release show 0.51.0` reports the candidate review converged
      over its candidate members, each of which has a current, non-withdrawn Gate 2.

## 7. Docs (after Gate 2 only)

- [ ] 7.1 README: the release-candidate procedure in brief, and the skill. Verify: the README names
      `release-candidate` and `release show`'s candidate line.
- [ ] 7.2 Mintlify (`pm-plugin.dev`), per the `mintlify-doc-sync` skill: a release-candidate page or
      section, and the `release show` reference. Merge live and verify the pages render.

## 8. Close

- [ ] 8.1 Integration: the full suite passes, the functional and sweeps certify runs pass, and
      `openspec validate converged-release-candidate-review --strict` passes.
- [ ] 8.2 **Re-record Gate 2 after docs.** Once the docs commits (7.1, 7.2) have landed and been
      attributed, re-record Gate 2 at the post-docs head:
      `record-gate-review converged-release-candidate-review --gate 2 --verdict pass --base-sha <rc base> --head-sha <post-docs head> --reviewer "<identity>"`.
      Re-record, never withdraw. Verify: the epic's Gate 2 renders as a pass, not stale, so the
      `delivered` archive in 8.3 is not refused.
- [ ] 8.3 <!-- pm:lifecycle --> **Disposition.**
      `update-epic converged-release-candidate-review --status archived --outcome delivered --reason "<why>" --no-deferrals`,
      or `--deferral` / `--declined-deferral` for anything held back. Run `/pm:status`.
- [ ] 8.4 <!-- pm:lifecycle --> **Archive.** `/opsx:archive converged-release-candidate-review`. The
      archive move is NOT attributed.
