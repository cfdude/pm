// scripts/test/assert/mission-write.test.mjs
// project-boards 4.1 (FILE rung): the bytes a `mission` write leaves behind — the `## Mission` section in CLAUDE.md's
// managed rules block (present while a mission exists, at most 280 bytes, absent after --end, rewritten by the verb),
// the record read back, and `overhead` attributing the section to `core`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState } from "../fixtures/assert-harness.mjs";

const claude = (cwd) => fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
const section = (text) => {
  const i = text.indexOf("## Mission\n");
  if (i === -1) return null;
  const rest = text.slice(i + 1);
  const j = rest.search(/\n## /);
  return text.slice(i, j === -1 ? undefined : i + 1 + j).trimEnd();
};
const repo = () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["release", "r2", "--intent", "the release that meets the mission"], { cwd });
  return cwd;
};

test("4.1 a mission write adds the `## Mission` section, at most 280 bytes, ending a long statement in an ellipsis and naming the milestone", () => {
  const cwd = repo();
  assert.equal(section(claude(cwd)), null, "no mission, no section");
  run(["mission", "--statement", "x".repeat(300), "--reason", "kickoff"], { cwd });
  run(["mission", "--milestone", "r2"], { cwd });
  const s = section(claude(cwd));
  assert.ok(s, "the section is present while a mission exists");
  assert.ok(Buffer.byteLength(s) <= 280, `${Buffer.byteLength(s)} bytes`);
  assert.match(s, /…/);
  assert.match(s, /Mission milestone: r2/);
  assert.equal((claude(cwd).match(/^## Mission$/gm) || []).length, 1);
});

test("4.1 the section is rewritten when the mission changes, and absent again after --end", () => {
  const cwd = repo();
  run(["mission", "--statement", "First", "--reason", "a"], { cwd });
  assert.match(section(claude(cwd)), /Mission: First/);
  run(["mission", "--statement", "Second", "--reason", "b"], { cwd });
  assert.match(section(claude(cwd)), /Mission: Second/);
  run(["mission", "--end", "--reason", "paused"], { cwd });
  assert.equal(section(claude(cwd)), null);
  assert.equal(readState(cwd).mission.history.length, 2);
});

test("4.1 the same statement twice leaves state.json byte-identical", () => {
  const cwd = repo();
  run(["mission", "--statement", "x", "--reason", "r"], { cwd });
  const file = path.join(cwd, ".conductor", "state.json");
  const before = fs.readFileSync(file);
  const out = run(["mission", "--statement", "x", "--reason", "r"], { cwd });
  assert.match(out, /unchanged|nothing/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("4.1 mission show writes nothing", () => {
  const cwd = repo();
  run(["mission", "--statement", "x", "--reason", "r"], { cwd });
  const files = [path.join(cwd, ".conductor", "state.json"), path.join(cwd, "CLAUDE.md"), path.join(cwd, "PROJECT.md")];
  const before = files.map(f => fs.readFileSync(f));
  run(["mission", "show"], { cwd });
  run(["mission", "show", "--history"], { cwd });
  assert.deepEqual(files.map(f => fs.readFileSync(f)), before);
});

test("4.1 a refused mission write leaves the rules block and state untouched", () => {
  const cwd = repo();
  const files = [path.join(cwd, ".conductor", "state.json"), path.join(cwd, "CLAUDE.md")];
  const before = files.map(f => fs.readFileSync(f));
  assert.throws(() => run(["mission", "--statement", "x"], { cwd }));
  assert.deepEqual(files.map(f => fs.readFileSync(f)), before);
});

test("4.1 overhead reports `rules:mission` under core while a mission exists, and not otherwise", () => {
  const cwd = repo();
  const surfaces = () => JSON.parse(run(["overhead", "--json"], { cwd })).surfaces;
  assert.equal(surfaces().find(x => x.id === "rules:mission"), undefined);
  run(["mission", "--statement", "x", "--reason", "r"], { cwd });
  const mission = surfaces().find(x => x.id === "rules:mission");
  assert.ok(mission, "the section is measured on its own");
  assert.equal(mission.feature, "core");
});
