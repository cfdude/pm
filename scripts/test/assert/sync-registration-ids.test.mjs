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

// pushEpic()'s own refusal is a VALUE over an in-memory record: it lives on the unit rung,
// scripts/test/unit/sync-registration-ids.test.mjs.

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
  // An ENDED record keeps its archive by name, whatever its createdAt says: the rule decides only
  // whether LIVE work is ended, and pm's own createdAt recovery can date an epic after its archive.
  assert.equal(archivedChangeDir({ id: "x", status: "archived", createdAt: "2026-09-25T10:00:00.000Z" }, dir), "2025-01-01-x");
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
  //
  // DECLARED LIMITS — this is a source scan, so it sees only the shapes it names: a first argument
  // that ENDS in `.id` or `["id"]` / `['id']` on any receiver, and the literal `id` / `state.active`.
  // It cannot see an id held in a differently named variable (`isArchived(name)`) or passed through
  // a wrapper. Verified absent at the time of writing: `rg -n "isArchived\(|archivedChangeDir\(|
  // archivedTasksPath\(|changeSpecRoot\(" scripts/lib` lists every call, each passing a record.
  // The behavioural backstop is the add-auth test above, through sync, render and set-active.
  const lib = (f) => fs.readFileSync(new URL(`../../lib/${f}`, import.meta.url), "utf8");
  const bare = /\b(isArchived|archivedChangeDir|archivedTasksPath|changeSpecRoot)\(\s*(?:[\w$.]*\.id|[\w$.]*\[\s*["']id["']\s*\]|id|state\.active)\s*[,)]/;
  for (const probe of ["isArchived(t.id)", "isArchived(target.id)", 'isArchived(t["id"])', "archivedChangeDir(e.id, d)", "isArchived(id)", "isArchived(state.active)"]) {
    assert.match(probe, bare, `the scan catches ${probe}`);
  }
  for (const probe of ["isArchived(t)", "isArchived({ ...next, id })", "archivedChangeDir(epicOrId, d)"]) {
    assert.doesNotMatch(probe, bare, `the scan passes ${probe}`);
  }
  for (const f of ["epic-progress.mjs", "active-pointer.mjs", "update-epic.mjs", "integrity.mjs", "spec-sync.mjs", "cross-spec-review.mjs", "subcommands.mjs"]) {
    const lines = lib(f).split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const hits = lines.filter(l => bare.test(l));
    assert.deepEqual(hits, [], `${f} calls the resolver with a bare id`);
  }
});

// Review [I] of this branch: the date rule stripped ALREADY-archived epics of their own archives. In
// the fleet, pm's 0.40.0 createdAt recovery dated `bidirectional-sync-api` 07-09 against an archive
// dated 07-01; its 26/26 rendered `—`, every sync told the operator to rename the directory, and it
// dropped out of spec-sync and cross-spec scope. An ended epic finds its files by name.
test("an ALREADY-archived epic dated after its archive keeps its counts, and sync advises nothing", () => {
  const cwd = initRepo();
  const dir = path.join(cwd, "openspec", "changes", "archive", "2026-07-01-recovered-late");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "# tasks\n\n- [x] a\n- [x] b\n- [ ] c\n");
  run(["add-epic", "--id", "recovered-late", "--lane", "openspec", "--status", "archived"], { cwd });
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /set aside archive directory/, `no rename advice for an ended epic:\n${r.stderr}`);
  run(["render"], { cwd });
  const row = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8").split("\n").find(l => l.includes("`recovered-late`"));
  assert.match(row, /2\/3/, `the archived counts still render:\n${row}`);
});

// Review minor: set-active's own `isArchived(t)` must refuse by itself, with no heal in between —
// the conductor-03 case passes even without it, because add-epic's render heals first.
test("set-active refuses an epic whose change is archived on disk before any heal has run", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "done-now", "--lane", "openspec"], { cwd });
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  mkdirs(cwd, `openspec/changes/archive/${day}-done-now`);
  assert.notEqual(readState(cwd).epics.find(e => e.id === "done-now").status, "archived", "fixture: no heal has run");
  const r = invokeEngine(["set-active", "done-now"], { cwd });
  assert.notEqual(r.status, 0, `set-active must refuse:\n${r.stderr}`);
  assert.match(r.stderr, /is archived — cannot make it active/);
});
