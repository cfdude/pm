// scripts/test/assert/sync-registration-ids.test.mjs
// sync-registers-ids-add-epic-refuses (0.50.0). The FILE rung: every test here builds real
// directories under openspec/changes/ or docs/superpowers/plans/, which is what sync reads.
//
// Defect 1 — every path that registers an epic applies add-epic's own id rule, from ONE validator.
// Before this, sync and the archive backfill tested only "no whitespace or control character", so a
// change directory `x|y` became an epic `x|y` (a pipe splits PROJECT.md's Epics table) that add-epic
// itself would have refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";

const readState = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
const mkdirs = (cwd, ...rel) => { for (const r of rel) fs.mkdirSync(path.join(cwd, r), { recursive: true }); };
const initRepo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };

test("sync registers only ids add-epic accepts, names every skip, and counts the skips in its final line", () => {
  const cwd = initRepo();
  mkdirs(cwd, "openspec/changes/x|y", "openspec/changes/.hidden", "openspec/changes/good-change",
    "openspec/changes/archive/2026-01-01-a|b", "docs/superpowers/plans");
  fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/p|q.md"), "# p\n");
  fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/MASTER-plan.md"), "# master\n");
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const ids = readState(cwd).epics.map(e => e.id);
  assert.ok(ids.includes("good-change"), "a well-formed change still registers");
  for (const bad of ["x|y", ".hidden", "a|b", "p|q", "MASTER-plan"]) {
    assert.ok(!ids.includes(bad), `'${bad}' is refused by add-epic, so sync must not store it`);
  }
  assert.match(r.stderr, /sync skipped change 'x\|y' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped change '\.hidden' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped archive directory '2026-01-01-a\|b' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped plan 'p\|q\.md' — its name is not a valid epic id/);
  // The uppercase plan gets a RUNNABLE registration: its lowercased stem passes the rule.
  assert.match(r.stderr, /sync skipped plan 'MASTER-plan\.md'[^\n]*`add-epic --id master-plan --lane superpowers --plan docs\/superpowers\/plans\/MASTER-plan\.md`/);
  assert.match(r.stderr, /conductor: synced \(1 new epic\(s\) added as untriaged; 5 skipped/, `the final line counts the skips:\n${r.stderr}`);
});

test("pushEpic, the one creation sink, refuses every id add-epic refuses", async () => {
  const { pushEpic, InvalidEpicIdError } = await import(new URL("../../lib/state.mjs", import.meta.url));
  for (const id of ["x|y", ".hidden", "MASTER-ok", "has space", ""]) {
    const state = { epics: [] };
    assert.throws(() => pushEpic(state, { id, title: "t", lane: "claude-code", links: [] }), InvalidEpicIdError, `refuses ${JSON.stringify(id)}`);
    assert.equal(state.epics.length, 0);
  }
});

test("add-epic, add-many and sync share ONE validator — no creation site tests the format itself", () => {
  const lib = (f) => fs.readFileSync(new URL(`../../lib/${f}`, import.meta.url), "utf8");
  for (const f of ["add-epic.mjs", "add-many.mjs", "subcommands.mjs"]) {
    assert.doesNotMatch(lib(f), /EPIC_ID_FORMAT\.test\(/, `${f} must call STORABLE_EPIC_ID, not test the regex itself`);
    assert.match(lib(f), /STORABLE_EPIC_ID\(/, `${f} calls the shared validator`);
  }
  assert.match(lib("constants.mjs"), /export const STORABLE_EPIC_ID = \(id\) =>\s*typeof id === "string" && EPIC_ID_FORMAT\.test\(id\)/);
});

// Defect 2 — an unrelated archive directory ended a live epic. `archive/2025-01-01-add-auth` matched
// an ACTIVE epic `add-auth` registered today by bare name, so the drift heal archived it with outcome
// `unknown` and cleared the active pointer, and sync still said "synced". The rule: a DATED archive
// directory older than the epic's registration day (one day of slack, openspec dates locally and
// `createdAt` is UTC) cannot be that epic's archive — decided inside the ONE resolver.

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("an archive dated before the epic existed neither ends it nor takes its active pointer, and sync names it", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "add-auth", "--lane", "claude-code"], { cwd });
  run(["set-active", "add-auth"], { cwd });
  mkdirs(cwd, "openspec/changes/archive/2025-01-01-add-auth");
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  let s = readState(cwd);
  assert.notEqual(s.epics.find(e => e.id === "add-auth").status, "archived", "the live epic is not ended by an older, unrelated archive");
  assert.equal(s.active, "add-auth", "and its active pointer survives");
  assert.match(r.stderr, /set aside archive directory '2025-01-01-add-auth' — it predates epic 'add-auth'/, `sync names the set-aside directory:\n${r.stderr}`);
  assert.match(r.stderr, /conductor: synced \([^\n]*1 archive directory set aside/, `and its final line counts it, not a bare "synced":\n${r.stderr}`);
  // Every other heal caller and the pointer verb answer the same way.
  run(["render"], { cwd });
  s = readState(cwd);
  assert.equal(s.active, "add-auth", "render's heal leaves it too");
  run(["set-active", "add-auth"], { cwd });
});

test("an archive dated on or after the epic's registration still heals it", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "real-change", "--lane", "openspec"], { cwd });
  mkdirs(cwd, `openspec/changes/archive/${localDay()}-real-change`);
  run(["sync"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "real-change").status, "archived");
});

