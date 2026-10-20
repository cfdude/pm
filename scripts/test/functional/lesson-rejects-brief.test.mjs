// scripts/test/functional/lesson-rejects-brief.test.mjs
// gh-cfdude-pm-228 -- a CONSUMER repo's rejected lesson `detect:` is reported by the SessionStart brief.
// The assertion twin (same id) is scripts/test/unit/lesson-rejects-brief.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "../fixtures/functional-harness.mjs";

const context = (cwd) => JSON.parse(run(["brief"], { cwd, input: "{}" })).hookSpecificOutput.additionalContext;
const lesson = (cwd, name, detect) => {
  const dir = path.join(cwd, "docs", "lessons");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `---\nrule: r\n${detect === null ? "" : `detect: ${detect}\n`}---\nbody\n`);
};

test("228: a broken detect: in the repo's own docs/lessons/ shows in the SessionStart brief", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  lesson(cwd, "bare-regex.md", "^git commit");
  lesson(cwd, "good.md", '{"tool":"Bash","commandMatches":"^rm "}');
  lesson(cwd, "retrieval-only.md", null);
  const ctx = context(cwd);
  assert.match(ctx, /⚠ 1 lesson matcher rejected/);
  assert.match(ctx, /bare-regex\.md: detect: is not JSON/);
  assert.doesNotMatch(ctx, /good\.md|retrieval-only\.md/, "a usable matcher and an absent one are not rejects");
});

test("228: a clean corpus, and a repo with no docs/lessons/, print nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.doesNotMatch(context(cwd), /lesson matcher/);
  lesson(cwd, "good.md", '{"tool":"Bash","commandMatches":"^rm "}');
  assert.doesNotMatch(context(cwd), /lesson matcher/);
});

test("228: the PreCompact snapshot's brief.txt does not depend on docs/lessons/", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  lesson(cwd, "bare-regex.md", "^git commit");
  run(["snapshot"], { cwd, input: "{}" });
  assert.doesNotMatch(fs.readFileSync(path.join(cwd, ".conductor", "brief.txt"), "utf8"), /lesson matcher/);
});
