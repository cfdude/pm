# Lesson `detect:` matcher hardening — implementation plan

> **For agentic workers:** executed inline by one implementer in an isolated worktree (the 0.50.0
> brief forbids subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Epics:** `lesson-detect-matcher-hardening` (code review 0.43.0, C1/C2) and `gh-cfdude-pm-194`
(issue #194). One plan, because both live on one surface: `scripts/lib/lessons.mjs`
(`matchableLessons`, `matchLessons`, `lessonAdvice`).

**Goal:** a lesson's `detect:` either works or is REJECTED WITH A NAMED REASON — never silently
inert, never matching everything, and never able to stall a tool call beyond a fixed budget.

**Architecture:** one classifier, and the hook is a projection of it. `checkDetect(raw)` is a pure
validator returning a verdict; `classifyLessons(dir)` reads the corpus and sorts every lesson into
`matchable` / `rejected` (with reason) / `retrievalOnly`; `matchableLessons(dir)` is
`classifyLessons(dir).matchable`, so the hook and every reporter read the same verdict. Regexes are
compiled once at classification; at match time they run inside one `node:vm` context per hook
invocation with a TOTAL time budget, against a length-capped first line.

**Tech stack:** Node built-ins only (`node:fs`, `node:path`, `node:vm`). `node:vm` is new to this
module; the engine already imports `node:crypto` and `node:tty`, and no test pins an import
allowlist (checked: `rg "node:(vm|crypto|tty)" scripts/test`), so the zero-runtime-dependency
constraint holds unchanged.

## Measured facts this plan rests on (2026-09-25, this worktree)

- `hooks/hooks.json` gives the `lesson-advice` entry **no `timeout`**, so Claude Code's default
  command-hook timeout (60 s) applies — the finding's "~60 s" is that timeout killing the process.
  Every Bash/Edit/Write/NotebookEdit call waits for this hook.
- `vm.runInContext("re.test(s)", ctx, {timeout})` interrupts a catastrophic regex: `^(a+)+$` on
  31 `a`s + `!` threw `ERR_SCRIPT_EXECUTION_TIMEOUT` at 205 ms (Node 26.10.0) and 222 ms (Node
  20.19.4, older than the Node 22 floor). Context creation ≈ 2 ms; ten benign tests ≈ 2 ms.
- A static check cannot be the whole answer: `^(a|a)*$` (no nested quantifier) took 6.7 s on 24
  characters, and **pm's own shipped matcher** in `filter-at-read-time-not-at-capture-time`
  (`(?:>&|&>|[^|;&])*…`) did not finish on `git commit ` + `>&>` × 1300 (killed after > 100 s).
  Alternation overlap is not statically decidable here; the runtime budget is load-bearing.
- Six of the twelve `detect:` lessons in `docs/lessons/` are bare regexes (JSON.parse fails) — the
  #194 list. The `lessons-index` test grandfathers them in `INERT_PENDING_194`.

## Global constraints

- Engine: Node built-ins only; no npm package.
- The hook stays SILENT (no stdout unless a lesson matches), exits 0 always, and never writes.
- Hook latency: the whole regex phase is bounded by `REGEX_BUDGET_MS = 100` per invocation, and
  the matched text by `MATCH_TEXT_CAP = 4096` characters. When the budget is spent, remaining
  regex predicates count as NOT matched (advice is lost; the tool call is not delayed).
- Stay inside `scripts/lib/lessons.mjs`, the lessons tests and `docs/lessons/` (plus the user docs
  that describe the `detect:` contract). No other `scripts/lib` file is touched.
- No conductor write verbs; changelog text only in `.changesets/<epic-id>.md`.

## The `detect:` contract after this change (what `checkDetect` enforces)

| Rule | Rejection reason (abridged) |
|---|---|
| `detect:` present but empty | `detect: is empty` |
| value is valid JSON | `detect: is not JSON (…)` — the six bare-regex lessons |
| a plain object (not null, array, scalar) | `detect: must be a JSON object, got <type>` |
| keys ⊆ `tool`, `pathEndsWith`, `commandMatches`, `commandLacks` | `unknown key "commandMatch" …` — C2's `ls` repro |
| every value a non-empty string | `"tool" must be a non-empty string, got array` |
| `tool` ∈ `ADVISED_TOOLS` = Bash, Edit, Write, NotebookEdit (pinned equal to `hooks.json`) | `tool "Read" is never sent to the hook` |
| at least one POSITIVE predicate (`pathEndsWith` or `commandMatches`) | `no pathEndsWith or commandMatches — it would fire on every call` |
| `commandMatches`/`commandLacks` only when `tool` is Bash or absent | `only Bash carries a command` |
| `pathEndsWith` only when `tool` is not Bash | `a Bash call carries no path` |
| not `pathEndsWith` + `commandMatches` together | `no tool call carries both a path and a command` |
| every regex compiles | `"commandMatches" is not a valid regex: …` |
| no C0 control character in a regex (JSON `\b` decodes to U+0008) | `contains control character U+0008 — write \\b in JSON` |
| no unbounded quantifier nested in an unbounded-quantified group | `nests an unbounded quantifier — "(a+)+" backtracks catastrophically` |

Also: frontmatter is found after normalising CRLF to LF (C1: `/^---\n/` made every CRLF lesson
inert), and `pathEndsWith` reads `tool_input.notebook_path` when `file_path` is absent (NotebookEdit
sends `notebook_path`, so a `NotebookEdit` path matcher was inert).

## Where rejects are reported — the decision

**The hook stays silent. The per-commit `lessons-index` test is the reporter for this repository,
and `classifyLessons()` is the exported reader any future surface calls.**

- *Why not the hook:* an advisor that prints on a malformed corpus would print on every tool call,
  which is the 7-in-8 noise the module header forbids; and failing it is a gate nobody agreed to.
- *Why the test:* it is recall-free — it runs on every commit through the pre-commit hook without
  anyone remembering to run it (the module header measures recall at ~20% effective), and it
  needs no edit outside the lessons surface. It fails naming each lesson and its reason.
- *Why not a verb, now:* a new verb touches the dispatch table, the flag registry
  (`constants.mjs`), `verb-effects.mjs`, `refusal.mjs`, help, a command doc, the parity ledger
  and a functional test with its twin — six-plus files outside this epic's scope, several of them
  in the path of sibling 0.50.0 epics (the flag-registry and hook-dormancy work).
  *Why not the SessionStart brief:* `subcommands.mjs` is in the path of `hooks-not-silent-before-init`.
- **Stated limitation:** a CONSUMER repository's corpus is still not reported to its author by any
  surface. That half of #194 is filed as a follow-up issue (item 7), and neither changeset fragment
  claims consumers are told.

## Review focus

1. A CRLF-saved lesson (Windows editor, `core.autocrlf`) — must fire exactly like its LF twin.
2. A typo'd key (`commandMatch`) — must never match `ls`; must be named by the classifier.
3. A catastrophic regex that passes the static check (`^(a|a)*$`) — the hook must return well
   under a second and the other lessons must still be evaluated first-come.
4. A very long first line (a 100 kB one-liner) — matched text is capped, the hook stays in budget.
5. JSON `"\b"` in a matcher — decodes to a backspace and silently never matches; must be rejected.

---

### Task 1: the plan (this file)

- [ ] Commit this plan: `docs(plan): lesson detect matcher hardening (#194)`.

### Task 2: one classifier — validate, reject with a reason, accept CRLF

**Files:** Modify `scripts/lib/lessons.mjs`. Create `scripts/test/unit/lesson-detect-rules.test.mjs`
(pure `checkDetect` / `nestedUnboundedQuantifier` verdicts — values, so the unit rung) and
`scripts/test/assert/lesson-detect-corpus.test.mjs` (lesson FILES on disk, through the engine — the
file rung).

**Interfaces — Produces:**
- `export const DETECT_KEYS = ["tool", "pathEndsWith", "commandMatches", "commandLacks"]`
- `export const ADVISED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"]`
- `export function nestedUnboundedQuantifier(src: string): string` — the offending group text, or `""`
- `export function checkDetect(raw: string): {ok: true, detect: object, regex: {commandMatches?: RegExp, commandLacks?: RegExp}} | {ok: false, reason: string}`
- `export function classifyLessons(dir = lessonsDir()): {matchable: Array<{file, rule, detect, regex}>, rejected: Array<{file, reason}>, retrievalOnly: string[]}`
- `matchableLessons(dir)` unchanged in name, now `classifyLessons(dir).matchable`.

- [ ] **Step 1: failing unit tests** — one `unitTest` per row of the contract table above, e.g.

```js
unitTest("a typo'd key is rejected, not a match-everything matcher", () => {
  const v = checkDetect('{"tool":"Bash","commandMatch":"gh pr merge"}');
  assert.equal(v.ok, false);
  assert.match(v.reason, /unknown key "commandMatch"/);
});
unitTest("nested unbounded quantifiers are named; bounded or flat ones are not", () => {
  assert.equal(nestedUnboundedQuantifier("^(a+)+$"), "(a+)+");
  assert.equal(nestedUnboundedQuantifier("(?:\\s+x){2,}"), "(?:\\s+x){2,}");
  assert.equal(nestedUnboundedQuantifier("(^|[;&|]\\s*)git"), "");
  assert.equal(nestedUnboundedQuantifier("(?:>&|&>|[^|;&])*\\|"), "");
  assert.equal(nestedUnboundedQuantifier("[(+]+\\(a+\\)+"), "");   // class and escapes are literal
});
```

  plus every shipped-valid shape (the four existing JSON matchers in `docs/lessons/`) accepted.
- [ ] **Step 2: failing file-rung tests** — through `invokeEngine(["lesson-advice"], …)` in an
  initialised `tmpRepo()`: (a) a CRLF lesson fires; (b) C2 repro — `{"tool":"Bash","commandMatch":"gh pr merge"}`
  plus command `ls` is silence; (c) `classifyLessons(dir)` on a tmp corpus returns each malformed
  lesson in `rejected` with its reason and the good one in `matchable`, and a lesson with no
  `detect:` in `retrievalOnly`; (d) a `NotebookEdit` `pathEndsWith` matcher fires on `notebook_path`.
- [ ] **Step 3:** run both files, save the failing run as `red-task2.txt` next to this plan.
- [ ] **Step 4: implement** — `frontmatterBlock(txt)` normalises `\r\n` → `\n` before
  `/^---\n([\s\S]*?)\n---/`; `detectLine(block)` distinguishes absent (`retrievalOnly`) from present;
  `checkDetect` applies the table in order and compiles each regex once; `classifyLessons` builds
  the three lists; `matchLessons` reads `l.regex` and `file_path || notebook_path`.
- [ ] **Step 5:** both files and `conductor-28` pass; commit `feat(lessons): reject a malformed detect with a named reason (#194)`.

### Task 3: bound the regex phase — a total budget and a capped input

**Files:** Modify `scripts/lib/lessons.mjs`; extend both Task 2 test files.

**Interfaces — Produces:** `export const REGEX_BUDGET_MS = 100`, `export const MATCH_TEXT_CAP = 4096`,
`matchLessons(event, lessons, {budgetMs = REGEX_BUDGET_MS} = {})`.

- [ ] **Step 1: failing tests.** Unit: a lesson compiled from `^(a|a)*$` (passes the static
  check) against 23 `a`s + `!` returns `[]` in under 500 ms (unguarded it takes ~3 s, so the mutant
  FAILS on the assertion rather than hanging), and a benign lesson listed BEFORE it still matches.
  Unit: a 100 000-character first line is matched only up to `MATCH_TEXT_CAP` (a matcher anchored
  `x$` on `"a".repeat(5000) + "x"` does not fire). File rung: the same catastrophic lesson on disk,
  through the hook, exits 0 in under 2 s.
- [ ] **Step 2:** save `red-task3.txt`.
- [ ] **Step 3: implement** — a per-invocation tester: lazily one `vm.createContext({})`, a
  deadline of `now + budgetMs`, and `vm.runInContext("re.test(s)", ctx, {timeout: remaining})`;
  a timeout or an exhausted deadline returns "no match". `cmdLine` is `.slice(0, MATCH_TEXT_CAP)`.
- [ ] **Step 4:** green; commit `fix(lessons): a catastrophic detect regex can no longer stall a tool call`.

### Task 4: pm's own corpus passes the new rules, and the index test reports rejects

**Files:** Modify `scripts/test/assert/lessons-index.test.mjs`, six lessons, `docs/lessons/README.md`.

- [ ] **Step 1: failing test** — replace the `INERT_PENDING_194` test and its companion with:
  `classifyLessons(DIR).rejected` deep-equals `[]` (message lists `file: reason`); the README's 🔔
  column names exactly `classifyLessons(DIR).matchable`; `ADVISED_TOOLS` equals the lesson-advice
  matcher in `hooks/hooks.json` split on `|`. Save `red-task4.txt` (six rejects + 🔔 mismatch).
- [ ] **Step 2: fix the six** (each judged on precision, per the module header):
  - `second-resolution-timestamps-…`, `a-fixture-reconstructed-…` — their regexes match SOURCE TEXT
    being written, which no `detect` key can see. Remove `detect:`; retrieval-only by design.
  - `cite-a-symbol-not-a-line-number` → `{"tool":"Bash","commandMatches":"--(reason|notes|description)[ =]\"[^\"]*\\b[a-z0-9_.-]+\\.(mjs|md|json|py|ts):[0-9]+"}`
  - `an-unused-active-pointer-…` → `{"tool":"Bash","commandMatches":"(conductor\\.mjs|\\$\\{?ENGINE\\}?)\"? (release|update-epic) .*--(member|status archived)"}` (pm's own docs invoke the engine as `"$ENGINE"`, so the literal `conductor\.mjs` alone would stay near-inert).
  - `stacked-background-commits-…` → `{"tool":"Bash","commandMatches":"(^|[;&|]\\s*)git commit\\b.*[^&]&\\s*$"}` — the `&`-backgrounded half; `run_in_background` is a tool_input field no key reads, so that half stays a habit (said in `enforced_in`).
  - `a-silent-noop-edit-reports-success` → `{"tool":"Bash","commandMatches":"(^|[;&|]\\s*)sed -i"}` — the in-place `sed` half; `str.replace` in a script is source text, so it stays a habit (said in `enforced_in`).
- [ ] **Step 3:** README — replace the ⚠️ "six retrieval-only by accident" paragraph with what the
  classifier now guarantees; add 🔔 to the four converted rows; update their enforced-in rows.
- [ ] **Step 4:** green; commit `fix(lessons): pm's own inert detect matchers work or are removed (#194)`.

### Task 5: user docs, changesets, required items

- [ ] `skills/lessons/SKILL.md` §`detect:` — the table gains the rules above; replace "skipped for
  itself alone" with "rejected with a reason, reported by `classifyLessons()`"; state the budget.
- [ ] `README.md` hook row — one sentence: malformed matchers are rejected, the regex phase is bounded.
- [ ] `.changesets/lesson-detect-matcher-hardening.md` and `.changesets/gh-cfdude-pm-194.md`.
- [ ] Item 7 outcomes recorded below; commit `docs(lessons): the detect contract states its rejects and its budget`.

---

## Required item 1 — call-site sweep (derived with `rg`, 2026-09-25)

`rg -n "matchLessons|matchableLessons|classifyLessons|checkDetect|lessonAdvice|adviceText|lessonsDir" scripts hooks`:

| Caller | Rule holds? |
|---|---|
| `scripts/conductor.mjs` dispatch `"lesson-advice": lessonAdvice` | yes — the hook path; `lessonAdvice` → `matchableLessons` → classifier; `matchLessons` bounded |
| `lessonAdvice` → `matchLessons(event, lessons)` (only production caller) | yes |
| `scripts/test/assert/lessons-index.test.mjs` | yes after Task 4 — it calls `classifyLessons`; its own `/^---\n/` survives only in the contract-fields test, which reads pm's LF corpus (not an engine path) |
| `scripts/test/assert/conductor-28.test.mjs`, `output-text-integrity` (functional), `verb-surface` (functional) | exercise the hook end to end; unchanged behaviour for valid matchers |
| `scripts/lib/gate-guard.mjs` (comment only: the second reader of the PreToolUse payload) | not a caller; its own regex matching is outside this epic's scope |

**Data references:** a lesson's `detect` holds no record id. `classifyLessons` output is computed on
every call and never stored — nothing to write, read back, or remove.

**Inverses:** *reject* ↔ *accept*: a rejected lesson becomes matchable again the moment its
frontmatter is fixed (no cache, no state). *budget exhausted* ↔ *restored*: per invocation, nothing
persists. No inverse is withheld.

## Required item 7 — what the work taught (filled at Task 5)

See the section appended by Task 5.
