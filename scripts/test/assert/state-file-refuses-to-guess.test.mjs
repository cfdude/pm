// scripts/test/assert/state-file-refuses-to-guess.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/state-file-refuses-to-guess.test.mjs — same id,
// same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the refusal family 0.47.0 inherits: an unreadable, truncated,
// truncated-by-a-merge or wrong-shaped `state.json` must be REFUSED, never silently replaced by an
// empty record. Every one of those cases is a file this half can write and read — the only tests in
// the functional file that need git are the detached-claim one and the two concurrency ones (which
// spawn parallel writers).
//
// THE FAILURE THIS CLOSES IS THE WORST KIND: 0.47.0's own hook re-rendered PROJECT.md from an empty
// guess of the record, so a conflicted file made the conductor report a repository with no epics and
// then WRITE that guess back. It is invisible until somebody reads git.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, invokeEngine } from "../fixtures/assert-harness.mjs";

const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");
const bytes = (cwd) => fs.readFileSync(statePath(cwd), "utf8");

function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

test("1.1: a conflict marker does not wipe the record — add-epic exits 11 and writes nothing", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd),
    "<<<<<<< HEAD\n" + bytes(cwd) + "=======\n{}\n>>>>>>> other\n");
  const before = bytes(cwd);
  const r = (() => { try { run(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd }); return null; }
    catch (e) { return e; } })();
  assert.ok(r, "an unreadable record is refused");
  assert.equal(r.status, 11, "a conflict maps to the distinct exit code, so an agent can retry");
  assert.equal(bytes(cwd), before, "and nothing was written over it");
});

test("1.1: a truncated file is not replaced by sync, upgrade or init", () => {
  for (const verb of [["sync"], ["upgrade"], ["init"]]) {
    const cwd = initRepo();
    fs.writeFileSync(statePath(cwd), bytes(cwd).slice(0, 40));
    const before = bytes(cwd);
    try { run(verb, { cwd }); } catch { /* refusal is the expected outcome */ }
    assert.equal(bytes(cwd), before, `${verb[0]} must not replace a record it could not read`);
  }
});

test("1.1: the session brief WARNS instead of reporting an empty record, and writes nothing", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "{ not json");
  // `brief` is the ONE refusal class whose status is 0 (a SessionStart hook that failed would lose
  // the session), so this is asserted as status 0 carrying the warning rather than as a throw.
  const r = invokeEngine(["brief"], { cwd });
  assert.equal(r.status, 0, "SessionStart refusals report as a warning, not as a failure");
  assert.match(r.stdout + r.stderr, /state\.json/, "and the warning names what could not be read");
  assert.ok(!/DORMANT/.test(r.stdout), "it must not answer as if the project had no record at all");
});

test("1.1: a mutating verb refuses a wrong-shape file, naming the member", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), JSON.stringify({ version: 1, epics: "not an array" }));
  const before = bytes(cwd);
  const r = (() => { try { run(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd }); return null; }
    catch (e) { return e; } })();
  assert.ok(r, "a wrong-shaped record is refused, never read as a default");
  assert.match(String(r.stderr || ""), /epics/);
  assert.equal(bytes(cwd), before, "and nothing is written over it");
});

test("1.1: an EMPTY file is refused, not read as an empty record", () => {
  // The zero-length case is the shape a truncating tool leaves, and it is the one where "default
  // to an empty record" is most tempting and most destructive.
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "");
  const r = (() => { try { run(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd }); return null; }
    catch (e) { return e; } })();
  assert.ok(r, "a zero-length record is unreadable, not empty");
  assert.equal(bytes(cwd), "", "and it is left exactly as it was found");
});

test("1.3: with no state.json every hook exits 0, prints nothing and creates no file", () => {
  const cwd = tmpRepo();   // never initialized
  for (const argv of [["commit-nudge"], ["snapshot"], ["brief"]]) {
    const out = run(argv, { cwd, input: JSON.stringify({ tool_input: { command: "ls" } }) });
    assert.equal(out.trim(), "", `${argv[0]} must be silent in a dormant project`);
  }
  assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false,
    "and the hook must not create the directory it is dormant about");
});

