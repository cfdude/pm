// scripts/test/assert/store-seam.test.mjs
// 1.1 (RED) and 1.5 (RED) — THE SEAM'S OWN PROOFS (design D7).
//
// WHAT THIS FILE IS FOR. `store.mjs` is the seam that lets a test whose observable is a VALUE stop
// paying for a durability flush it does not read. A seam that wide can hide two failures, and this
// file is written to catch both rather than to demonstrate that the happy path works:
//
//   * THE TWO STORES CAN DISAGREE. The engine's decisions must not change when its sink does. So
//     the same accepted invocation is made twice in ONE process — once through the store the
//     command line builds, once through a store that keeps the record in memory — and the STATUS and
//     the RECORD must match (`engine-invocation`'s "A verb produces the same result through an
//     in-memory store as through the disk store").
//
//   * THE MEMORY STORE CAN BE WEAKER THAN THE DISK ONE (1.5). The likeliest way the seam quietly
//     weakens the engine is a memory implementation that skips the comparison or the shape check it
//     inherited — then a unit test asserts behaviour no real invocation has. So 1.5 hands the memory
//     store a STALE revision, a NO-OP write, and a record whose SHAPE the strict read refuses, and
//     asserts each meets the same door the disk store puts up.
//
// WHY THE ASSERTIONS COMPARE ISOLATED OF THE TWO TIMESTAMP FIELDS. Two runs of the same verb are
// two instants: `createdAt` and `touchedAt` are `new Date().toISOString()` and CANNOT be equal
// across them. Stripping exactly the fields the engine itself strips (`TIMEKEEPING_FIELDS`, which
// state.mjs exports precisely so this population is derived rather than transcribed) compares
// everything the verb DECIDED and nothing the clock decided.
//
// THIS FILE IS ON THE FILE RUNG, and it is not a candidate for the unit rung: half of its subject
// is the DISK store, which is bytes on disk by construction. It is the seam's test, not a unit
// test, and it lives in scripts/test/assert/ for that reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { invokeEngine, tmpRepo } from "../fixtures/assert-harness.mjs";
import { conflictExitCode, diskStore, memoryStore } from "../../lib/store.mjs";
import { TIMEKEEPING_FIELDS } from "../../lib/state.mjs";

/** The error a throwing call produced, or the value it returned, as one shape to compare. */
function expectThrow(fn) {
  try { return fn(); } catch (e) { return e; }
}

/** A record with the two timekeeping fields removed, deep — the comparison the seam owes. */
function withoutClock(state) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (TIMEKEEPING_FIELDS.includes(k)) continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(state);
}

const readRecordBytes = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));

/** ONE accepted invocation that writes the record AND renders an artifact, so the proof covers the
 *  two things the store owns rather than the record alone. */
const ACCEPTED = ["add-epic", "--id", "probe", "--lane", "claude-code", "--title", "Probe"];

test("1.1 the same invocation returns the same status and the same record through either store", () => {
  // ── the DISK store: the store the command line builds, on a real repository ──
  const diskRoot = tmpRepo();
  const initDisk = invokeEngine(["init"], { cwd: diskRoot });
  assert.equal(initDisk.status, 0, `init through the disk store must succeed: ${initDisk.stderr}`);
  const before = readRecordBytes(diskRoot);

  const onDisk = invokeEngine(ACCEPTED, { cwd: diskRoot });
  assert.equal(onDisk.status, 0, `the accepted invocation must succeed on disk: ${onDisk.stderr}`);

  // ── the MEMORY store: the SAME invocation, the same starting record, no path ──
  const memRoot = tmpRepo();
  const memory = memoryStore(before);
  const inMemory = invokeEngine(ACCEPTED, { cwd: memRoot, store: memory });
  assert.equal(inMemory.status, 0,
    `the accepted invocation must succeed through the memory store too: ${inMemory.stderr}`);

  // THE STATUS IS THE SAME.
  assert.equal(inMemory.status, onDisk.status, "the status must not depend on which store was supplied");

  // THE RECORD THE CALLER CAN READ AFTERWARDS HOLDS THE SAME VALUES. On disk that is the file; in
  // memory it is the object the caller handed in, read back from the store it supplied.
  assert.deepEqual(withoutClock(memory.record()), withoutClock(readRecordBytes(diskRoot)),
    "the two stores must agree on every value the verb decided");

  // ...and the invocation that used the memory store created no file THAT THE STORE OWNS. The
  // qualification is the store's own boundary, drawn in store.mjs's ownership table: a verb that
  // also refreshes a repository file the store does not own (here `add-epic` renders PROJECT.md
  // through the store, and nothing else) still writes that file. `.conductor/state.json` is the
  // record, and it is the one this invocation must not have created.
  assert.ok(!fs.existsSync(path.join(memRoot, ".conductor", "state.json")),
    "the in-memory store must not have created a record file");
  assert.equal(memory.read("state.json").kind, "absent",
    "nor may it have written one through the artifact interface");
});

