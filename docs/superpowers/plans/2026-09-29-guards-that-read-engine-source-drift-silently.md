# guards-that-read-engine-source-drift-silently — plan

## Goal

A source-reading guard in the test tree answers from CODE, never from a comment, and cannot quietly
start doing otherwise. Two deliverables, both named by the epic:

1. **One shared, sound source-stripping helper** built on `scripts/test/js-lexer.mjs` (regex-aware,
   fails closed on a misparse), replacing every hand-rolled comment stripper in the test tree.
2. **A lint** that fails when a positive assertion (`assert.match`, `assert.ok(<re>.test(x))`,
   `assert.ok(x.includes(…))`) is made against RAW engine source.

## Premise, as verified against today's code (c37b20e5)

- `js-lexer.mjs` exists and lexes all 305 `.mjs` files under `scripts/` with ZERO misparse
  (measured). Its `stripComments()` DELETES a block comment (line numbers shift), and it is certify
  machinery (`certification.mjs` imports it) — so it is NOT changed; the helper is a new module.
- The two strippers the epic names are still live: `assert/assert-half-has-no-spawn.test.mjs`
  (character-level, no regex state — the desync the epic measured) and `assert/conductor-13.test.mjs`
  `codeLines()` (line-oriented; drops comment-only lines, keeps a TRAILING comment, so
  `x(); // archiveGate(` still satisfies it — a false negative).
- **Five more hand-rolled strippers** (rg `function stripComments|function codeLines|replace\(/\\/\\*`):
  `assert/save-report-surface.test.mjs`, `assert/detour-frame-drop.test.mjs` (both character-level,
  no string state), `assert/conductor-35.test.mjs` (regex), `assert/temp-dir-cleanup.test.mjs`
  (line regex), `assert/conformance.test.mjs:164` (inline regex, eats `//` inside a string).
- Positive assertions against raw engine reads, found mechanically (prototype of the lint over
  `scripts/test/**/*.test.mjs`): 21 uses in 14 files, plus `assert/conductor-25.test.mjs:133`, which
  reads through `path.join(REPO, rel)` and is invisible to a mechanical scan (see limits).

## Tasks

### 1. The shared helper — `scripts/test/fixtures/source-code.mjs`
- `codeOnly(src, name)`: every comment BLANKED (each char → space, newlines kept) so line and column
  numbers survive; strings, templates and regexes kept; THROWS on any `lex()` misparse.
- `engineCode(rel)`: reads a repo-relative engine path (`scripts/conductor.mjs`, `scripts/lib/*.mjs`)
  and returns `codeOnly` of it; refuses a path outside the engine.
- RED: `assert/source-code.test.mjs` — a comment naming a token is gone; the desync case (a regex
  literal holding a quote, then a comment naming the token) is gone; strings kept; line count and
  offsets preserved; a misparse throws; a non-engine path is refused. Fails first on the missing module.
- GREEN: write the module.

### 2. The no-spawn guard uses it
- RED: `installsShim('const q = /"/;\n// import "../fixtures/assert-git-shim.mjs";\n')` must be FALSE.
  With the character-level stripper it is TRUE (the regex's quote opens a "string", the commented
  import survives) — a false NEGATIVE of the install walk, the direction its docstring said was
  impossible. Seen failing before the swap.
- GREEN: `violations`, `installsShim`, `fixtureInstallsShim` use `codeOnly`; the old stripper and its
  docstring's soundness claim go.

### 3. conductor-13's twin guard uses it
- RED: a discrimination test over a pure `callsArchiveGate(code)`: `x(); // archiveGate(` must not
  satisfy it — `codeLines()` keeps a trailing comment, so it does.
- GREEN: `engineCode("scripts/lib/update-epic.mjs")`; `codeLines()` removed.
- Mutation proof: in a scratch copy, alias the import and call site away — guard goes RED.

### 4. The five sibling strippers
Each replaced by `codeOnly` (line-preserving where a line number is reported). Their own
discrimination/non-vacuity assertions must stay green; any that goes red is a finding, reported.

### 5. The lint — `assert/raw-engine-source-match.test.mjs`
- Walks every `scripts/test/**/*.test.mjs`, lexes it (fail closed), finds each `readFileSync(<arg>)`
  whose argument names the engine (`conductor.mjs`, a `lib` path segment, `ENGINE`, `LIB`, `libDir`;
  not `.md`/`.json`), binds it to the name it initialises, and flags a positive assertion whose subject
  is that name (the NEAREST preceding binding of it, so a re-declared `src` in a later test is judged
  by its own read) or the read inline.
