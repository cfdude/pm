// scripts/test/unit/lesson-detect-rules.test.mjs
// The `detect:` contract as VALUES: what checkDetect() accepts, what it rejects and the reason it
// names, and what the regex phase of matchLessons() may cost. Pure functions over strings and
// already-classified lessons — no corpus on disk, which is the file rung's
// (assert/lesson-detect-corpus.test.mjs).
//
// Code review 0.43.0 (C1, C2) and #194. Before this, a matcher that could not work was discarded
// silently (six of pm's own twelve), a typo'd key applied no predicate and so matched EVERY tool
// call, and a catastrophic regex held every Bash/Edit call for the hook's 60 s timeout.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  ADVISED_TOOLS, DETECT_KEYS, MATCH_TEXT_CAP, REGEX_BUDGET_MS, REGEX_CEILING_MS,
  boundedRegexTest, checkDetect, frontmatterBlock, matchLessons, nestedUnboundedQuantifier,
} from "../../lib/lessons.mjs";

const rejected = (raw, re) => {
  const v = checkDetect(raw);
  assert.equal(v.ok, false, `expected a reject for ${raw}`);
  assert.match(v.reason, re);
};

/** A lesson as classifyLessons() would produce it, from a detect JSON string. */
function lessonOf(file, raw, rule = file) {
  const v = checkDetect(raw);
  assert.ok(v.ok, `${file}: ${v.reason}`);
  return { file, rule, detect: v.detect, regex: v.regex };
}

unitTest("the contract names four keys and the four tools the hook is wired to", () => {
  assert.deepEqual(DETECT_KEYS, ["tool", "pathEndsWith", "commandMatches", "commandLacks"]);
  assert.deepEqual(ADVISED_TOOLS, ["Bash", "Edit", "Write", "NotebookEdit"]);
});

unitTest("every matcher shape pm ships is accepted", () => {
  for (const raw of [
    '{"tool":"Bash","commandMatches":"(^|[;&|]\\\\s*)/pm:"}',
    '{"tool":"Edit","pathEndsWith":"CLAUDE.md"}',
    '{"tool":"Bash","commandMatches":"gh pr merge .*--squash"}',
    '{"tool":"Bash","commandMatches":"^git commit","commandLacks":"--\\\\s"}',
    '{"tool":"Bash","commandMatches":"(^|[;&|]\\\\s*)(node --test|npm (run )?test|pytest|git commit)(?:>&|&>|[^|;&])*\\\\|\\\\s*(tail|head|grep|rg)\\\\b"}',
    '{"commandMatches":"git worktree add"}',
  ]) {
    const v = checkDetect(raw);
    assert.ok(v.ok, `${raw}: ${v.reason}`);
  }
});

unitTest("an empty or non-JSON detect is rejected — the six bare-regex lessons of #194", () => {
  rejected("", /empty/);
  rejected("(str\\.replace|sed -i)", /not JSON/);
  rejected("{not json", /not JSON/);
});

unitTest("a detect that is not a plain object is rejected, naming what it is", () => {
  rejected("null", /must be a JSON object, got null/);
  rejected("7", /must be a JSON object, got number/);
  rejected('["Bash"]', /must be a JSON object, got array/);
});

unitTest("a typo'd key is rejected, not a match-everything matcher (C2)", () => {
  rejected('{"tool":"Bash","commandMatch":"gh pr merge"}', /unknown key "commandMatch"/);
});

unitTest("every value must be a non-empty string — a tool array is rejected", () => {
  rejected('{"tool":["Bash","Edit"],"commandMatches":"x"}', /"tool" must be a non-empty string, got array/);
  rejected('{"tool":"Bash","commandMatches":""}', /"commandMatches" must be a non-empty string/);
  rejected('{"tool":"Edit","pathEndsWith":7}', /"pathEndsWith" must be a non-empty string, got number/);
});

unitTest("a tool the hook is never sent is rejected", () => {
  rejected('{"tool":"Read","pathEndsWith":"x.md"}', /tool "Read" is never sent to the hook/);
});