test("1.1 two stores in one process do not observe each other", () => {
  // The independence half, and it is the half a seam like this fails SILENTLY: one process, two
  // invocations, two stores, and a shared module-scope path would make the second write the first's
  // file. `engine-invocation` states it as a SHALL; this is the test that can see it.
  const first = memoryStore({ version: 1, revision: 0, active: null, epics: [
    { id: "only-in-a", title: "a", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ], detourStack: [] });
  const second = memoryStore({ version: 1, revision: 0, active: null, epics: [], detourStack: [] });

  const rootA = tmpRepo();
  const rootB = tmpRepo();
  const a = invokeEngine(["brief"], { cwd: rootA, store: first });
  const b = invokeEngine(["add-epic", "--id", "only-in-b", "--lane", "claude-code"], { cwd: rootB, store: second });
  assert.equal(a.status, 0, `the first invocation must succeed: ${a.stderr}`);
  assert.equal(b.status, 0, `the second invocation must succeed: ${b.stderr}`);

  // A saw its own record and B never saw A's: B's record holds B's epic and NOT A's, and A's record
  // still holds exactly the one record it was seeded with.
  assert.deepEqual(second.record().epics.map(e => e.id), ["only-in-b"],
    "the second store must act on its own record");
  assert.deepEqual(first.record().epics.map(e => e.id), ["only-in-a"],
    "nor may the first store's record gain the second's epic");
  assert.ok(!fs.existsSync(path.join(rootB, ".conductor", "state.json")),
    "neither invocation may write the other's paths — and a memory store writes no path at all");
});

test("1.5 a STALE revision, a NO-OP write and an UNREADABLE record meet the same door in both stores", () => {
  // The revision guard and the shape guard are the two invariants a memory store could most easily
  // lose, and losing either would let a unit test assert behaviour no real invocation has. Both
  // halves are measured against the SAME expectation — the two stores' answers are compared, rather
  // than each asserted against a value typed here — so "the same refusal" is a measurement.
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const held = { version: 1, revision: 5, active: null, epics: [
    { id: "held", title: "h", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ], detourStack: [] };
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(held, null, 2) + "\n");

  const ctx = { cwd, root: cwd, env: { ...process.env }, argv: ["node", "conductor.mjs"] };
  const disk = diskStore(ctx);
  const memory = memoryStore(held);
  const stale = { version: 1, revision: 0, active: null, epics: [
    { id: "late", title: "l", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ], detourStack: [] };

  // ── the STALE revision ──
  const diskErr = expectThrow(() => disk.writeRecord(stale));
  const memErr = expectThrow(() => memory.writeRecord(stale));
  assert.equal(diskErr.name, "StateConflictError", `the disk store must refuse a stale revision: ${diskErr}`);
  assert.equal(memErr.name, "StateConflictError", `the memory store must refuse it too: ${memErr}`);
  assert.equal(memErr.expected, diskErr.expected, "the same expected revision");
  assert.equal(memErr.found, diskErr.found, "and the same revision found");
  assert.equal(conflictExitCode(memErr), conflictExitCode(diskErr),
    "the STATUS a caller exits with must not depend on the store");
  assert.equal(conflictExitCode(diskErr), 9, "and it is the conflict exit code, not 1");

  // ── the NO-OP write ──
  const diskNoop = disk.writeRecord(structuredClone(held));
  const memNoop = memory.writeRecord(memory.record());
  assert.deepEqual({ ...diskNoop }, { ...memNoop }, "a write that changes nothing must report the same thing in both");
  assert.equal(memNoop.unchanged, true, "and it must be reported as a no-op rather than silently bumped");
  assert.equal(memory.record().revision, 5, "a no-op save must not advance the revision");

  // ── the SHAPE the strict read refuses ──
  // A memory store that skipped the shape check would let a unit test assert a record a real load
  // refuses; the whole point of the check is that the two cannot differ (I6).
  const bad = { version: 1, revision: 5, active: null, epics: "not an array", detourStack: [] };
  assert.equal(memoryStore(bad).readRecord().kind, "unreadable",
    "the memory store's strict read must refuse a shape the disk store refuses");
  assert.equal(diskStore(ctx).readRecord().kind, "ok", "precondition: the disk record is well-shaped");

  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(bad, null, 2) + "\n");
  assert.equal(diskStore(ctx).readRecord().kind, "unreadable", "and so must the disk store's, on the same value");
  const memShape = expectThrow(() => memoryStore(bad).writeRecord({ version: 1, revision: 0, epics: [], detourStack: [] }));
  const diskShape = expectThrow(() => diskStore(ctx).writeRecord({ version: 1, revision: 0, epics: [], detourStack: [] }));
  assert.equal(memShape.name, "StateUnreadableError", `the memory store must refuse to write over an unreadable record: ${memShape}`);
  assert.equal(memShape.name, diskShape.name, "and with the same error class the disk store uses");
});
