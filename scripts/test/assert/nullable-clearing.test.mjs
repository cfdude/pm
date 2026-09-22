// scripts/test/nullable-clearing.test.mjs
// 0.40.0 — declared nullability, the uniform clearing form, `--link` as an APPEND, and the
// no-op reporting rule that binds the whole write surface.
//
// The sweeps here are driven from `EPIC_FLAGS` and never from a list typed into this file. That
// is the point of declaring nullability in the registry at all: a field that gains
// `nullable: true` with no clearing path has to FAIL here, and a list transcribed into a test
// would simply not mention it.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// The rest of it — 23 of its 26 tests, every one whose observable is what the RECORD SAYS — is on
// the unit rung in `scripts/test/unit/nullable-clearing.test.mjs`, where the same assertions read
// their values out of an in-memory store. What is LEFT here is the three whose subject is a PATH
// the store does not own:
//
//   * `add-many`'s surface is driven through a BATCH FILE (`writeBatch()` writes `batch.json`);
//   * one test READS `lib/<command>.mjs` to assert every surface calls `mergeLinks()` — a
//     SOURCE-SHAPE guard, and a read of the repository by construction;
//   * `--clear plan`'s end-to-end proof writes a real plan under `docs/superpowers/plans/` and
//     lets `sync` find it, because `sync`'s dedup reads the filesystem.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, readState, writeBatch, invokeEngine } from "../fixtures/assert-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;

/** stdout+stderr of an invocation that MUST succeed. Local rather than helpers' `runCombined()`
 *  because that one ignores the exit code, and a crash would then read as "no such message" —
 *  a test that passes for the wrong reason on exactly the assertions below. */
function combined(cwd, args) {
  const r = invokeEngine(args, { cwd });
  assert.equal(r.status, 0, `expected success: ${r.stderr}`);
  return r.stdout + r.stderr;
}

/** A repo with two epics: `subject` (the one under test) and `other` (a real target for
 *  `--parent` and `--link`, both of which validate against the known epic ids). */
function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "subject", "--lane", "claude-code"], { cwd });
  return cwd;
}
const epicOf = (cwd, id = "subject") => readState(cwd).epics.find(e => e.id === id);

// ───────── the link rule binds every write surface the registry names, not one of them ─────────

/** How to supply the SAME link identity twice on each command the `link` row declares. Keyed by
 *  command, so a fourth surface declaring `--link` fails here by name instead of being silently
 *  unexercised — the same shape SET_VALUE above uses, and the reason this is a table rather than
 *  three tests. */
const SUPPLY_DUPLICATE_LINK = {
  "add-epic": (cwd) => {
    run(["add-epic", "--id", "subj", "--lane", "claude-code",
      "--link", "blocks:other:first", "--link", "blocks:other:second"], { cwd });
    return "subj";
  },
  "update-epic": (cwd) => {
    run(["update-epic", "subject", "--link", "blocks:other:first",
      "--link", "blocks:other:second"], { cwd });
    return "subject";
  },
  "add-many": (cwd) => {
    const batch = writeBatch(cwd, { epics: [{ id: "subj", lane: "claude-code", links: [
      { type: "blocks", epic: "other", reason: "first" },
      { type: "blocks", epic: "other", reason: "second" },
    ] }] });
    run(["add-many", "--from", batch], { cwd });
    return "subj";
  },
};

test("supplying one link identity twice records ONE link on EVERY surface the registry declares", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const row = EPIC_FLAGS.find(f => f.flag === "link");
  assert.ok(row && row.commands.length >= 3, "the `link` row must still declare its write surfaces");

  for (const command of row.commands) {
    const supply = SUPPLY_DUPLICATE_LINK[command];
    assert.ok(supply,
      `'${command}' declares --link and this sweep has no way to drive it. The identity rule ` +
      "binds every write surface; a surface nothing exercises is how it came to hold at one of " +
      "three. Add a driver rather than removing the command from the row.");
    const cwd = repo();
    const id = supply(cwd);
    const links = epicOf(cwd, id).links.filter(l => l.type === "blocks" && l.epic === "other");
    assert.equal(links.length, 1,
      `${command} recorded ${links.length} entries for one (type, target) — two relationships of ` +
      "the same type between the same pair of epics are one relationship");
    assert.equal(links[0].reason, "second",
      `${command} kept the FIRST reason — a repeat updates the entry's reason in place, and ` +
      "discarding the supplied one removes the only path to correcting it");
  }
});

test("every surface the registry declares reaches `links` through mergeLinks()", async () => {
  // The inversion, so a fifth surface inherits the rule instead of re-implementing it. Scoped to
  // the three modules the registry names: `detour-stack.mjs` and `reconciler-writeback.mjs` also
  // write links, but as ENGINE PROTOCOL with different semantics on purpose (linkOnce() leaves an
  // existing edge's reason alone), and they are not a user supplying a link.
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const row = EPIC_FLAGS.find(f => f.flag === "link");
  for (const command of row.commands) {
    const src = fs.readFileSync(new URL(`../../lib/${command}.mjs`, import.meta.url).pathname, "utf8");
    assert.match(src, /mergeLinks\(/,
      `lib/${command}.mjs declares --link and never calls mergeLinks() — the identity rule is a ` +
      "function every surface calls, not a shape three files are trusted to keep");
  }
});

// ───────── the DATA half of the call-site sweep: a cross-record pointer never leaves quietly ────

test("`--clear plan` says the artifact is un-claimed, and the next sync proves it", () => {
  // THE Gate 2 reproduction, end to end. `--clear plan` is a third un-claim path alongside
  // `remove-epic` (which tombstones) and never registering the artifact at all — and it shipped
  // with neither a tombstone nor a note, so the duplicate-registration defect
  // source-artifacts.mjs exists to make impossible came back through the clearing surface.
  const cwd = repo();
  const plan = path.join(cwd, "docs", "superpowers", "plans", "2026-09-08-a-plan.md");
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, "# a plan\n");
  run(["update-epic", "subject", "--plan", "docs/superpowers/plans/2026-09-08-a-plan.md"], { cwd });

  const skipped = combined(cwd, ["sync"]);
  assert.match(skipped, /claimed by epic 'subject'/,
    "the fixture must actually reach the claim check, or the clear below proves nothing");

  const cleared = combined(cwd, ["update-epic", "subject", "--clear", "plan"]);
  assert.match(cleared, /cleared `subject`'s plan/);
  assert.match(cleared, /registers the file as a NEW untriaged epic/,
    "the note must name the CONSEQUENCE — the next sync re-registers what this epic stopped claiming");
  assert.match(cleared, /--plan <path>/, "and name the way back");
  assert.match(cleared, /tombstone/i,
    "NOT tombstoning is a decision, and an undocumented decision is indistinguishable from an " +
    "omission — the note says so rather than leaving a reader to reason it out from remove-epic");

  // And the consequence is REAL, not just announced.
  const after = combined(cwd, ["sync"]);
  assert.match(after, /1 new epic/,
    "the un-claimed plan is registered again — which is exactly why the note has to exist");
  assert.equal(readState(cwd).syncIgnore, undefined,
    "no tombstone was written: the epic survives, and clearing may mean `let sync find this " +
    "plan's real owner`");
});