unitTest("a matcher with no positive predicate would fire on every call and is rejected", () => {
  rejected("{}", /no pathEndsWith or commandMatches/);
  rejected('{"tool":"Bash"}', /no pathEndsWith or commandMatches/);
  rejected('{"tool":"Bash","commandLacks":"x"}', /no pathEndsWith or commandMatches/);
});

unitTest("a predicate its tool can never satisfy is rejected", () => {
  rejected('{"tool":"Edit","commandMatches":"x"}', /only Bash carries a command/);
  rejected('{"tool":"Write","pathEndsWith":"a","commandLacks":"x"}', /only Bash carries a command/);
  rejected('{"tool":"Bash","pathEndsWith":"x.md"}', /a Bash call carries no path/);
  rejected('{"pathEndsWith":"x.md","commandMatches":"y"}', /no tool call carries both a path and a command/);
  // commandLacks beside a path is inert: a call with a path carries no command to suppress on.
  rejected('{"pathEndsWith":"x.md","commandLacks":"y"}', /no tool call carries both a path and a command/);
});

unitTest("a lesson with a command predicate but no compiled regex never matches — it fails closed", () => {
  // A caller handing matchLessons() plain { detect } objects rather than classifyLessons() entries
  // must not skip the regex checks: that would fire the lesson on every call to its tool.
  const bare = { file: "bare.md", rule: "r", detect: { tool: "Bash", commandMatches: "^git" } };
  assert.deepEqual(matchLessons({ tool_name: "Bash", tool_input: { command: "ls" } }, [bare]), []);
  assert.deepEqual(matchLessons({ tool_name: "Bash", tool_input: { command: "git status" } }, [bare]), []);
  const noLacks = {
    file: "lacks.md", rule: "r",
    detect: { tool: "Bash", commandMatches: "^git", commandLacks: "--dry-run" },
    regex: { commandMatches: /^git/ },
  };
  assert.deepEqual(matchLessons({ tool_name: "Bash", tool_input: { command: "git push --dry-run" } }, [noLacks]), []);
});

unitTest("frontmatterBlock is the one frontmatter reader, and it accepts CRLF", () => {
  assert.equal(frontmatterBlock("---\r\nrule: x\r\ndetect: {}\r\n---\r\nBody\r\n"), "rule: x\ndetect: {}");
  assert.equal(frontmatterBlock("---\nrule: x\n---\n"), "rule: x");
  assert.equal(frontmatterBlock("no frontmatter"), null);
});

unitTest("a regex that does not compile is rejected with the engine's reason", () => {
  rejected('{"tool":"Bash","commandMatches":"["}', /"commandMatches" is not a valid regex/);
  rejected('{"tool":"Bash","commandMatches":"x","commandLacks":"(("}', /"commandLacks" is not a valid regex/);
});

unitTest("a control character in a regex is rejected — JSON's \\b is a backspace, not a word boundary", () => {
  rejected('{"tool":"Bash","commandMatches":"git\\bcommit"}', /control character U\+0008/);
});

unitTest("a nested unbounded quantifier is rejected before it can reach the hook", () => {
  rejected('{"tool":"Bash","commandMatches":"^(a+)+$"}', /nests an unbounded quantifier.*\(a\+\)\+/);
});

