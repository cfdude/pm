# Baseline after (task 7.1), beside baseline-before.md (task 0.3)

Measured 2026-09-29 UTC on the final tree, HEAD 7f78e9c9 (6.6), Node v26.10.0, git 2.55.0,
16 CPUs, under heavy parallel load from other work on the machine (load averages below). Commands are
run in this repository, with nothing staged.

## The drift script, both phases (and no phase)

```
$ node scripts/test/drift.mjs --phase pre-commit
drift: ok — 217 tracked test files, 52 functional ids, 0 staged paths
exit 0
$ node scripts/test/drift.mjs --phase commit-msg --message <no-trailer msg>
drift: ok — 0 staged paths, 0 Twin-Unchanged declarations
exit 0
$ node scripts/test/drift.mjs   (no phase: all four)
drift: ok — 217 tracked test files, 52 functional ids, 0 staged paths
exit 0
```

Each phase also ran on every L5 commit, with its staged paths. Each commit's hook output shows
`drift: ok — … N staged paths` from pre-commit, then `drift: ok — N staged paths, 0 Twin-Unchanged
declarations` from commit-msg. For the phases refusing, see 7.2 and the section 4 tests.

## The assertion half, both rungs

```
$ FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
exit 0
ℹ tests 1582
ℹ pass 1582
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

| | before (0.3, 48afa418) | after (7f78e9c9) |
|---|---|---|
| assertion half | not separately recorded in 0.3; 1,550 at 2.2 (red-2.2.txt) | **1,582 / 1,582** |

## Certify, each bucket, each passing and writing a manifest

```
HEAD 7f78e9c9
start sweeps 05:40:37 load { 145.25 179.19 146.63 }
exit sweeps 0 32s end load { 142.67 175.30 146.35 }
start functional 05:41:09 load { 142.67 175.30 146.35 }
exit functional 1 540s end load { 84.22 155.45 154.54 }
HEAD 7f78e9c9
start functional rerun 05:50:26 load { 67.75 148.32 152.01 }
exit functional-rerun 0 346s end load { 34.78 73.89 114.39 }
```

- **sweeps:** `certify: sweeps bucket passed (25/25); recorded 69 subject paths as 38bacbc2e971c8e73f9f80cfd8fcc39a19d1e3cc95e5adb234328a1b5155284a.json in <repo>/.git/pm-suite-certification.d/sweeps`
- **functional, run 1:** FAILED 1257/1258 — the known `emitted-invocations-copy-flake`, on the same
  test as every earlier occurrence: "Layer B integrity:archived-with-zero-ticked-tasks", with ENOENT on
  a fixture's `.git/objects` inside `fs.cpSync` (`certify-functional-7.1-run1-flake.out`). Nothing was
  recorded. This change touches nothing on that path. The occurrence was appended to that epic's notes
  before the re-run.
- **functional, re-run** (index unchanged):
  `certify: the observer saw 2427 Node processes; every tracked file they read is in the functional subject (186 paths), or the record (80, excluded by rule).`
  `certify: functional half passed (1258/1258); recorded 186 subject paths as 195d759951bd4d09636bbbb5dc581dcba5be99c60cdba6f38972cf4a92ebb982.json in <repo>/.git/pm-suite-certification.d/functional`
  The key `195d7599…b982` is the SAME key 6.2's certify recorded (afdb3b64). Every later commit
  (6.3-6.6) staged only paths outside both subjects, and the manifest proves the subject unchanged.

| bucket | before (0.3, old runner, scratch clone) | after (7.1, new runner over the index) |
|---|---|---|
| sweeps | 25/25; 25-31 s at load ~8-12; "recorded the 'engine-source' entry over 65 engine-source files" | 25/25; 32 s at load ~143-179; one manifest entry, 69 subject paths |
| functional | 1,227/1,227; 190/412/345 s at load ~12-43; "recorded 8 module entries" | 1,258/1,258; 346 s (re-run) at load ~68-114, 574 s (6.2) at ~136-203; one manifest entry, 186 subject paths; observer: 2,427 Node processes, 80 record reads excluded by rule |

The runs were not taken under the same load (~8-43 before, ~68-203 after), so no speed claim is
made. The functional half grew by 31 tests (the section 1-4 tests), and the recorded subject grew from
8 modules to 186 paths.

## CI's four steps on the PR

Not run here: this change is committed on `dev` and not pushed (the brief forbids pushing). They run
when the orchestrator opens the PR. Record the four step results here, or in the PR description, before
Gate 2 (8.1).
