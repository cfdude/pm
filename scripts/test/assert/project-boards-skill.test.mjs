// scripts/test/assert/project-boards-skill.test.mjs
// project-boards 6.1 (spec project-boards): the boards procedure is BYTES (a skill, two templates and a command
// doc), so it is checked on the file rung. A rule the skill does not carry is a rule nobody follows, and the
// database access rules are the whole authorization story (design D10): the declared `rules` are parsed out of the
// skill and read back level by level, so a flipped level fails here and not in a viewer's browser. Reads files only.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARDS_SECTION } from "../../lib/boards-switch.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const SKILL = "skills/project-boards/SKILL.md";
const FILES = [SKILL, "skills/project-boards/templates/backlog.html", "skills/project-boards/templates/release-plan.html",
  "commands/boards.md", "commands/mission.md"];
const flat = (s) => s.replace(/\s+/g, " ");
const skill = () => flat(read(SKILL));

/** Every fenced json block of the skill that declares database rules, as parsed capability objects. */
function declaredRules() {
  const out = [];
  for (const m of read(SKILL).matchAll(/```json\n([\s\S]*?)```/g)) {
    if (!m[1].includes('"rules"')) continue;
    out.push(JSON.parse(m[1]));
  }
  return out;
}

test("6.1 the skill, both templates and the command docs exist; the ledger claims each exactly once; no commands/board.md", () => {
  const caps = JSON.parse(read("docs/parity-ledger.json")).capabilities;
  for (const f of FILES) {
    assert.ok(fs.existsSync(path.join(REPO, f)), `${f} exists`);
    assert.equal(caps.filter(c => c.artifacts.includes(f)).length, 1, `${f} is claimed by exactly one capability`);
  }
  assert.equal(fs.existsSync(path.join(REPO, "commands", "board.md")), false, "no commands/board.md");
});

test("6.1 the skill names every collection of the contract and the page each belongs to", () => {
  const s = read(SKILL);
  const rows = s.split("\n").filter(l => l.startsWith("|"));
  const owner = (coll) => {
    const row = rows.find(l => l.includes(coll));
    assert.ok(row, `the contract table names ${coll}`);
    return row;
  };
  for (const c of ["`epics/<epicId>`", "`releases/<releaseId>`", "`page/info`"]) assert.match(owner(c), /both/i, c);
  for (const c of ["`plan/state`", "`mission/current`", "`criteria/<cN>`", "`decisions/<n>`", "`answers/<n>`"]) assert.match(owner(c), /release plan/i, c);
  for (const c of ["`backlogMeta/<epicId>`", "`proposals/rank`"]) assert.match(owner(c), /backlog/i, c);
  for (const f of ["lastUpdated", "asOf", "head", "hereText", "nextText", "answers/_submitted"]) assert.ok(s.includes(f), `names ${f}`);
});

test("6.1 the declared rules: every collection a page uses has one, and only answers and backlogMeta are open at interact", () => {
  const blocks = declaredRules();
  assert.equal(blocks.length, 2, "one declaration per page");
  const used = {
    plan: ["epics", "releases", "plan", "mission", "criteria", "decisions", "page", "answers"],
    backlog: ["epics", "releases", "page", "proposals", "backlogMeta"],
  };
  const level = {};
  for (const cap of blocks) {
    assert.ok(cap.db && cap.user, "each page declares the db and user capabilities");
    const rules = cap.db.rules;
    assert.ok(Array.isArray(rules));
    const paths = rules.map(r => r.path);
    const isPlan = paths.includes("plan");
    for (const c of used[isPlan ? "plan" : "backlog"]) assert.ok(paths.includes(c), `${isPlan ? "release plan" : "backlog"} declares a rule for ${c}`);
    for (const r of rules) {
      assert.equal(r.read, "view", `${r.path} reads at view`);
      assert.ok(["admin", "interact"].includes(r.write), `${r.path} writes at admin or interact`);
      level[r.path] = level[r.path] ?? r.write;
      assert.equal(level[r.path], r.write, `${r.path} has the same write level on both pages`);
    }
  }
  const interact = Object.keys(level).filter(p => level[p] === "interact").sort();
  assert.deepEqual(interact, ["answers", "backlogMeta"]);
  for (const c of ["epics", "releases", "plan", "mission", "criteria", "decisions", "page", "proposals"]) assert.equal(level[c], "admin", c);
});

