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

// ---------------------------------------------------------------- board redesign (task 8.12)

test("8.12 titles name the project: the old never-prefix rule is gone, the reason is given, and the gallery copy is escaped", () => {
  const s = skill();
  assert.doesNotMatch(s, /never prefix a title with the project name/i);
  assert.match(s, /`<project name> Backlog` and `<project name> Release Plan`/);
  assert.match(s, /This replaces the earlier rule that a title never carries the project name/);
  assert.match(s, /`&` and `<` escaped/);
  assert.match(s, /a refresh never republishes/);
  const row = read(SKILL).split("\n").find(l => l.startsWith("| `page/info`"));
  assert.match(row, /`project`/, "page/info carries the project for the render-time title");
});

test("8.12 First population: one batched question set, never invent, the exact verbs and who supplies each, then refresh", () => {
  const raw = read(SKILL);
  const i = raw.indexOf("## First population: what to fill and what to ask the user");
  assert.ok(i > -1, "the section exists");
  const sec = flat(raw.slice(i, raw.indexOf("\n## ", i + 5)));
  assert.match(sec, /ONE batched question set/);
  assert.match(sec, /Never invent a project name, key, mission or milestone/);
  assert.match(sec, /re-run the refresh/);
  for (const v of ['set-project --name "<name>" --key <KEY>', "/pm:upgrade", 'mission --statement "<one line>" --reason', "mission --milestone <releaseId>",
    "mission --add-criterion", "--needs-human", 'release here <releaseId> --text "<where things stand>" --next', "--theme", "--rationale", "--exit",
    "--order <n>", "--size", "--target", 'update-epic <id> --summary "<one line>"', "`decisions/<n>`"]) assert.ok(sec.includes(v), `names ${v}`);
  for (const w of ["| the user |", "| the engine |", "you draft it from `board --json`; the user confirms", "the user confirms or edits them as a batch"]) assert.ok(sec.includes(w), `who: ${w}`);
});

test("8.15 First population opens with Derive, then confirm: sources in order, UNGROUNDED, ask only the gaps", () => {
  const raw = read(SKILL);
  const i = raw.indexOf("## First population: what to fill and what to ask the user");
  const sec = flat(raw.slice(i, raw.indexOf("\n## ", i + 5)));
  const d = sec.indexOf("Derive, then confirm");
  assert.ok(d > -1, "the step exists");
  assert.ok(d < sec.indexOf("Ask in this order"), "it leads the question list");
  const step = sec.slice(d, sec.indexOf("Ask in this order"));
  const order = ["README", "CLAUDE.md", "`board --json`", "release and epic records", "`git log`"].map((w) => step.indexOf(w));
  assert.ok(order.every((n) => n > -1), "every source is named");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "sources are in the stated order");
  assert.match(step, /Do not open by asking blank questions/);
  assert.match(step, /UNGROUNDED/);
  assert.match(step, /ask the user only about the gaps and for confirmation/);
  assert.match(step, /mission statement \(one line, at most 300 characters/);
  assert.match(step, /never invent a fact; unset stays unset/);
  assert.match(sec, /question list below is the fallback for gaps/);
});

test("8.12 the refresh-time stale check is stated, at two days, before any write", () => {
  const s = skill();
  assert.match(s, /### Stale check \(every refresh\)/);
  assert.match(s, /Before you write, read `page\/info\.lastUpdated`/);
  assert.match(s, /two or more days old/);
});

test("9.3 the skill says the release docs carry unshipped, that the Shipped table explains from it, and that no reason is ever invented", () => {
  const t = read(SKILL);
  assert.match(t, /`releases\/<releaseId>`[^\n]*`progress` and `unshipped`/);
  assert.match(t, /What the release plan draws from the release docs/);
  assert.match(t, /only releases whose `status` is `in-progress` or `planned`/);
  assert.match(t, /Shipped table/);
  assert.match(t, /no reason recorded/);
  assert.match(t, /no members recorded/);
  assert.match(t, /never write a reason of your own/);
});