test("the one resolver: the date rule, its one day of slack, the backfill exemption and the undatable fallback", async () => {
  const cwd = tmpRepo();
  const dir = path.join(cwd, "archive");
  mkdirs(cwd, "archive/2025-01-01-x", "archive/2026-09-25-y", "archive/2020-01-01-old");
  const { archivedChangeDir } = await import(new URL("../../lib/epic-progress.mjs", import.meta.url));
  // A bare id keeps the name match (no record, nothing to date).
  assert.equal(archivedChangeDir("x", dir), "2025-01-01-x");
  // A record registered after the archive's date: set aside.
  assert.equal(archivedChangeDir({ id: "x", status: "queued", createdAt: "2026-09-25T10:00:00.000Z" }, dir), null);
  // Same for an ENDED record — the rule is about identity, not liveness.
  assert.equal(archivedChangeDir({ id: "x", status: "archived", createdAt: "2026-09-25T10:00:00.000Z" }, dir), null);
  // One day of slack: registered 01:00 UTC on the 26th, archived locally on the 25th.
  assert.equal(archivedChangeDir({ id: "y", status: "queued", createdAt: "2026-09-26T01:00:00.000Z" }, dir), "2026-09-25-y");
  assert.equal(archivedChangeDir({ id: "y", status: "queued", createdAt: "2026-09-27T01:00:00.000Z" }, dir), null);
  // Registered FROM the archive: its createdAt postdates the archive by construction.
  assert.equal(archivedChangeDir({ id: "old", status: "archived", registeredBy: "archive-backfill", createdAt: "2026-09-25T10:00:00.000Z" }, dir), "2020-01-01-old");
  // Undatable (createdAt absent, null or garbage): a LIVE record is never ended by name alone; an
  // ended one still locates its files.
  for (const createdAt of [undefined, null, "not a date"]) {
    const live = { id: "x", status: "queued" }; if (createdAt !== undefined) live.createdAt = createdAt;
    assert.equal(archivedChangeDir(live, dir), null, `live, createdAt ${createdAt}`);
    assert.equal(archivedChangeDir({ ...live, status: "archived" }, dir), "2025-01-01-x", `ended, createdAt ${createdAt}`);
  }
});

test("every consumer of the resolver passes the RECORD, never the bare id", () => {
  // Derived from `rg` over the resolver's callers (plan, required item 1). A bare-id call skips the
  // date rule, which is exactly how the active pointer was lost.
  const lib = (f) => fs.readFileSync(new URL(`../../lib/${f}`, import.meta.url), "utf8");
  const bare = /\b(isArchived|archivedChangeDir|archivedTasksPath|changeSpecRoot)\((e|t|a|epic|snapshot)?\.id\b|\bisArchived\((id|state\.active)\)/;
  for (const f of ["epic-progress.mjs", "active-pointer.mjs", "update-epic.mjs", "integrity.mjs", "spec-sync.mjs", "cross-spec-review.mjs"]) {
    const lines = lib(f).split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const hits = lines.filter(l => bare.test(l));
    assert.deepEqual(hits, [], `${f} calls the resolver with a bare id`);
  }
});