unitTest("nestedUnboundedQuantifier names only a repeated group whose whole body is one repeated atom", () => {
  // The unambiguous catastrophic shape: nothing delimits one repetition from the next.
  assert.equal(nestedUnboundedQuantifier("^(a+)+$"), "(a+)+");
  assert.equal(nestedUnboundedQuantifier("(\\s*)*"), "(\\s*)*");
  assert.equal(nestedUnboundedQuantifier("x([a-z]+)*y"), "([a-z]+)*");
  assert.equal(nestedUnboundedQuantifier("(?:\\d+)+"), "(?:\\d+)+");
  assert.equal(nestedUnboundedQuantifier("(a+?){2,}"), "(a+?){2,}");
  // Review minor 3: a DELIMITED repetition is linear and must not be rejected — this matcher
  // takes about 0.02 ms on 4 KB. The per-regex budget, not this check, covers what it misses.
  assert.equal(nestedUnboundedQuantifier("^git (\\S+\\s+)*--no-verify"), "");
  assert.equal(nestedUnboundedQuantifier("(?:\\s+x){2,}"), "");
  assert.equal(nestedUnboundedQuantifier("((a)*b)*"), "");
  assert.equal(nestedUnboundedQuantifier("(x(?:y+))*"), "");
  assert.equal(nestedUnboundedQuantifier("(a+){2,5}"), "");
  assert.equal(nestedUnboundedQuantifier("(a+)?"), "");
  assert.equal(nestedUnboundedQuantifier("(^|[;&|]\\s*)git"), "");
  assert.equal(nestedUnboundedQuantifier("(?:>&|&>|[^|;&])*\\|"), "");
  assert.equal(nestedUnboundedQuantifier("[(+]+\\(a+\\)+"), "");
  assert.equal(nestedUnboundedQuantifier("(?<name>a)+(?=b+)"), "");
});

unitTest("a NotebookEdit path matcher reads notebook_path, the field that tool sends", () => {
  const nb = lessonOf("nb.md", '{"tool":"NotebookEdit","pathEndsWith":".ipynb"}');
  const event = { tool_name: "NotebookEdit", tool_input: { notebook_path: "/x/a.ipynb" } };
  assert.deepEqual(matchLessons(event, [nb]).map(h => h.file), ["nb.md"]);
});
// ─────────────── the regex phase is bounded (C1) ───────────────

// THE REAL vm WATCHDOG, asserted as a VALUE. Load can only DELAY a `null` from a runaway; it cannot
// turn one into an answer, so nothing here reads the clock. Never assert a benign regex's HIT through
// the real runner at a small timeout: the watchdog is wall-clock, and a starved machine interrupts
// `^a` too — that is exactly how the old wall-clock tests flaked.

unitTest("a catastrophic regex the static check cannot see is cut off by the real vm timeout", () => {
  // `^(a|a)*$` nests nothing, so checkDetect accepts it. Unguarded it runs for seconds on this input
  // and then answers `false` — so a no-timeout mutant FAILS on the value rather than hanging the
  // run, however slow the machine.
  assert.equal(boundedRegexTest(/^(a|a)*$/, "a".repeat(25) + "!", 20), null);
  // The context survives an interrupt: the next call through it still answers.
  assert.equal(boundedRegexTest(/^a/, "abc", 60_000), true);
  assert.equal(boundedRegexTest(/^b/, "abc", 60_000), false);
});

unitTest("through the hook's real defaults, a runaway lesson never fires", () => {
  const bad = lessonOf("z-bad.md", '{"tool":"Bash","commandMatches":"^(a|a)*$"}');
  const event = { tool_name: "Bash", tool_input: { command: "a".repeat(25) + "!" } };
  assert.deepEqual(matchLessons(event, [bad]), []);
});

// ─────────────── how the budget is ALLOCATED — a fake clock, not the machine's ───────────────
// These assert the GRANTS each regex receives, never elapsed time: the wall-clock versions failed
// under machine load (lesson-budget-tests-flake-under-load — reproduced 1/10 at load ~150, the
// benign lesson's own 50 ms vm watchdog firing while the test was descheduled).

const RUNAWAY = "^(a|a)*$";
const AAA = { tool_name: "Bash", tool_input: { command: "a".repeat(25) + "!" } };

/** A clock that moves only when the fake runner says so, and a runner that records each grant: a
 *  runaway spends its whole grant and returns null (out of time); anything else answers at once. */
function fakeRegexPhase() {
  let t = 0;
  const grants = [];
  const runRegex = (re, text, timeoutMs) => {
    grants.push(timeoutMs);
    if (re.source === RUNAWAY) { t += timeoutMs; return null; }
    return re.test(text);
  };
  return { grants, now: () => t, runRegex };
}

