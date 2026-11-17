// scripts/test/assert/initiatives-rules-sections.test.mjs
// release-planning-taxonomy 6.1 (FILE rung; specs initiative-record, non-goals): the bytes the two verb-refreshed rules sections leave in
// CLAUDE.md's managed block. `## Initiatives` (at most 280 bytes, while an initiative is open) and `## Mission non-goals` (at most
// 200, while the mission has an active non-goal), each outside CONDITIONAL_SECTIONS, rewritten by their own verb and kept by every
// other writer of the block, and attributed to `core` by `overhead`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const claude = (cwd) => fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
const section = (text, heading) => {
  const i = text.indexOf(`${heading}\n`);
  if (i === -1) return null;
  const rest = text.slice(i + 1);
  const j = rest.search(/\n## /);
  return text.slice(i, j === -1 ? undefined : i + 1 + j).trimEnd();
};
const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const surfaces = (cwd) => JSON.parse(run(["overhead", "--json"], { cwd })).surfaces;
const boards = ["initiative", "boards", "--title", "Live boards", "--capability", "See the plan"];

test("6.1 ## Initiatives is present while an initiative is open, within 280 bytes, naming both reason flags, absent when none is", () => {
  const cwd = repo();
  assert.equal(section(claude(cwd), "## Initiatives"), null, "no initiative, no section");
  run(boards, { cwd });
  const s = section(claude(cwd), "## Initiatives");
  assert.ok(s, "present while an initiative is open");
  assert.ok(Buffer.byteLength(s) <= 280, `${Buffer.byteLength(s)} bytes`);
  assert.match(s, /--off-initiative-reason/);
  assert.match(s, /--off-mission-reason/);
  assert.match(s, /once/i);
  run(["initiative", "boards", "--end", "--outcome", "delivered", "--reason", "done"], { cwd });
  assert.equal(section(claude(cwd), "## Initiatives"), null, "every initiative ended: the section is gone");
  run(["initiative", "boards", "--reopen", "--reason", "back"], { cwd });
  assert.ok(section(claude(cwd), "## Initiatives"), "reopened: back again");
});

test("6.1 ## Mission non-goals is present while the mission has an active non-goal, within 200 bytes with an ellipsis cut, absent otherwise", () => {
  const cwd = repo();
  assert.equal(section(claude(cwd), "## Mission non-goals"), null);
  for (const n of ["a", "b", "c"]) run(["mission", "--add-non-goal", n.repeat(300)], { cwd });
  const s = section(claude(cwd), "## Mission non-goals");
  assert.ok(s, "the section exists");
  assert.ok(Buffer.byteLength(s) <= 200, `${Buffer.byteLength(s)} bytes`);
  assert.match(s, /…$/, "cut with an ellipsis");
  for (const id of ["n1", "n2", "n3"]) run(["mission", "--remove-non-goal", `${id}:in scope now`], { cwd });
  assert.equal(section(claude(cwd), "## Mission non-goals"), null, "all removed: the section is gone");
});

test("6.1 a short non-goal list is joined into one line and is not cut", () => {
  const cwd = repo();
  run(["mission", "--add-non-goal", "No Jira sync", "--add-non-goal", "No hosted service"], { cwd });
  const s = section(claude(cwd), "## Mission non-goals");
  assert.match(s, /No Jira sync; No hosted service/);
  assert.doesNotMatch(s, /…/);
  assert.equal(s.split("\n").filter(l => l.trim() && !l.startsWith("##")).length, 1, "one line");
});

test("6.1 the ## Mission section is byte-identical when a mission non-goal is added", () => {
  const cwd = repo();
  run(["mission", "--statement", "Ship it", "--reason", "kickoff"], { cwd });
  const before = section(claude(cwd), "## Mission");
  run(["mission", "--add-non-goal", "No Jira sync"], { cwd });
  assert.equal(section(claude(cwd), "## Mission"), before);
  assert.ok(section(claude(cwd), "## Mission non-goals"));
});

test("6.1 another rewrite of the block keeps both sections: set-boards, mission --statement and the rules verb", () => {
  const cwd = repo();
  run(boards, { cwd });
  run(["mission", "--add-non-goal", "No Jira sync"], { cwd });
  const init = section(claude(cwd), "## Initiatives");
  const goals = section(claude(cwd), "## Mission non-goals");
  run(["set-boards", "off"], { cwd });
  assert.equal(section(claude(cwd), "## Initiatives"), init);
  run(["mission", "--statement", "x", "--reason", "r"], { cwd });
  assert.equal(section(claude(cwd), "## Initiatives"), init);
  assert.equal(section(claude(cwd), "## Mission non-goals"), goals);
  run(["write-rules"], { cwd });
  assert.equal(section(claude(cwd), "## Initiatives"), init);
  assert.equal(section(claude(cwd), "## Mission non-goals"), goals);
  assert.match(run(["rules"], { cwd }), /## Initiatives/);
  assert.match(run(["rules"], { cwd }), /## Mission non-goals/);
});

test("6.1 an initiative edit that does not change the section text rewrites no block, and set-boards on keeps it", () => {
  const cwd = repo();
  run(boards, { cwd });
  const before = claude(cwd);
  run(["initiative", "boards", "--add-milestone", "Live in every repo"], { cwd });
  assert.equal(claude(cwd), before, "the section text does not depend on the record's details");
  run(["set-boards", "on"], { cwd });
  assert.ok(section(claude(cwd), "## Initiatives"));
});

test("6.1 overhead reports rules:initiatives and rules:mission-non-goals under core while each exists, and not otherwise", () => {
  const cwd = repo();
  const find = (id) => surfaces(cwd).find(x => x.id === id);
  assert.equal(find("rules:initiatives"), undefined);
  assert.equal(find("rules:mission-non-goals"), undefined);
  run(boards, { cwd });
  run(["mission", "--add-non-goal", "No Jira sync"], { cwd });
  assert.equal(find("rules:initiatives").feature, "core");
  assert.equal(find("rules:mission-non-goals").feature, "core");
  assert.ok(find("rules:initiatives").bytes <= 281, "the section plus its separator");
});

test("6.1 the README cost table has a row for each section, naming core and its cap", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const [id, cap] of [["rules:initiatives", "280"], ["rules:mission-non-goals", "200"]]) {
    const row = readme.split("\n").find((l) => l.startsWith(`| \`${id}\` |`));
    assert.ok(row, `a row for ${id}`);
    assert.match(row, /\| core \|/);
    assert.ok(row.includes(cap), `names its ${cap}-byte cap`);
  }
});

test("6.1 the sections are outside CONDITIONAL_SECTIONS and attributed to core in SURFACE_FEATURES", async () => {
  const { SURFACE_FEATURES } = await import("../../lib/overhead.mjs");
  assert.equal(SURFACE_FEATURES["rules:initiatives"], "core");
  assert.equal(SURFACE_FEATURES["rules:mission-non-goals"], "core");
  const usage = fs.readFileSync(path.join(ROOT, "scripts", "lib", "rules-usage.mjs"), "utf8");
  assert.doesNotMatch(usage.slice(usage.indexOf("CONDITIONAL_SECTIONS")), /Initiatives|Mission non-goals/);
});
