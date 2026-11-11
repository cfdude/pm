// scripts/test/assert/epic-numbers-upgrade.test.mjs
// project-boards 8.2 (FILE rung): `upgrade` numbers every epic of a record stamped before 0.55.0 — tracker-linked ones by their
// issue number — and a second `upgrade` leaves state.json byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState } from "../fixtures/assert-harness.mjs";

test("8.2 upgrade backfills numbers on a 0.54.0 record, and a second upgrade writes nothing new", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const file = path.join(cwd, ".conductor", "state.json");
  const s = readState(cwd);
  const base = { title: "t", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, stories: [] };
  s.epics = [
    { ...base, id: "plain", createdAt: "2026-10-01T00:00:00Z" },
    { ...base, id: "issue-256", externalId: "256", createdAt: "2026-10-02T00:00:00Z" },
  ];
  s.pmVersion = "0.54.0";
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  run(["upgrade"], { cwd });
  const after = readState(cwd);
  const n = Object.fromEntries(after.epics.map(e => [e.id, e.number]));
  assert.equal(n["issue-256"], 256);
  assert.equal(n.plain, 257);
  assert.equal(after.nextEpicNumber, 258);
  const bytes = fs.readFileSync(file);
  run(["upgrade"], { cwd });
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("8.2 upgrade also numbers an epic an older engine registered AFTER the stamp (the heal runs on every upgrade)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["upgrade"], { cwd });
  const file = path.join(cwd, ".conductor", "state.json");
  const s = readState(cwd);
  s.pmVersion = "0.55.0"; // already stamped at the release: the 0.55.0 entry will NOT replay, only the heal can number it
  s.epics.push({ id: "from-old-engine", title: "t", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, stories: [] });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  run(["upgrade"], { cwd });
  assert.ok(readState(cwd).epics.find(e => e.id === "from-old-engine").number > 0);
});

test("8.2 backfilling numbers is a recovery, not a touch: an old epic's touchedAt stays absent through upgrade", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const file = path.join(cwd, ".conductor", "state.json");
  const s = readState(cwd);
  s.epics = [{ id: "old", title: "t", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, stories: [], createdAt: "2026-10-01T00:00:00Z" }];
  s.pmVersion = "0.54.0";
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  run(["upgrade"], { cwd });
  const old = readState(cwd).epics.find(e => e.id === "old");
  assert.equal(old.number, 1);
  assert.equal("touchedAt" in old, false, "a backfilled number must not read as last touched on upgrade day");
});