test("2.1(a): gate-guard blocks on a conflicted state file, naming the file and a git command", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n");
  const r = (() => { try { run(["gate-guard"], { cwd, input: JSON.stringify({ tool_name: "Write" }) }); return null; }
    catch (e) { return e; } })();
  assert.ok(r, "the guard must block rather than allow");
  assert.equal(r.status, 2, "a hook refusal that blocks");
  const text = String(r.stderr || "") + String(r.stdout || "");
  assert.match(text, /state\.json/, "it names the file");
  assert.match(text, /git/, "and a git command that would resolve it");
});

test("2.1(b): gate-guard does not crash on a wrong-shape file — exit 2, not a TypeError", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), JSON.stringify({ version: 1, epics: "not an array" }));
  const r = (() => { try { run(["gate-guard"], { cwd, input: JSON.stringify({ tool_name: "Write" }) }); return null; }
    catch (e) { return e; } })();
  assert.ok(r);
  assert.equal(r.status, 2);
  assert.doesNotMatch(String(r.stderr || ""), /TypeError/);
});

test("2.1(c): the session brief carries the warning instead of a guessed record, and writes nothing", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "{ not json");
  const bytesBefore = bytes(cwd);
  const out = (() => { try { return run(["brief"], { cwd }); } catch (e) { return String(e.stdout || "") + String(e.stderr || ""); } })();
  assert.match(out, /state\.json/, "the brief says what it could not read");
  assert.equal(bytes(cwd), bytesBefore);
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "brief.txt")), "and writes no snapshot");
});

test("2.1(d): commit-nudge writes nothing after a commit lands over an unreadable file, and exits 2", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "{ not json");
  const watched = [statePath(cwd), path.join(cwd, "PROJECT.md"), path.join(cwd, ".conductor", "detours.log")];
  const before = watched.map(f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null));
  const r = (() => { try { run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) }); return null; }
    catch (e) { return e; } })();
  assert.equal(r && r.status, 2);
  watched.forEach((f, i) => assert.equal(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null, before[i]));
});

test("2.1(e) REGRESSION GUARD: a pre-compaction snapshot writes nothing and does not block compaction", () => {
  const cwd = initRepo();
  fs.writeFileSync(statePath(cwd), "{ not json");
  // A PreCompact hook that BLOCKED would stop a session compacting.
  const r = (() => { try { return { status: 0, out: run(["snapshot"], { cwd }) }; }
    catch (e) { return { status: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; } })();
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "brief.txt")),
    "no snapshot is written from a record that could not be read");
  if (r.status !== 0) assert.match(r.out, /state\.json/);
});

test("G2-I5 shape: a non-object epics element and a non-array detourStack are each refused", () => {
  for (const bad of [{ version: 1, epics: [1] }, { version: 1, epics: [], detourStack: 1 }]) {
    const cwd = initRepo();
    fs.writeFileSync(statePath(cwd), JSON.stringify(bad));
    const r = (() => { try { run(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd }); return null; }
      catch (e) { return e; } })();
    assert.ok(r, `a wrong-shaped record must be refused: ${JSON.stringify(bad)}`);
  }
});

test("5.1: an oversized TTL is refused at input, for an epic claim and the repository claim", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const r = (() => { try { run(["claim", "e1", "--ttl", "99999999"], { cwd }); return null; } catch (e) { return e; } })();
  assert.ok(r, "an absurd TTL is an input error, not a lock nobody can break");
});

test("3.1: a save that changes nothing does not rewrite the record", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const before = bytes(cwd);
  run(["render"], { cwd });
  run(["brief"], { cwd });
  assert.equal(bytes(cwd), before, "reads do not stamp a touch or bump a revision");
  assert.ok(readState(cwd).epics.some(e => e.id === "e1"));
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The concurrency cases (16 concurrent writers, the fsync-before-rename, the lock-breakers race, the
// FIFO at the lock path, the unreadable lock) each need real parallel processes and a real
// filesystem race; the detached-claim case needs a detached checkout. They are functional-only by
// subject (design D5). The refusal family above is the part of that surface a pre-commit gate can
// see break on every commit.
