// scripts/test/state-write-verification.test.mjs
// #140 — `update-epic --attribute-commit <sha>` reported success for four commits across two
// epics and the array that was supposed to hold them read `[]` three commits later.
//
// READ THE SCOPE CLAIM CAREFULLY, because it is easy to overstate: in the filed incident the
// working tree DID hold all four values. The write landed; the loss happened at `git commit`
// time, and its mechanism is still unestablished. Nothing in this file would have caught that
// incident. What it closes is the class the verb could not previously distinguish — a write
// path that reports success without the value being on disk afterwards — which is the half of
// #140 that is actually a defect in this engine rather than in a git invocation.
//
// The failure is injected by neutering `fs.renameSync`, which is the real shape: every step
// reports success and the file on disk is not what this process wrote.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Set BEFORE importing anything that reads it: constants.mjs binds ROOT at module scope, and a
// stray write from an in-process test would otherwise land in this repository's own .conductor.
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), "pm-persist-"));
process.env.CLAUDE_PROJECT_DIR = CWD;
fs.mkdirSync(path.join(CWD, ".conductor"), { recursive: true });

const { saveState, loadState, StatePersistError, persistFailure } = await import("../lib/state.mjs");
const { missingAttributions, updateEpic } = await import("../lib/update-epic.mjs");

const STATE = path.join(CWD, ".conductor", "state.json");
const seed = () => {
  fs.writeFileSync(STATE, JSON.stringify({ version: 1, revision: 3, active: null, detourStack: [],
    epics: [{ id: "e1", title: "e1", priority: "P1", status: "queued", role: "epic",
      lane: "claude-code", links: [], attributedCommits: [] }] }, null, 2) + "\n");
};

// ───────────── the predicate, every branch ─────────────

test("140: bytes that match are not a failure", () => {
  assert.equal(persistFailure({ expectedBytes: "x", diskBytes: "x", expectedRevision: 4, diskRevision: 4 }), null);
});

test("140: a NEWER revision on disk is a supersession, not this write's failure", () => {
  // The false positive that would otherwise make this guard unusable alongside the existing
  // revision guard: A renames, B loads and writes, A reads back B's bytes. A's write landed and
  // was legitimately replaced. Reporting that as "your write did not persist" would turn a
  // benign interleave — routine with concurrent agents and hook-driven renders — into an error,
  // and would override the documented `onConflict: "skip"` policy for writes that did not matter.
  assert.equal(persistFailure({ expectedBytes: "x", diskBytes: "y", expectedRevision: 4, diskRevision: 5 }), null);
});

test("140: bytes that differ at the SAME revision are a failure", () => {
  const why = persistFailure({ expectedBytes: "x", diskBytes: "y", expectedRevision: 4, diskRevision: 4 });
  assert.ok(why, "same revision, different bytes: nothing superseded this write and it is not there");
  assert.match(why, /revision 4/);
});

test("140: bytes that differ at an OLDER revision are a failure — the write never landed", () => {
  assert.ok(persistFailure({ expectedBytes: "x", diskBytes: "y", expectedRevision: 4, diskRevision: 3 }));
});

test("140: an unreadable file after a write that reported success is a failure", () => {
  assert.ok(persistFailure({ expectedBytes: "x", diskBytes: null, expectedRevision: 4, diskRevision: null }));
});

// ───────────── the write path, end to end ─────────────

test("140: an ordinary save verifies and returns ok", () => {
  seed();
  const s = loadState();
  s.epics[0].attributedCommits.push("abc1234");
  const r = saveState(s, { verb: "update-epic" });
  assert.equal(r.ok, true);
  assert.deepEqual(loadState().epics[0].attributedCommits, ["abc1234"]);
});

test("140: a save whose bytes do not reach the disk THROWS instead of reporting success", () => {
  seed();
  const s = loadState();
  s.epics[0].attributedCommits.push("abc1234");
  const real = fs.renameSync;
  fs.renameSync = () => {};   // every call reports success; nothing reaches STATE
  try {
    assert.throws(() => saveState(s, { verb: "update-epic" }), (e) => {
      assert.ok(e instanceof StatePersistError,
        "a write that did not persist is its own error class, not a conflict and not a generic throw");
      assert.match(e.message, /update-epic/, "the error must name the verb that lied");
      return true;
    });
  } finally { fs.renameSync = real; }
  assert.deepEqual(loadState().epics[0].attributedCommits, [],
    "and the disk is genuinely unchanged — the throw is not a false alarm");
});