- RED: run it — lists the 21 uses. Discrimination test (samples built from parts so the walk does not
  flag this file): conductor-13's ORIGINAL shape is flagged; `engineCode(…)` is not; a
  `doesNotMatch` is not (against raw source it is the stricter form); a non-engine read is not.
- GREEN: migrate every flagged use to `engineCode`, including `conductor-25:133` by hand. A guard that
  goes RED after migration was satisfied by a comment: that is a real finding, reported, not muted.
- Mutation proof: revert conductor-13's migration in a scratch copy → the lint goes red.
- **Inverse / sanctioned exemption**: none is shipped unless a migrated guard is found that must match
  comment text. If one is found, it gets an explicit, reasoned raw read the lint accepts; otherwise
  there is no exemption to revoke, and that is stated.

### 6. Final-review re-sweep (I4) — every inline stripper, named
Swept with `rg` for `replace\(/\\/\\/`, `replace\(/\\/\\*`, `startsWith\("//"|"/*"|"*"\)`,
`^\s*\/\/`, `\/\/.*`, `\/\/[^` across `scripts/test/**/*.mjs`. Every hit and its disposition:
- MIGRATED to `engineCode`/`codeOnly`: `functional/conductor-13` ×6 (the `startsWith` line skips in
  the outcome/recordedBy, openspec-lane, outstanding-work, lane-literal, verdict-note and deferral
  scans), `functional/conductor-14` (emitter vendor/direction scan), `functional/output-text-integrity`
  ×2 (`stdoutJsonBypasses`, `detourReaderFindings`), `functional/conformance` (exit-handler guard),
  `functional/emitted-invocations` (`printedTemplates`' line skip — not in the review's list, found by
  the broader sweep), `assert/spec-sync-surfaces` (snapshot() slice), `assert/sync-registration-ids`
  (bare-id scan — now reads through `engineCode`, so its line filter is gone), `assert/drift-script`
  (gitRead's GIT_INDEX_FILE scan).
- DELIBERATE EXCLUSIONS: `assert/save-report-surface.test.mjs` `EXEMPT` matches the
  `// save-report: exempt — <reason>` marker, a comment it must read by design (against the raw
  lines); `assert/source-code.test.mjs` asserts the helper's own output has no comment line.
- Mutation (conformance): an exit handler on a line holding `"https://x"` — the old regex strip deleted
  from that `//` to end of line and stayed GREEN; with `engineCode` the guard goes RED.

### 7. EVERY engine-source read in `scripts/test` — the conclusive table

**How it was enumerated.** `rg -n 'readFileSync\(|readFile\(|fs\.promises|promises\.readFile|createReadStream\('
scripts/test` (489 lines; there is no `fs.promises`/`createReadStream` read of engine source anywhere), each
hit classified by its argument; every hit whose path is a VARIABLE was resolved by reading its loop or
caller. Then `rg -n 'engineCode\(|codeOnly\(' scripts/test` for the reads already routed. Reads of docs,
state.json, logs, PROJECT.md, fixtures, temp repos and test files are not engine source and are not
rows. Line numbers are at this commit. **Dispositions:** ROUTED (reads CODE: `engineCode`/`codeOnly`);
ROUTED AT CONSUMER (the raw string is handed to a function that strips it before matching); (b) =
extraction, owned by follow-up epic `engine-source-extraction-vacuity`; LEFT (reason given).

**A. Raw reads that remain (41)**

| # | Read (file:line) | Disposition |
|---|---|---|
| A1 | `functional/output-text-integrity:705` `stdoutJsonBypasses` default `read` | ROUTED AT CONSUMER — `codeOnly(read(rel))` at :709 |
| A2 | `functional/output-text-integrity:729` `mutate()` base text | LEFT — mutant source handed to A1/A4's consumers, which strip it |
| A3 | `functional/output-text-integrity:731` `mutate()` fall-through reader | LEFT — as A2 |
| A4 | `functional/output-text-integrity:829` `detourReaderFindings` default `read` | ROUTED AT CONSUMER — `codeOnly` at :834 |
| A5 | `functional/output-text-integrity:885` subcommands.mjs mutant base | LEFT — as A2 |
| A6 | `functional/output-text-integrity:894` mutant fall-through reader | LEFT — as A2 |
| A7 | `functional/conductor-31:47` `dispatchedVerbs()` | (b) — anchored on the `// ---------- dispatch ----------` marker COMMENT |
| A8 | `functional/verb-surface:67` `dispatchedVerbs()` | (b) — as A7 |
| A9 | `functional/emitted-invocations:30` `dispatchedVerbs()` | (b) — as A7 |
| A10 | `functional/conductor-09:87` dispatch-table extraction | (b) |
| A11 | `functional/conductor-09:257` dispatch-table extraction | (b) |
| A12 | `functional/conductor-13:256` `flagsInUsageLine()` | (b) — extraction from the usage STRING |
| A13 | `functional/conductor-13:1949` `gateReviewUsageFlags()` | (b) — as A12 |
| A14 | `functional/conductor-15:648` | LEFT — NEGATIVE only (`assert.ok(!/key:\s*"recordedBy"/.test(src))`), the stricter form raw |
| A15 | `functional/conductor-15:712` | LEFT — NEGATIVE only (`!src.includes("archiveBackfilledAt")`) |
| A16 | `functional/conductor-39:374` | LEFT — `doesNotMatch` only |
| A17 | `functional/conductor-09:771` `real(rel)` | LEFT — copies engine files into a hook fixture; asserts nothing about their text |
| A18 | `assert/save-report-surface:96` `shippedSites()` | ROUTED AT CONSUMER — call sites found in `stripComments` = `codeOnly` (:47, :55), hand-off matched in `codeOnly` (:78); the raw text only supplies the `// save-report: exempt` marker, a comment by design, and the reported line text |
| A19 | `assert/save-report-surface:108` | LEFT — the deliberate exception: counts `saveState(` in constants.mjs PROSE to prove the stripper strips (named in the lint header) |
| A20 | `assert/conductor-35:42` `dispatchedVerbs()` | (b) — as A7 |
| A21 | `assert/conductor-35:213` | ROUTED AT CONSUMER — `spawnViolations()` strips with `codeOnly` (:179) |
| A22 | `assert/conductor-35:218` | ROUTED AT CONSUMER — `stripComments(...)` = `codeOnly` |
| A23 | `assert/conductor-35:262` USAGE extraction | (b) |
| A24 | `assert/verb-surface:32` `dispatchKeys()` | (b) |
| A25 | `assert/detour-frame-drop:116` `functionSource()` slice | ROUTED AT CONSUMER — every positive check runs on `stripComments(body)` (:134, :136); the slice itself is (b) |
| A26 | `assert/conductor-09:62` `dispatchKeys(…ENGINE)` | (b) |
| A27 | `assert/conductor-09:69` `dispatchKeys(…ENGINE)` | (b) |
| A28 | `assert/emitted-invocations:30` `ENGINE_SRC` for `dispatchedVerbs()` | (b) |
| A29 | `assert/drift-script:256` archive-gate.mjs | LEFT — NEGATIVE precondition (`!/gitOps\(/`) |
| A30 | `assert/conductor-38:110` USAGE extraction | (b) |
| A31 | `assert/conductor-25:232` `dispatchedVerbs()` | (b) — as A7 |
| A32 | `assert/engine-regex-blind-spot:52` | LEFT — the lexer blind-spot sweep; it reads raw source by definition and lexes it itself |
| A33 | `assert/no-inline-exit:123` `engineSources()` | LEFT — NEGATIVE only (`findings == []`), scanned by its own regex-aware `codeMask`, which also masks strings (`codeOnly` does not); its discrimination test pins both |
| A34 | `assert/conductor-29:80` raw lines | ROUTED — literals read from `codeOnly` lines (:81); the raw line supplies only the `pm:not-a-link-type` opt-out, a comment by design |
| A35 | `assert/store-ownership:121` mutation-test fake reader | LEFT — builds a mutant for the discrimination test; the real walk reads `engineCode` (:74) |
| A36 | `assert/conformance:165` | ROUTED — `codeOnly(fs.readFileSync(p), rel)` |
| A37 | `assert/git-gateway-guard:38` `read(p)` | ROUTED — `codeOnly(fs.readFileSync(p), p)` |
| A38 | `assert/support-floor:132` (`scripts/conductor.mjs` among the floor copies) | LEFT — deliberately reads the "Node 22+" support-floor copy, which in conductor.mjs is a header COMMENT (:77); its subject is prose |
| A39 | `sweeps/output-interpolations.test:13` and `sweeps/output-interpolations.mjs:479` | LEFT — consumed by `lex()`, which skips comments |
| A40 | `certification.mjs:43` / `:259` (and `assert/drift-script:50`, which feeds it) | LEFT — the functional-subject derivation; strips with `js-lexer.stripComments` and fails closed |
| A41 | `fixtures/source-code.mjs:51` | the reader itself — `engineCode()` |

**B. Reads routed through `engineCode`/`codeOnly` (53)**

| # | Read (file:line) |
|---|---|
| B1–B4 | `functional/output-text-integrity:185, 641, 668, 801` |
| B5 | `functional/conformance:471` |
| B6 | `functional/tool-currency:309` |
| B7–B10 | `functional/commit-resolution:380, 381, 411, 414` |
| B11 | `functional/git-gateway-guard:62` (`sourceOf`, every call site) |
| B12 | `functional/emitted-invocations:2816` |
| B13–B14 | `functional/conductor-14:560, 568` |
| B15 | `functional/git-gateway-double:242` |
| B16 | `functional/conductor-31:213` |
| B17 | `functional/verb-surface:274` |
| B18–B24 | `functional/conductor-13:525, 600, 819, 928, 1017, 1428, 1878` |
| B25 | `functional/conductor-27:281` |
| B26–B27 | `functional/conductor-18:179, 180` |
| B28 | `assert/no-inline-exit:150` |
| B29–B30 | `assert/conductor-35:122, 123` |
| B31 | `assert/spec-sync-surfaces:193` |
| B32–B33 | `assert/sync-registration-ids:47, 127` |
| B34 | `assert/output-text-integrity:37` |
| B35 | `assert/conductor-13:62` |
| B36 | `assert/spec-sync-index:34` |
| B37–B38 | `assert/tool-currency:52, 71` |
| B39–B40 | `assert/conductor-38:76, 140` |
| B41 | `assert/gate-guard-write-paths:52` |
| B42 | `assert/nullable-clearing:112` |
| B43 | `assert/conductor-06:123` |
| B44 | `assert/commit-resolution:60` |
| B45 | `assert/render-byte-parity:59` |
| B46 | `assert/store-ownership:74` |
| B47 | `assert/conductor-25:133` |
| B48 | `assert/conductor-23:242` |
| B49–B51 | `assert/conductor-29:37, 81, 112` |
| B52 | `assert/detour-frame-drop:111` (`stripComments` = `codeOnly`) |
| B53 | `assert/save-report-surface:47, 78` |

**Not engine source, and therefore not rows** (hits the classifier might mistake for one):
`functional/certify-index:386, 397` (text inside a sample test file's source string), `functional/drift-script:96`
(a temp repo's copy), `functional/conductor-14:1113` and `assert/conductor-09:63, 70` (docs reached through
`path.dirname(ENGINE)`), `assert/git-gateway-double:82` (a test file), `assert/drift-script:274, 311` and
`:292` (drift.mjs, test machinery).

**Mutation proofs for this round** (each replaces real engine code with a comment naming it; GREEN
before, RED after; restored): commit-resolution g2-M17 functional and assertion twin (git-gateway.mjs:101
env → comment), spec-sync-index maxBuffer (:115), conductor-06 `LC_ALL: "C"` (:184), commit-resolution
g2-3 ordering (git.mjs:228 guard → comment), output-text-integrity 5.3f builders floor (archive-gate.mjs:228
`orNoRemedy(` → comment). Reading the builders scan as code also exposed a REAL comment dependency: the
derived population reached `obligationRemedy` only through the JSDoc after it naming `archiveGate()`; the
derivation now follows a declaration that reads a builder TABLE (ALL_CAPS) by name, which is the path
the code actually takes.

## Required task items (CLAUDE.md "The gate procedure")
- **Call-site sweep**: done mechanically above (rg for strippers; the lint prototype for raw reads).
  The lint's STATED LIMITS, each named rather than silently uncovered: (a) a read whose path is a
  variable (`path.join(REPO, rel)` — `conductor-25:132`, `conductor-35:213/218`,
  `emitted-invocations:82–127`, `store-ownership`, …); (b) a value DERIVED from the raw source
  (`src.slice(…)`, an extraction regex) and then matched; (c) the lexer's own `)`/`}`-then-regex
  blind spot. `doesNotMatch` against raw source is deliberately not flagged.
- **Inverses**: the helper has no write; the lint's inverse is an exemption, handled in task 5.
- **Verify against the commit**: `git show --stat <sha>` per task, every claimed file present.
- **Out of scope, named for the orchestrator**: the other half of the epic's title — silent drift, an
  extraction regex that matches NOTHING after the engine reshapes (the dispatch-table readers) — is a
  vacuity problem a match lint cannot see. Each such reader already carries its own non-vacuity
  assertion; a general guard for it is separate work.
