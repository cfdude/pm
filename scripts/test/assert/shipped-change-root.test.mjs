// scripts/test/assert/shipped-change-root.test.mjs
// dehardcode-openspec-change-root-in-instructions, task 1.1 (FILE half) — no shipped document pins an
// OpenSpec change's location. The population is DERIVED (fixtures/shipped-docs.mjs), so a new
// skills/<name>/SKILL.md with a pinned path fails this test without the test being edited.
// The rendered rules block and brief are the UNIT twin (unit/shipped-change-root.test.mjs).

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO, shippedDocs } from "../fixtures/shipped-docs.mjs";
import { pinnedPaths } from "../fixtures/change-root-sweep.mjs";

test("1.1 the checker: a pinned path fails, a stated default passes, naming the line", () => {
  const pinned = pinnedPaths("intro\nread openspec/changes/<id>/tasks.md first\n");
  assert.deepEqual(pinned.map((h) => h.line), [2]);
  assert.deepEqual(pinnedPaths("its directory (changeRoot from openspec status --change <id> --json; by default openspec/changes/<id>/)"), []);
  assert.deepEqual(pinnedPaths("by default `openspec/changes/<id>/`"), [], "an opening backtick is allowed");
  assert.deepEqual(pinnedPaths("By Default\n`openspec/changes/<id>/`"), [], "case and a line break inside the phrase are allowed");
  assert.equal(pinnedPaths("a default `openspec/changes/<id>/`").length, 1, "only the exact phrase counts");
});

test("1.1 the population is derived and reaches every shipped root", () => {
  const docs = shippedDocs();
  for (const root of ["commands/", "agents/", "skills/", "README.md"]) assert.ok(docs.some((d) => d === root || d.startsWith(root)), root);
  assert.ok(docs.some((d) => /^skills\/.+\/SKILL\.md$/.test(d)));
});

test("1.1 no shipped document pins an OpenSpec change's location (file and line named on failure)", () => {
  const offenders = [];
  for (const rel of shippedDocs()) {
    for (const h of pinnedPaths(fs.readFileSync(path.join(REPO, rel), "utf8"))) offenders.push(`${rel}:${h.line}  ${h.text}`);
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});

test("1.2 agents/reconciler.md points the reconciler at the resolved location", () => {
  const text = fs.readFileSync(path.join(REPO, "agents", "reconciler.md"), "utf8");
  assert.match(text, /changeRoot[\s\S]{0,80}openspec status --change <paused> --json|openspec status --change <paused> --json[\s\S]{0,80}changeRoot/);
});
