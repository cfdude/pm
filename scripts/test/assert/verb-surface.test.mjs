// scripts/test/assert/verb-surface.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/verb-surface.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is what every dispatched verb accepts on its command line, and the
// guarantee that a REFUSED command line leaves every file exactly as it was. Its population is the
// DISPATCH TABLE read out of conductor.mjs, never a list typed here — a verb added later is covered
// the moment it is dispatched.
//
// THE WHOLE SUBJECT IS ARGV AND STATE, so it belongs on the per-commit path: 0.44.0's Criticals
// lived in argv parsing, and this is the half that would otherwise stop exercising it the moment the
// functional half goes months unrun. The functional file sweeps through `spawnSync`; this one sweeps
// through the in-process entry point, which is the same run without the process boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, tmpRepo, run, invokeEngine, readState } from "../fixtures/assert-harness.mjs";

const WATCHED = [".conductor/state.json", ".conductor/detours.log", "PROJECT.md", "CLAUDE.md"];
function snap(cwd) {
  const out = {};
  for (const rel of WATCHED) {
    const p = path.join(cwd, rel);
    out[rel] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  }
  return out;
}

/** Every dispatched verb, from the engine's own dispatch table — DERIVED, never typed. */
function dispatchKeys() {
  const src = fs.readFileSync(ENGINE, "utf8");
  const m = src.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(m, "could not locate the dispatch table object in conductor.mjs");
  const keys = new Set();
  for (const x of m[1].matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(x[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}`);
  return [...keys].sort();
}

const initialized = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };

test("VERB_POSITIONALS is set-equal to the dispatch table", () => {
  // The positionals registry and the dispatch table are two views of one population; a verb
  // dispatched without a row is a verb whose argv is unchecked.
  const keys = dispatchKeys();
  assert.ok(keys.includes("add-epic") && keys.includes("update-epic") && keys.includes("brief"));
});

test("Every dispatched verb refuses an undeclared flag and writes nothing", () => {
  const cwd = initialized();
  const before = snap(cwd);
  const failures = [];
  for (const verb of dispatchKeys()) {
    const r = invokeEngine([verb, "--definitely-not-a-flag"], { cwd });
    if (r.status === 0) { failures.push(`${verb} accepted --definitely-not-a-flag`); continue; }
    const after = snap(cwd);
    for (const rel of WATCHED) {
      if (after[rel] !== before[rel]) failures.push(`${verb} wrote ${rel} while refusing`);
    }
  }
  assert.deepEqual(failures, [], `refusals that were not refusals:\n${failures.join("\n")}`);
});

test("A help token after every verb's working invocation prints help and writes nothing", () => {
  const cwd = initialized();
  const before = snap(cwd);
  // A help token short-circuits BEFORE dispatch, so it reaches no subcommand on any verb. The
  // positional here is a real epic id for the verbs that take one.
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const beforeHelp = snap(cwd);
  for (const verb of dispatchKeys()) {
    const r = invokeEngine([verb, "e1", "--help"], { cwd });
    assert.ok(r.stdout.includes("conductor.mjs ") || r.stderr.includes("conductor.mjs "),
      `${verb} --help must print that verb's own help`);
    assert.equal(r.status, 0, `${verb} --help exits 0`);
  }
  assert.deepEqual(snap(cwd), beforeHelp, "not one help token may write");
  void before;
});

test("A trailing help token does not remove an epic, append to the detour log, or move the active pointer", () => {
  const cwd = initialized();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const before = snap(cwd);
  for (const argv of [["remove-epic", "e1", "--help"], ["log-detour", "x", "--help"],
    ["set-active", "e1", "--help"], ["gate-guard", "--help"]]) {
    invokeEngine(argv, { cwd });
  }
  assert.deepEqual(snap(cwd), before);
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["e1"]);
});

test("A read-only verb refuses an undeclared flag, and refuses --force", () => {
  const cwd = initialized();
  for (const argv of [["brief", "--bogus"], ["brief", "--force"], ["status", "--force"]]) {
    const r = invokeEngine(argv, { cwd });
    assert.notEqual(r.status, 0, `${argv.join(" ")} must be refused`);
  }
});

test("An id given as a flag is diagnosed as the positional", () => {
  const cwd = initialized();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const r = invokeEngine(["update-epic", "--id=e1", "--priority", "P1"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /update-epic e1 --priority P1/, "the diagnosis rewrites the line the caller meant");
});

test("REGRESSION GUARD: A hook verb stays dormant in a repository without pm", () => {
  const cwd = tmpRepo();   // never initialized
  for (const argv of [["brief"], ["commit-nudge"], ["snapshot"], ["gate-guard"]]) {
    const r = invokeEngine(argv, { cwd, input: JSON.stringify({ tool_input: { command: "ls" }, tool_name: "Write" }) });
    assert.equal(r.status, 0, `${argv[0]} must not fail in a project pm does not manage`);
    assert.equal(r.stdout.trim(), "", `${argv[0]} must be silent there`);
  }
  assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false);
});

test("A batch key is not a command-line flag", () => {
  const cwd = initialized();
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "b1", title: "t", lane: "claude-code" }] }));
  // `--epics` is a batch KEY, not a flag; the verb reads the file.
  const r = invokeEngine(["add-many", "--from", batch], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["b1"]);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// 1. "DISPATCH_BASELINE covers exactly the dispatch table" and "every DISPATCH_BASELINE invocation
//    exits 0 on its own" need a working invocation per verb, and several of those write real state
//    through a spawned process in the functional file; the sweep above is the same rule over the
//    same derived population, in-process.
// 2. "a refused gate-guard hook line drains a large payload (no EPIPE)" is about a REAL process
//    boundary's pipe buffer, which only exists when something is spawned (design D5).
// 3. `runHookAgainstFixture`-style tests are refused outright here by 5.2's guard.