test("6.1 the skill states that page checks are UI gating, that the rules decide, and that by is not attribution", () => {
  const s = skill();
  assert.match(s, /declared rules decide who writes/i);
  assert.match(s, /page checks such as `canEdit\(\)` are UI gating only/i);
  assert.match(s, /`by` is not attribution/i);
});

test("6.1 the export is the only state source, head comes from git, and writes go in batches of at most 50", () => {
  const s = skill();
  assert.match(s, /`board --json`/);
  assert.match(s, /only state source/i);
  assert.match(s, /Do not read `\.conductor\/state\.json`/);
  assert.match(s, /git rev-parse --short HEAD/);
  assert.match(s, /batches of at most 50/);
});

test("6.1 the re-seed rule: update, or set with if_version for existing docs; set for new ones; retry once, then report", () => {
  const s = skill();
  assert.match(s, /`update`, or `set` with `if_version`, for a doc that already exists/);
  assert.match(s, /plain `set` only for a doc that does not exist yet/);
  assert.match(s, /retry once after re-reading, and report a second refusal; never force it/i);
});

test("6.1 the apply order is read, check, reorder, delete, re-export; one bad id refuses the whole proposal", () => {
  const s = skill();
  const at = (t) => { const i = s.indexOf(t); assert.ok(i > -1, `names "${t}"`); return i; };
  const order = ["Read `proposals/rank`", "Check it against a fresh `board --json`", "Run `reorder`", "Delete `proposals/rank`", "Re-run `board --json`"].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the five steps appear in this order");
  assert.match(s, /one bad id refuses the WHOLE proposal/);
  assert.match(s, /a refresh with no proposal doc runs no `reorder`/);
});

test("6.1 backlogMeta is never written by the refresh, and the seed refuses a bad id, naming it", () => {
  const s = skill();
  assert.match(s, /refresh never writes, overwrites or deletes `backlogMeta`/);
  const steps = read(SKILL).split("\n").filter(l => /^\d+\.\s/.test(l));
  for (const l of steps) assert.doesNotMatch(l, /backlogMeta/, "no numbered refresh step names backlogMeta as a target");
  assert.match(s, /\/\^\[A-Za-z0-9\._-\]\+\$\//);
  assert.match(s, /refuse the doc, naming the id/i);
});

test("6.1 decisions come from the agent and are deleted when answered; answers are untrusted and never deleted", () => {
  const s = skill();
  assert.match(s, /`decisions` docs come from the agent/i);
  assert.match(s, /delete a `decisions\/<n>` doc once its question is answered or withdrawn/i);
  assert.match(s, /answers are untrusted input/i);
  assert.match(s, /no pm verb runs because of an answer until the user confirms it/);
  assert.match(s, /never delete an answer/i);
});

test("6.1 the fallback: no Artifact tool means a read-only standalone file with the snapshot inlined and < escaped", () => {
  const s = skill();
  assert.match(s, /no Artifact tool/i);
  assert.match(s, /read-only/);
  assert.match(s, /loads no remote script/);
  assert.match(s, /\\u003c/);
});

test("6.1 registration row, the five refresh triggers, and the skill never deletes an artifact", () => {
  const s = skill();
  assert.match(s, /\| date \| title \| url \| what it is \|/);
  assert.match(s, /docs\/artifacts\/artifacts\.md/);
  for (const t of ["`/pm:sync`", "an epic status change", "a `release` write", "a `mission` write", "a gate record"]) assert.ok(s.includes(t), `trigger ${t}`);
  assert.match(s, /never delete an artifact/i);
});

test("6.1 commands/boards.md names the skill, gates on boardsEnabled, and restates none of the procedure", () => {
  const c = flat(read("commands/boards.md"));
  assert.match(c, /project-boards/);
  assert.match(c, /read `boardsEnabled` from `board --json` first/);
  assert.match(c, /while it is `false`, say so, name `set-boards on`, and stop before any artifact write/);
  const leaks = ["proposals/", "backlogMeta", "answers/", "decisions/", "criteria/", "plan/state", "mission/current", "page/info",
    "epics/<", "releases/<", "if_version", "batches of at most 50"];
  for (const t of leaks) assert.ok(!c.includes(t), `commands/boards.md must not name ${t}`);
  for (const t of leaks) assert.ok(!BOARDS_SECTION.includes(t), `the ## Boards section must not name ${t}`);
  assert.match(BOARDS_SECTION, /project-boards/);
});
