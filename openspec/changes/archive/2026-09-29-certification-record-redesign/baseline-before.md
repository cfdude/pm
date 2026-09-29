# Baseline before (task 0.3), re-measured on the day

Measured 2026-09-28 (local; 2026-09-29 UTC) at HEAD 48afa418, Node v26.10.0, git 2.55.0, 16 CPUs.
Nothing below is copied from design.md; each block names the command that produced it.

## (a) Trigger frequency

```
node openspec/changes/certification-record-redesign/measure.mjs . e71c63a3 presquash/pr-234
```
(10.9 s wall.) Output, `perCommit` omitted:

```json
{
  "range": "e71c63a3..presquash/pr-234",
  "nonMergeCommits": 126,
  "A_certified_today": 15,
  "sweeps_engineSource_today": 51,
  "B_importClosure": 59,
  "B_closurePlusNamed": 60,
  "B_widenedShippedSurface": 70,
  "B_widenedPlusHeadDeletions": 70,
  "commitsDeletingOrLeavingSubjectPath": 0,
  "C_anyEngineModule": 51,
  "C_plusFunctionalAndFixtureFiles": 58,
  "functionalFileChanged": 21,
  "engineCommitsMissedToday": 36,
  "headSizes": {
    "executedAssertion": 2,
    "widened": 178,
    "wideOnly": 37,
    "closure": 132,
    "observed": 143,
    "engine": 65,
    "certified": 8
  },
  "headNamedByLiteral": [
    ".githooks/pre-commit",
    "hooks/README.md",
    "hooks/hooks.json",
    "scripts/test/drift.mjs",
    "scripts/test/fixtures/assert-harness.mjs",
    "scripts/test/fixtures/git-gateway-capture.json",
    "scripts/test/fixtures/inject-state-conflict.cjs",
    "scripts/test/fixtures/rules-0.26.0-jira-scoped.txt",
    "scripts/test/fixtures/state-0.26.0.json",
    "scripts/test/fixtures/state-legacy-gate-verdict.json",
    "scripts/test/fixtures/state-pre-disposition-walk.json"
  ],
  "headExecutedAssertion": [
    "scripts/test/assert/engine-resolution.test.mjs",
    "scripts/test/assert/parity.test.mjs"
  ],
  "b4ffe164": {
    "c": "b4ffe164",
    "A_certified": false,
    "sweeps_engine": true,
    "B_closure": true,
    "B_observed": true,
    "B_widened": true,
    "B_widenedWithHead": true,
    "deletesSubjectPath": false,
    "C_anyEngine": true,
    "C_anyEngine_or_functionalFiles": true,
    "funcFile": false,
    "sizes": {
      "executedAssertion": 0,
      "widened": 168,
      "wideOnly": 34,
      "closure": 124,
      "observed": 136,
      "engine": 63,
      "certified": 8
    },
    "named": [
      ".githooks/pre-commit",
      "hooks/README.md",
      "hooks/hooks.json",
      "scripts/test/drift.mjs",
      "scripts/test/fixtures/assert-git-shim.mjs",
      "scripts/test/fixtures/assert-harness.mjs",
      "scripts/test/fixtures/git-gateway-capture.json",
      "scripts/test/fixtures/inject-state-conflict.cjs",
      "scripts/test/fixtures/rules-0.26.0-jira-scoped.txt",
      "scripts/test/fixtures/state-0.26.0.json",
      "scripts/test/fixtures/state-legacy-gate-verdict.json",
      "scripts/test/fixtures/state-pre-disposition-walk.json"
    ],
    "executed": []
  }
}
```

Against the expectation in 0.3(a): `A_certified_today` 15, `B_widenedShippedSurface` 70,
`B_widenedPlusHeadDeletions` 70, `C_anyEngineModule` 51, of 126 non-merge commits;
`headSizes.closure` 132; `headExecutedAssertion` = `assert/engine-resolution.test.mjs`,
`assert/parity.test.mjs`. **Every expected value matches. No difference to explain.**

## (b) Certify timing, current runner (old: runs over the checkout)

Scratch clone of this repository at 48afa418 (`git clone -q . <scratch>/clone`), so this repository's
record was not touched. Sequential runs, `sysctl -n vm.loadavg` before and after each:

```
( cd <scratch>/clone && node scripts/test/certify.mjs sweeps )       # x3
( cd <scratch>/clone && node scripts/test/certify.mjs functional )   # x3
```

