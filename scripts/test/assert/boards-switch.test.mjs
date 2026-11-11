// scripts/test/assert/boards-switch.test.mjs
// project-boards 5.1 (FILE rung; specs feature-switches, managed-rules-block, tracker-sync): the bytes the boards switch leaves
// behind. The `## Boards` section of the managed rules block (size, presence, absence while off, every code span run as
// written), the brief's boards line, `overhead`'s two new surfaces, the inward recipe's `--summary=` placeholder, `upgrade`'s
// opt-in line, the fitted brief and the README rows. The value-level half is in unit/boards-switch.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, readState } from "../fixtures/assert-harness.mjs";
import { rulesBlock } from "../../lib/rules.mjs";
import { buildBriefParts } from "../../lib/briefing.mjs";
import { BRIEF_BYTE_CAP, fitBrief } from "../../lib/session-cost.mjs";
import { BOARDS_BRIEF_LINE, BOARDS_BRIEF_LINE_MAX_BYTES, BOARDS_SECTION_MAX_BYTES } from "../../lib/boards-switch.mjs";
import { missionBriefLine } from "../../lib/mission-record.mjs";
import { collectSurfaces } from "../../lib/overhead.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const claude = (cwd) => fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
const section = (text) => {
  const i = text.indexOf("## Boards\n");
  if (i === -1) return null;
  const rest = text.slice(i + 1);
  const j = rest.search(/\n## |\n<!-- END/);
  return text.slice(i, j === -1 ? undefined : i + 1 + j).trimEnd();
};
const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const overhead = (cwd) => JSON.parse(run(["overhead", "--json"], { cwd }));
const surface = (report, id) => report.surfaces.find((s) => s.id === id);

test("5.1 the `## Boards` section is present by default, at most 280 bytes, names the skill and /pm:boards, and init writes no setting", () => {
  const cwd = repo();
  const s = section(claude(cwd));
  assert.ok(s, "present on a fresh repo");
  assert.ok(Buffer.byteLength(s) <= BOARDS_SECTION_MAX_BYTES, `${Buffer.byteLength(s)} bytes`);
  assert.equal(BOARDS_SECTION_MAX_BYTES, 280);
  assert.match(s, /project-boards/);
  assert.match(s, /\/pm:boards/);
  assert.equal((claude(cwd).match(/^## Boards$/gm) || []).length, 1);
  assert.equal(readState(cwd).boards, undefined, "init does not write the setting");
});

test("5.1 set-boards off removes the section and the line naming the skill; on puts them back and the record returns to its first bytes", () => {
  const cwd = repo();
  const { revision: r0, ...before } = readState(cwd);
  run(["set-boards", "off"], { cwd });
  assert.equal(section(claude(cwd)), null);
  assert.doesNotMatch(claude(cwd), /project-boards/);
  assert.deepEqual(readState(cwd).boards, { enabled: false });
  run(["set-boards", "on"], { cwd });
  assert.ok(section(claude(cwd)));
  const { revision: r1, ...after } = readState(cwd);
  assert.deepEqual(after, before, "on removes the setting: each undoes the other exactly (the save counter aside)");
  assert.ok(r1 > r0, "both writes were real writes");
});

test("5.1 a repeat writes no state, and a refused argument leaves both files untouched", () => {
  const cwd = repo();
  run(["set-boards", "off"], { cwd });
  const files = [path.join(cwd, ".conductor", "state.json"), path.join(cwd, "CLAUDE.md")];
  const before = files.map((f) => fs.readFileSync(f));
  assert.match(runCombined(["set-boards", "off"], { cwd }), /already off/);
  assert.deepEqual(files.map((f) => fs.readFileSync(f)), before);
  assert.throws(() => run(["set-boards", "maybe"], { cwd }));
  assert.deepEqual(files.map((f) => fs.readFileSync(f)), before);
});

test("5.1 every code span in the `## Boards` section runs as written", () => {
  const cwd = repo();
  const spans = [...section(claude(cwd)).replace(/\n\s*/g, " ").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.ok(spans.length >= 3, `spans: ${spans.join(" | ")}`);
  const engineSpans = spans.filter((s) => /^(board|set-boards)\b/.test(s));
  assert.deepEqual(engineSpans.map((s) => s.split(/\s+/)[0]).sort(), ["board", "set-boards"], `spans: ${spans.join(" | ")}`);
  for (const span of engineSpans) run(span.split(/\s+/), { cwd });
  // The rest name a skill and slash commands, which the plugin ships: each must exist.
  const commands = spans.filter((s) => s.startsWith("/pm:")).map((s) => s.slice(4));
  for (const name of commands.filter((n) => n !== "sync")) assert.ok(fs.existsSync(path.join(ROOT, "commands", `${name}.md`)), `/pm:${name}`);
  assert.ok(fs.existsSync(path.join(ROOT, "commands", "sync.md")));
});

test("5.1 the brief carries the boards line, at most 160 bytes, and not while the boards are off", () => {
  assert.ok(Buffer.byteLength(BOARDS_BRIEF_LINE) <= BOARDS_BRIEF_LINE_MAX_BYTES);
  assert.equal(BOARDS_BRIEF_LINE_MAX_BYTES, 160);
  const cwd = repo();
  assert.ok(run(["brief"], { cwd }).includes(BOARDS_BRIEF_LINE));
  run(["set-boards", "off"], { cwd });
  assert.ok(!run(["brief"], { cwd }).includes("BOARDS:"));
  assert.ok(!fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8").includes("BOARDS:"), "PROJECT.md embeds the brief and was re-rendered");
});

test("5.1 overhead reports rules:boards and brief:boards under boards, brief without the line, and 0 bytes for boards while off", () => {
  const cwd = repo();
  const on = overhead(cwd);
  const { plain, parts } = buildBriefParts(readState(cwd), { consume: false, specSync: false });
  const sentBytes = fitBrief(parts, { plain, cap: BRIEF_BYTE_CAP }).bytes;
  const rules = surface(on, "rules:boards");
  const brief = surface(on, "brief:boards");
  assert.equal(rules.feature, "boards");
  assert.equal(brief.feature, "boards");
  assert.equal(rules.bytes, Buffer.byteLength(section(claude(cwd))) + 2, "the section as written, its end-of-line and the blank line before the next heading");
  assert.ok(rules.bytes > 0 && rules.bytes <= 282);
  assert.equal(brief.bytes, Buffer.byteLength(BOARDS_BRIEF_LINE + "\n"), "the line and its newline");
  assert.equal(on.features.boards.on, true);
  assert.equal(on.features.boards.bytes, rules.bytes + brief.bytes);
  run(["set-boards", "off"], { cwd });
  const off = overhead(cwd);
  assert.equal(surface(off, "rules:boards"), undefined, "no section, no surface");
  assert.equal(surface(off, "brief:boards").bytes, 0);
  assert.equal(off.features.boards.bytes, 0);
  assert.equal(off.features.boards.on, false);
  // `brief` excludes the line, so the two sum to the brief a session receives. (The one blank line that separated the boards line stays
  // in `brief`, which is why the off figure is a byte under the on one.)
  assert.equal(surface(on, "brief").bytes + surface(on, "brief:boards").bytes, sentBytes);
});

test("5.1 the inward recipe carries --summary=<one-line summary>, with its limit, its quoting and the omit rule", () => {
  for (const system of [{ system: "github-issues", repo: "o/n", direction: "inward" }]) {
    const text = rulesBlock(system, "standard", [], "claude-code").replace(/\n\s+/g, " ");
    assert.match(text, /`add-epic --id [^`]*--summary=<one-line summary>`/);
    assert.match(text, /one line, at most 200 characters, in your own words and never the raw body, as ONE single-quoted word/);
    assert.match(text, /leave `--summary=` off rather than invent one/);
  }
  const secondary = rulesBlock(null, "standard", [{ system: "jira", projectKey: "ABC", role: "secondary" }], "claude-code");
  assert.match(secondary.replace(/\n\s+/g, " "), /--summary=<one-line summary>/);
});

test("5.1 upgrade prints `boards: on (default)` in its opt-in output, and not the announcement while it does not cross the release", () => {
  const cwd = repo();
  const out = run(["upgrade"], { cwd });
  assert.match(out, /conductor: opt-ins — [^\n]*boards: on \(default\)/);
  assert.doesNotMatch(out, /boards are ON by default/, "a repo already at the running version crosses nothing");
  assert.equal(readState(cwd).boards, undefined, "the announcement and the line write no state");
});

test("5.1 the fitted brief keeps the boards and mission lines whole, and brief:boards is measured after fitting", () => {
  // 300 releases with a long intent each: the plain brief lists every one, so it is over the cap and the fitter shortens the list.
  const releases = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, intent: `release ${i} ${"y".repeat(100)}`, deferred: [] }));
  const state = {
    version: 1, revision: 1, active: null, detourStack: [], epics: [], releases,
    mission: { current: { statement: "Ship the boards", setAt: "2026-11-01T00:00:00Z", reason: "r" }, milestoneRelease: null, criteria: [] },
  };
  const { plain, parts } = buildBriefParts(state, { consume: false, specSync: false });
  const fit = fitBrief(parts, { plain, cap: BRIEF_BYTE_CAP });
  assert.equal(fit.truncated, true, `the premise: the record is over the cap (${fit.originalBytes} bytes), so the fitter shortened lists`);
  assert.ok(fit.text.includes(BOARDS_BRIEF_LINE), "the boards line is whole after fitting");
  assert.ok(fit.text.includes(missionBriefLine(state)), "the mission line is whole after fitting");
  assert.ok(Buffer.byteLength(missionBriefLine(state)) <= 200);
  const surfaces = collectSurfaces(state, {});
  const brief = surfaces.find((x) => x.id === "brief");
  const boards = surfaces.find((x) => x.id === "brief:boards");
  assert.equal(boards.bytes, Buffer.byteLength(BOARDS_BRIEF_LINE + "\n"), "the line is never shortened, so its cost is exactly its bytes");
  assert.equal(brief.bytes + boards.bytes, fit.bytes, "measured after fitting: the two surfaces sum to the brief a session receives");
});

test("5.1 the README cost table has a row for rules:boards and for brief:boards, naming the feature and set-boards", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const id of ["rules:boards", "brief:boards"]) {
    const row = readme.split("\n").find((l) => l.startsWith(`| \`${id}\` |`));
    assert.ok(row, `a row for ${id}`);
    assert.match(row, /\| boards \|/);
    assert.match(row, /`set-boards off`/);
  }
});