unitTest("a runaway lesson listed FIRST cannot silence a benign lesson after it — each regex has its own budget", () => {
  const f = fakeRegexPhase();
  const bad = lessonOf("a-bad.md", `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`);
  const good = lessonOf("z-good.md", '{"tool":"Bash","commandMatches":"^a"}');
  const hits = matchLessons(AAA, [bad, good], { budgetMs: 50, ceilingMs: 1000, now: f.now, runRegex: f.runRegex });
  assert.deepEqual(f.grants, [50, 50], "each regex is granted its own per-regex budget");
  assert.deepEqual(hits.map(h => h.file), ["z-good.md"]);
});

unitTest("budget allocation at the hook's DEFAULTS: REGEX_BUDGET_MS per regex, under REGEX_CEILING_MS", () => {
  // No budgetMs/ceilingMs passed — this is the wiring the hook runs with.
  const f = fakeRegexPhase();
  const bad = lessonOf("a-bad.md", `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`);
  const good = lessonOf("z-good.md", '{"tool":"Bash","commandMatches":"^a"}');
  const hits = matchLessons(AAA, [bad, good], { now: f.now, runRegex: f.runRegex });
  assert.deepEqual(f.grants, [REGEX_BUDGET_MS, REGEX_BUDGET_MS]);
  assert.deepEqual(hits.map(h => h.file), ["z-good.md"]);
  const g = fakeRegexPhase();
  const many = Array.from({ length: 30 }, (_, i) => lessonOf(`bad-${i}.md`, `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`));
  matchLessons(AAA, many, { now: g.now, runRegex: g.runRegex });
  assert.equal(g.grants.reduce((a, b) => a + b, 0), REGEX_CEILING_MS, "the default ceiling bounds the phase");
});

unitTest("the DEFAULT clock is a real one: time a runaway spends is taken off what the next may use", () => {
  // The real clock under load can only make a later grant SMALLER or stop the phase early, so this
  // asserts in that direction alone — never an exact grant, never an elapsed time. A frozen default
  // clock grants the same budget forever and fails.
  const grants = [];
  const spin = (re, text, timeoutMs) => {
    grants.push(timeoutMs);
    const until = performance.now() + timeoutMs;
    while (performance.now() < until) { /* spend the grant on the real clock */ }
    return null;
  };
  const bads = Array.from({ length: 3 }, (_, i) => lessonOf(`bad-${i}.md`, `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`));
  matchLessons(AAA, bads, { budgetMs: 30, ceilingMs: 50, runRegex: spin });
  // No exact first grant either: a pause of 20 ms before it (ceiling 50 − budget 30) clips it.
  assert.ok(grants.every(g => g <= 30), `no grant exceeds the budget; grants were ${JSON.stringify(grants)}`);
  assert.ok(grants.length < 3 && (grants.length < 2 || grants[1] < 30),
    `the ceiling must bind on the real clock; grants were ${JSON.stringify(grants)}`);
});

unitTest("budget allocation: the per-call ceiling clips the last grant and stops the phase", () => {
  const f = fakeRegexPhase();
  const bads = Array.from({ length: 3 }, (_, i) => lessonOf(`bad-${i}.md`, `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`));
  assert.deepEqual(matchLessons(AAA, bads, { budgetMs: 50, ceilingMs: 120, now: f.now, runRegex: f.runRegex }), []);
  assert.deepEqual(f.grants, [50, 50, 20]);

  const g = fakeRegexPhase();
  const twelve = Array.from({ length: 12 }, (_, i) => lessonOf(`bad-${i}.md`, `{"tool":"Bash","commandMatches":"${RUNAWAY}"}`));
  assert.deepEqual(matchLessons(AAA, twelve, { budgetMs: 300, ceilingMs: 100, now: g.now, runRegex: g.runRegex }), []);
  assert.deepEqual(g.grants, [100], "once the ceiling is spent no further regex is run at all");
  assert.ok(REGEX_CEILING_MS >= REGEX_BUDGET_MS);
});

