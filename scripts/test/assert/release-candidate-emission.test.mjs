// scripts/test/assert/release-candidate-emission.test.mjs
// converged-release-candidate-review 2.1 (the pinned fixture) and 2.2 (CLAUDE.md on disk).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, claudeMd } from "../fixtures/assert-harness.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = fs.readFileSync(path.join(HERE, "..", "fixtures", "rules-0.51.0-release-candidate.txt"), "utf8");
const LIB = new URL("../../lib/", import.meta.url).href;

test("2.1: the Release candidate section is byte-pinned by the current-version fixture", async () => {
  const { rulesBlock } = await import(LIB + "rules.mjs");
  const block = rulesBlock(null, "thorough", [], "claude-code");
  const section = block.slice(block.indexOf("## Release candidate"), block.indexOf("## Feedback"));
  assert.equal(section, FIXTURE, "regenerate scripts/test/fixtures/rules-0.51.0-release-candidate.txt deliberately if this changes");
});

test("2.2: after write-rules, CLAUDE.md carries the section once, inside the managed markers", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["write-rules"], { cwd });
  const text = claudeMd(cwd);
  const begin = text.indexOf("<!-- BEGIN pm-conductor rules");
  const end = text.indexOf("<!-- END pm-conductor rules -->");
  const at = text.indexOf("## Release candidate");
  assert.ok(begin !== -1 && end !== -1 && at > begin && at < end, "the section sits between the managed markers");
  assert.equal(text.split("## Release candidate").length - 1, 1, "and appears once");
  run(["write-rules"], { cwd });
  assert.equal(claudeMd(cwd).split("## Release candidate").length - 1, 1, "a second write-rules does not duplicate it");
});