```
node v26.10.0 cpus 16 git git version 2.55.0 clone HEAD 48afa418
certify sweeps run 1: exit 0, 30s, load start { 7.59 7.49 8.43 } end { 8.85 7.79 8.50 } :: certify: sweeps bucket passed (25/25); recorded the 'engine-source' entry over 65 engine-source files
certify sweeps run 2: exit 0, 31s, load start { 8.85 7.79 8.50 } end { 11.15 8.42 8.70 } :: certify: sweeps bucket passed (25/25); recorded the 'engine-source' entry over 65 engine-source files
certify sweeps run 3: exit 0, 25s, load start { 11.15 8.42 8.70 } end { 12.15 8.85 8.85 } :: certify: sweeps bucket passed (25/25); recorded the 'engine-source' entry over 65 engine-source files
certify functional run 1: exit 0, 190s, load start { 12.15 8.85 8.85 } end { 15.38 13.77 11.07 } :: certify: functional half passed (1227/1227); recorded 8 module entries in <scratch>/clone/.git/pm-suite-certification.json
certify functional run 2: exit 0, 412s, load start { 15.38 13.77 11.07 } end { 34.51 42.76 28.81 } :: certify: functional half passed (1227/1227); recorded 8 module entries in <scratch>/clone/.git/pm-suite-certification.json
certify functional run 3: exit 0, 345s, load start { 34.51 42.76 28.81 } end { 17.44 41.48 34.72 } :: certify: functional half passed (1227/1227); recorded 8 module entries in <scratch>/clone/.git/pm-suite-certification.json
```

The load average rose from ~8 to ~43 during functional runs 2 and 3 (other work on the machine), which
is why they took 412 s and 345 s against run 1's 190 s. Every functional run: 1,227/1,227.

## (c) The export

```
git checkout-index -a --prefix=<scratch>/exp.XXXX/               # bare export
sh <scratch>/build-shared.sh <repo> <scratch>/sc.XXXX            # D2's shared-clone build
```
build-shared.sh: resolve `--git-path index`, `cp` it to `index.copy`, `GIT_INDEX_FILE=index.copy git
ls-files -s`, `git clone --shared --no-checkout -q <common dir> tree`, `git -C tree update-ref
--no-deref HEAD <HEAD>`, copy the index copy to `tree/.git/index`, `git -C tree checkout-index -a -f`.

| Measurement (load average 9.0) | Result |
|---|---|
| Bare `checkout-index -a` export | 0.10 s real, 978 files, 17 MB |
| Index copy + `ls-files -s` + shared clone + update-ref + `checkout-index -a -f` | 0.17 s real, 978 files; `git status` in the clone clean; `git worktree list` unchanged |

## (d) The bare-export failure

```
E=$(mktemp -d <scratch>/bare.XXXX); git -C <scratch>/clone checkout-index -a --prefix="$E/"
( cd $E && env -u NODE_TEST_CONTEXT FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/functional/*.test.mjs )
```

```
functional in bare export: exit 1, 178s, load start { 17.44 41.48 34.72 } end { 10.03 27.73 30.27 } :: ℹ tests 1192 ℹ pass 1188 ℹ fail 4 
```

1,192 of 1,227 tests reported (35 never ran); 4 failed; 16 lines of `not a git repository` in the
output. The failing files — the same four as `functional-in-snapshot.out` (2026-09-28):

- `functional/conductor-13.test.mjs` — test "16.3: a headSha naming the last attributed commit at another length reads FRESH" (`:2038`)
- `functional/conductor-15.test.mjs` — the whole file
- `functional/conductor-37.test.mjs` — "the checker fires on the ACTUAL 0.31.0 truncation, not just a synthetic one" (`:265`)
- `functional/gate-artifact-evidence.test.mjs` — the whole file

## 0.4 Tracker items, re-read with comments

`gh issue view <n> --repo cfdude/pm --json body,comments,updatedAt,state`, read 2026-09-29T00:49:10Z:

- #226: OPEN, updatedAt 2026-09-26T00:50:28Z, 1 comment(s) (latest 2026-09-26T00:50:28Z).
- #230: OPEN, updatedAt 2026-09-25T22:42:55Z, 0 comment(s).
- #229: OPEN, updatedAt 2026-09-25T21:30:36Z, 0 comment(s).
- #227: OPEN, updatedAt 2026-09-25T20:20:06Z, 0 comment(s).

No comment newer than 2026-09-28 on any of the four. Nothing in the bodies or the one comment (#226,
2026-09-26, the foreign-covers failure mode) contradicts the design: #226 asks for a content key or a
per-worktree record (D1 takes the content key and states why not per-worktree), #230 asks for certify
over an exported index (D2), #229 asks for a trigger derived from what the half observes (D3), #227
offers a trailer or an allowlist (D4 takes the trailer and rejects the allowlist).