unitTest("budget allocation: a suppression regex that runs out of budget suppresses", () => {
  const f = fakeRegexPhase();
  const l = lessonOf("lacks.md", `{"tool":"Bash","commandMatches":"^a","commandLacks":"${RUNAWAY}"}`);
  assert.deepEqual(matchLessons(AAA, [l], { budgetMs: 50, ceilingMs: 1000, now: f.now, runRegex: f.runRegex }), []);
  assert.deepEqual(f.grants, [50, 50], "the suppression regex WAS run, and ran out");
});

unitTest("a delimited repetition is accepted as a matcher (review minor 3)", () => {
  const v = checkDetect('{"tool":"Bash","commandMatches":"^git (\\\\S+\\\\s+)*--no-verify"}');
  assert.ok(v.ok, v.reason);
});

// 28.1 and 28.2 (moved from assert/conductor-28.test.mjs): matcher SEMANTICS, so the budget is
// given a value that cannot bind — a benign hit through the real 50 ms watchdog flakes under load.
const NO_BUDGET = { budgetMs: 60_000, ceilingMs: 60_000 };
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

unitTest("28.1 commandMatches fires on a Bash command, and commandLacks suppresses the safe form", () => {
  const l = lessonOf("git-commit.md", '{"tool":"Bash","commandMatches":"^git commit","commandLacks":"--\\\\s"}');
  assert.deepEqual(matchLessons(bash("git commit -m 'x'"), [l], NO_BUDGET).map(h => h.file), ["git-commit.md"]);
  // commandLacks is the suppression half: the explicit-pathspec form is the safe one.
  assert.deepEqual(matchLessons(bash("git commit -- a.mjs"), [l], NO_BUDGET), []);
});

unitTest("28.2 only the command's FIRST LINE is matched — a heredoc body is data, not a command", () => {
  // UNANCHORED on purpose. An anchored `^git commit` cannot tell the two implementations apart
  // — without the `m` flag, `^` means start-of-string either way — so the anchored form proves
  // nothing here, and a repo author writing a plain substring matcher is the realistic case.
  const l = lessonOf("git-commit.md", '{"tool":"Bash","commandMatches":"git commit"}');
  // Positive control: the same matcher must still fire on the command actually being run.
  assert.deepEqual(matchLessons(bash("git commit -m 'x'"), [l], NO_BUDGET).map(h => h.file), ["git-commit.md"]);
  // Observed live in this repo: writing a lesson whose own text named a git command fired that
  // lesson's own matcher, twice. The command being RUN is line one; everything after is data.
  const heredoc = "cat > /tmp/note.md <<'EOF'\ngit commit is the thing this note is about\nEOF";
  assert.deepEqual(matchLessons(bash(heredoc), [l], NO_BUDGET), [],
    "a matched phrase inside a heredoc body must not fire the matcher");
});

unitTest("only the first MATCH_TEXT_CAP characters of the command line are matched", () => {
  // The budget is not this test's subject, so it is given one that cannot bind: at the default
  // 50 ms a starved machine interrupts `x$` and the expected hit reads as a miss.
  const unbound = { budgetMs: 60_000, ceilingMs: 60_000 };
  const tail = lessonOf("tail.md", '{"tool":"Bash","commandMatches":"x$"}');
  const long = { tool_name: "Bash", tool_input: { command: "a".repeat(MATCH_TEXT_CAP + 1000) + "x" } };
  assert.deepEqual(matchLessons(long, [tail], unbound), []);
  const short = { tool_name: "Bash", tool_input: { command: "a".repeat(MATCH_TEXT_CAP - 1) + "x" } };
  assert.deepEqual(matchLessons(short, [tail], unbound).map(h => h.file), ["tail.md"]);
});

unitTest("a suppression regex that runs out of the real budget suppresses — it never fires as though it had finished", () => {
  const l = lessonOf("lacks.md", '{"tool":"Bash","commandMatches":"^a","commandLacks":"^(a|a)*$"}');
  const event = { tool_name: "Bash", tool_input: { command: "a".repeat(25) + "!" } };
  assert.deepEqual(matchLessons(event, [l]), []);
});

