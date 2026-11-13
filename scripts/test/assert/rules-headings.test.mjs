// scripts/test/assert/rules-headings.test.mjs
// gh-cfdude-pm-248, task 3.1 (FILE) — rulesBlockHeadings(platform) replaces rulesBlockShowsSpendGuard(): the
// set of `## ` headings inside the ONE managed block, or null when there is no block or an ambiguous one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";
import { withRoot } from "../fixtures/explicit-root.mjs";
import * as rules from "../../lib/rules.mjs";

const realRepo = () => fs.realpathSync(tmpRepo());
const headings = (cwd) => withRoot(cwd, () => rules.rulesBlockHeadings("claude-code"));
const BEGIN = "<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->";
const END = "<!-- END pm-conductor rules -->";

test("3.1 a repo with a managed block reports its `## ` headings as a set of heading texts", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  const h = headings(cwd);
  assert.ok(h instanceof Set);
  assert.ok(h.has("PM Conductor — operating rules"));
  assert.ok(h.has("Procedures emitted on use"));
  assert.ok(!h.has("Epic-level autonomy") && !h.has("Spend guard"));
});

test("3.1 headings outside the markers and `###` lines are not counted", () => {
  const cwd = realRepo();
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), `# x\n\n## Outside before\n\n${BEGIN}\n## Inside\n### Sub\n${END}\n\n## Outside after\n`);
  assert.deepEqual([...headings(cwd)], ["Inside"]);
});

test("3.1 no file, no markers and an ambiguous arrangement all read null (never throw, never create)", () => {
  const cwd = realRepo();
  assert.equal(headings(cwd), null, "no rules file");
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# x\n\n## Not managed\n");
  assert.equal(headings(cwd), null, "no markers");
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), `${BEGIN}\n## A\n${BEGIN}\n## B\n${END}\n`);
  assert.equal(headings(cwd), null, "two BEGIN lines");
  assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), `${BEGIN}\n## A\n${BEGIN}\n## B\n${END}\n`, "nothing was rewritten");
});

test("3.1 the old name is gone from the engine", () => {
  assert.equal(rules.rulesBlockShowsSpendGuard, undefined);
});
