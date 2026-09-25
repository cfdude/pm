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
  ADVISED_TOOLS, DETECT_KEYS, MATCH_TEXT_CAP, REGEX_BUDGET_MS,
  checkDetect, matchLessons, nestedUnboundedQuantifier,
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

unitTest("nestedUnboundedQuantifier names the group; bounded, flat and literal forms are not flagged", () => {
  assert.equal(nestedUnboundedQuantifier("^(a+)+$"), "(a+)+");
  assert.equal(nestedUnboundedQuantifier("(?:\\s+x){2,}"), "(?:\\s+x){2,}");
  assert.equal(nestedUnboundedQuantifier("((a)*b)*"), "((a)*b)*");
  assert.equal(nestedUnboundedQuantifier("(x(?:y+))*"), "(x(?:y+))*");
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

unitTest("a catastrophic regex the static check cannot see is cut off inside the budget", () => {
  // `^(a|a)*$` nests nothing, so checkDetect accepts it; unguarded it should take on the order of 10 s on this input
  // (6.7 s was observed at 24 characters, and each character roughly doubles it), so a mutant
  // without the budget FAILS the time assertion
  // rather than hanging the run.
  const good = lessonOf("a-good.md", '{"tool":"Bash","commandMatches":"^a"}');
  const bad = lessonOf("z-bad.md", '{"tool":"Bash","commandMatches":"^(a|a)*$"}');
  const event = { tool_name: "Bash", tool_input: { command: "a".repeat(25) + "!" } };
  const t0 = performance.now();
  const hits = matchLessons(event, [good, bad]);
  const ms = performance.now() - t0;
  assert.ok(ms < REGEX_BUDGET_MS + 1900, `regex phase took ${ms.toFixed(0)} ms`);
  assert.deepEqual(hits.map(h => h.file), ["a-good.md"],
    "the lesson evaluated before the budget ran out still fires; the runaway one does not");
});

unitTest("only the first MATCH_TEXT_CAP characters of the command line are matched", () => {
  const tail = lessonOf("tail.md", '{"tool":"Bash","commandMatches":"x$"}');
  const long = { tool_name: "Bash", tool_input: { command: "a".repeat(MATCH_TEXT_CAP + 1000) + "x" } };
  assert.deepEqual(matchLessons(long, [tail]), []);
  const short = { tool_name: "Bash", tool_input: { command: "a".repeat(MATCH_TEXT_CAP - 1) + "x" } };
  assert.deepEqual(matchLessons(short, [tail]).map(h => h.file), ["tail.md"]);
});

unitTest("a suppression regex that runs out of budget suppresses — it never fires as though it had finished", () => {
  const l = lessonOf("lacks.md", '{"tool":"Bash","commandMatches":"^a","commandLacks":"^(a|a)*$"}');
  const event = { tool_name: "Bash", tool_input: { command: "a".repeat(25) + "!" } };
  const t0 = performance.now();
  assert.deepEqual(matchLessons(event, [l]), []);
  assert.ok(performance.now() - t0 < REGEX_BUDGET_MS + 1900);
});