test("140: a save superseded by a newer revision between rename and read-back does NOT throw", () => {
  seed();
  const s = loadState();
  s.epics[0].attributedCommits.push("abc1234");
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    real.call(fs, from, to);
    // Another writer lands a NEWER revision in the window. Our write happened; theirs won.
    const disk = JSON.parse(fs.readFileSync(to, "utf8"));
    fs.writeFileSync(to, JSON.stringify({ ...disk, revision: disk.revision + 1, active: "e1" }, null, 2) + "\n");
  };
  try {
    assert.doesNotThrow(() => saveState(s, { verb: "update-epic" }));
  } finally { fs.renameSync = real; }
});

// ───────────── the flag's own read-back ─────────────

test("140: missingAttributions names exactly the shas absent from the record on disk", () => {
  const state = { epics: [{ id: "e1", attributedCommits: ["aaa"] }] };
  assert.deepEqual(missingAttributions(state, "e1", ["aaa"]), []);
  assert.deepEqual(missingAttributions(state, "e1", ["aaa", "bbb"]), ["bbb"]);
});

test("140: an epic that vanished, or an array that did, counts as everything missing", () => {
  assert.deepEqual(missingAttributions({ epics: [] }, "e1", ["aaa"]), ["aaa"]);
  assert.deepEqual(missingAttributions({ epics: [{ id: "e1" }] }, "e1", ["aaa"]), ["aaa"]);
});

/** Run `updateEpic()` in-process with a given argv, capturing stderr and turning the command's
 *  `process.exit` into a throw so a non-zero exit is observable rather than fatal. */
function runUpdateEpic(args) {
  const argv = process.argv, exit = process.exit, write = process.stderr.write;
  let err = "", code = 0;
  process.argv = ["node", "conductor.mjs", "update-epic", ...args];
  process.stderr.write = (s) => { err += s; return true; };
  process.exit = (c) => { code = c; throw new Error("EXIT"); };
  try { updateEpic(); } catch (e) { if (e.message !== "EXIT") throw e; }
  finally { process.argv = argv; process.exit = exit; process.stderr.write = write; }
  return { err, code };
}

test("140: --attribute-commit reports success only when the sha is on disk afterwards", () => {
  seed();
  const r = runUpdateEpic(["e1", "--attribute-commit", "abc1234"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /updated 'e1'/);
  assert.deepEqual(loadState().epics[0].attributedCommits, ["abc1234"]);
});

test("140: an attribution superseded before the command returns FAILS instead of saying 'updated'", () => {
  // #140's first candidate mechanism, reproduced: a later write re-serialises state.json from a
  // copy read BEFORE the attribution. It carries a higher revision, so the write path's own
  // read-back correctly stays silent — nothing about this write failed, and something newer
  // explains the bytes. The command's claim is false all the same, and only a read-back at the
  // END of the command can see that. This is the test that fails if the call site in
  // updateEpic() is removed while missingAttributions() itself is left intact.
  seed();
  const real = fs.renameSync;
  let once = false;
  fs.renameSync = (from, to) => {
    real.call(fs, from, to);
    if (once || !String(to).endsWith("state.json")) return;
    once = true;
    const disk = JSON.parse(fs.readFileSync(to, "utf8"));
    disk.revision += 1;
    for (const e of disk.epics) e.attributedCommits = [];
    fs.writeFileSync(to, JSON.stringify(disk, null, 2) + "\n");
  };
  let r;
  try { r = runUpdateEpic(["e1", "--attribute-commit", "abc1234"]); }
  finally { fs.renameSync = real; }
  assert.equal(r.code, 1, "a verb that reports success for a write that is not there is the defect");
  assert.match(r.err, /NOT in \.conductor\/state\.json/);
  assert.match(r.err, /abc1234/);
  assert.doesNotMatch(r.err, /updated 'e1'/, "success must not be claimed alongside the failure");
});
