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

### 7. Final re-review — the CLASS of helpers that return engine source
Derived mechanically: every `readFileSync`/`readFile` in `scripts/test/**/*.mjs` that sits inside a
named function or arrow helper and whose argument names the engine or a caller-supplied path (a
scan over `codeOnly()` text, two passes: helper bodies, then each read's nearest enclosing header).
Every hit, and the disposition of the call sites that feed a POSITIVE assertion:

| Helper (file:line) | Reads | Disposition |
|---|---|---|
| `functional/git-gateway-guard:58 sourceOf(rel)` | engine | ROUTED — `engineCode(rel)`; `:136`'s `assert.match(sourceOf(rel), /gitOps\(\)/)` was GREEN with commit-watch.mjs:72 replaced by a comment, RED now |
| `assert/git-gateway-guard:36 read(p)` | engine | ROUTED — `codeOnly`; the twin now carries the same `gitOps()` check plus a comment discrimination |
| `assert/detour-frame-drop:115 functionSource(file, name)` | engine slice | ROUTED — `:134`'s `assert.match(body, /verb: "drop-detour"/)` now matches `codeOnly(body)`; the slice itself is limit (b) |
| `assert/store-ownership:73 mutationSites(read)` | engine | ROUTED — default reader is `engineCode`; feeds the `inStore.length >= 10` / `files.size >= 4` floors |
| `assert/conductor-29:72 linkTypeLiterals()` | engine | ROUTED — literals read from `codeOnly` lines (the opt-out marker, a comment, from the raw line); feeds `literals.length > 0`. Also `:106`, an inline `assert.match(fs.readFileSync(abs), …)` through a variable path (lint limit (a)), now `engineCode` |
| `assert/no-inline-exit:120 engineSources()` + `:42 codeMask(src)` | engine | EXCLUDED — feeds only the NEGATIVE `findings == []`; `codeMask` is a regex-aware tokenizer that masks strings as well as comments, which `codeOnly` does not. Its own discrimination test pins both |
| `assert/conductor-25:231`, `assert/conductor-35:41`, `functional/conductor-31:45`, `functional/emitted-invocations:29`, `functional/verb-surface:65` `dispatchedVerbs()`; `assert/verb-surface:31 dispatchKeys()`; `assert/conductor-09:58/65` and `functional/conductor-09:87/257` `dispatchKeys(fs.readFileSync(ENGINE))` | engine | LIMIT (b) — extraction anchored on the `// ---------- dispatch ----------` marker COMMENT and the dispatch object; the positive checks run over the extracted set. Owned by `engine-source-extraction-vacuity` |
| `functional/conductor-13:255 flagsInUsageLine()`, `:1948 gateReviewUsageFlags()` | engine usage STRING | LIMIT (b) — extraction from a string literal, owned by `engine-source-extraction-vacuity` |
| `functional/output-text-integrity:722 mutate(rel, …)` | engine | EXCLUDED — builds mutant sources handed to `stdoutJsonBypasses`/`detourReaderFindings`, which apply `codeOnly` themselves |
| `sweeps/output-interpolations.test:13 source(rel)`, `sweeps/output-interpolations.mjs:479` | engine | EXCLUDED — consumed by `lex()` itself, which skips comments |
| `functional/conductor-09:771 real(rel)` | engine | EXCLUDED — copies files into a hook fixture; asserts nothing about their text |
| `assert/drift-script:50 readFile(p)`, `certification.mjs:43/259`, `certify.mjs:318` | any tracked file | EXCLUDED — the functional-subject derivation, which strips comments with `js-lexer` itself |
| `assert/autonomy-revocation:45`, `assert/conductor-16:59`, `assert/conductor-28:21`, `assert/conductor-34:15` `shipped*(rel)`; `functional/emitted-invocations:2665 readDoc`, `:52 shippedDocs` | docs only | NOT ENGINE — every call site passes a `.md`/`.json` path |
| the remaining hits (state.json, logs, PROJECT.md, fixtures, tmp repos) | not engine | NOT ENGINE |

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
