// scripts/test/conformance.test.mjs
//
// 0.47.0 (engine-invocation, design D10). THE CONFORMANCE SET.
//
// WHAT IT IS FOR. The assertion half will run the engine IN PROCESS, so the real argv string and
// the real process status stop being exercised by most of the suite. The risk this file exists
// against is named in the proposal: 0.44.0's Criticals lived in argv parsing, and a class whose
// in-process status silently diverges from the binary's is a refusal that has stopped refusing —
// `gate-guard` exiting 0 is a SAFETY regression, not a test failure.
//
// So every row here runs the SAME invocation TWICE, by two routes:
//   * as a process (`node scripts/conductor.mjs …`), reading the real exit status;
//   * in-process through `main(argv, io)`, reading the RETURNED value.
// and asserts they are equal. The status is the whole assertion; the two routes' output is
// compared only where a class's meaning IS its output (brief's zero-status warning).
//
// ONE ROW PER CLASS, DERIVED — NOT TYPED FROM MEMORY. The classes come from lib/refusal.mjs plus
// the executable `process.exit` sites the engine had before 0.47.0 (`rg -n 'process\.exit\('
// scripts/lib scripts/conductor.mjs`), which is why a class is not missing here: the enumeration
// is reproducible from the engine rather than recalled from it.
//
// IT IS WRITTEN FIRST AND IT IS THE NET FOR THE CONVERSION. Each refusal now leaves the engine as
// a thrown CommandExit that `main()` maps to its return value; a row that goes red during the
// sweep is the sweep having broken one refusal class, found before it reaches a commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE, EMPTY_CACHE, tmpRepo, run } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { main } = await import("../conductor.mjs");

// ───────────────────────────── fixtures ─────────────────────────────

/** An initialized repository with an active epic, ready for a dispatched verb. */
function initRepo() {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  return cwd;
}

/** An initialized repository whose state.json is UNREADABLE — the conflict-marker shape the
 *  state-file-refuses-to-guess work standardized on. */
function conflictedRepo() {
  const cwd = initRepo();
  const p = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(p, "<<<<<<< HEAD\n" + fs.readFileSync(p, "utf8"));
  return cwd;
}

/** An initialized repository with a live reconcile OWED, built through the verbs that set it
 *  (a detour PUSH followed by a POP) rather than by hand-writing the flag — the same fixture
 *  gate-guard-write-paths.test.mjs's owingRepo() uses, because reconcileNeeded is set at
 *  detour-POP time and cannot be derived from state. */
function owingRepo() {
  const cwd = initRepo();
  for (const id of ["p", "d"]) run(["add-epic", "--id", id, "--lane", "claude-code", "--title", id], { cwd });
  run(["set-active", "p"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"], { cwd });
  run(["pop-detour", "p"], { cwd });
  return cwd;
}

/** A CLAUDE.md holding a THIRD marker line, so the managed block's arrangement is neither "none"
 *  nor "one BEGIN followed by one END" and cannot be located. */
function ambiguousRulesRepo() {
  const cwd = initRepo();
  fs.appendFileSync(path.join(cwd, "CLAUDE.md"),
    "\n<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->\n");
  return cwd;
}

/** A directory shaped like a pm checkout whose engine exits with `exitCode`, optionally having
 *  written `printed.stdout` / `printed.stderr` first.
 *
 *  2.6: the child's bytes are what the delegation row must NOT depend on, and the stdio row must.
 *  Before 2.6 the handoff spawned with `stdio: "inherit"`, so a child that printed put its bytes on
 *  the test runner's own stdout — which is why the delegation row above passes no `printed`. */
function fakeCheckout(exitCode, printed = {}) {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "pm", version: "9.9.9" }) + "\n");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const body = [];
  if (printed.stdout) body.push(`process.stdout.write(${JSON.stringify(printed.stdout)});`);
  if (printed.stderr) body.push(`process.stderr.write(${JSON.stringify(printed.stderr)});`);
  body.push(`process.exit(${exitCode});`);
  fs.writeFileSync(path.join(dir, "scripts", "conductor.mjs"), body.join("\n") + "\n");
  return dir;
}

/** Run an in-process invocation with the process's OWN writers patched-and-forwarded, so a leak
 *  is recorded without corrupting the runner's output. Returns the caller's streams, the status,
 *  and everything that reached the process itself. */
async function withLeakWatch(args, io) {
  let out = "", err = "";
  const callerIo = {
    ...io,
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  };
  const realOut = process.stdout.write, realErr = process.stderr.write;
  let leaked = "";
  process.stdout.write = function (chunk, ...rest) { leaked += String(chunk); return realOut.call(this, chunk, ...rest); };
  process.stderr.write = function (chunk, ...rest) { leaked += String(chunk); return realErr.call(this, chunk, ...rest); };
  let status;
  try { status = await main(args, callerIo); }
  finally { process.stdout.write = realOut; process.stderr.write = realErr; }
  return { status, out, err, leaked };
}

/** ONE state.json write conflict, injected from OUTSIDE the engine. A preload for the process
 *  route (shipped, and used by conductor-25 for the same reason); for the in-process route the
 *  same one-shot patch applied to the shared `fs` singleton, which is what every engine module
 *  reads (`import fs from "node:fs"` is a property lookup at call time). */
function injectConflictOnce(dir) {
  const real = fs.mkdirSync;
  let fired = false;
  fs.mkdirSync = function (p, ...rest) {
    const out = real.call(this, p, ...rest);
    if (!fired && typeof p === "string" && path.resolve(p) === path.resolve(dir)) {
      fired = true;
      const sp = path.join(path.resolve(p), "state.json");
      const s = JSON.parse(fs.readFileSync(sp, "utf8"));
      s.revision = (Number.isInteger(s.revision) ? s.revision : 0) + 1;
      fs.writeFileSync(sp, JSON.stringify(s, null, 2) + "\n");
    }
    return out;
  };
  return () => { fs.mkdirSync = real; return fired; };
}

// ───────────────────────────── the two routes ─────────────────────────────

const baseEnv = (cwd) => ({ ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE });

/** The invocation AS A PROCESS: the real binary, the real argv, the real status. */
function asProcess(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, input, encoding: "utf8",
    env: { ...baseEnv(cwd), ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** The same invocation IN PROCESS, with caller-supplied streams and stdin. Nothing the engine
 *  prints for it may reach this process's own streams — asserted, not assumed, because that is
 *  engine-invocation's guarantee and a leak here would corrupt the test runner's own output. */
async function inProcess(cwd, args, { env = {}, input } = {}) {
  let out = "", err = "";
  const io = {
    cwd,
    env: { ...baseEnv(cwd), ...env },
    stdin: { read: () => input ?? "", isTTY: false },
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  };
  const status = await main(args, io);
  return { status, stdout: out, stderr: err };
}

// ───────────────────────────── the classes ─────────────────────────────
//
// `expected` is the status the BINARY exits with, stated per class from the engine's own mapping
// (lib/refusal.mjs's HOOK_ON_UNREADABLE, CONFLICT_EXIT_CODE 9, UNREADABLE_INPUT_EXIT_CODE 11, and
// the CLI's 0/1). It is not the thing under test — the EQUALITY is.

const ROWS = [
  {
    name: "success — a dispatched verb that writes",
    expected: 0,
    setup: initRepo,
    args: ["add-epic", "--id", "e1", "--lane", "claude-code"],
  },
  {
    name: "a help token — prints the verb's help and exits 0, having written nothing",
    expected: 0,
    setup: initRepo,
    args: ["add-epic", "--help"],
  },
  {
    name: "a command-line refusal — an undeclared flag on a dispatched verb",
    expected: 1,
    setup: initRepo,
    args: ["add-epic", "--id", "e1", "--not-a-flag"],
  },
  {
    name: "an unknown verb — the global usage",
    expected: 1,
    setup: initRepo,
    args: ["not-a-verb"],
  },
  {
    name: "a write conflict — a live lock holds the state file (exit 9, retryable)",
    expected: 9,
    setup: initRepo,
    args: ["add-epic", "--id", "e1", "--lane", "claude-code"],
    env: (cwd) => ({
      NODE_OPTIONS: `--require ${path.join(HERE, "inject-state-conflict.cjs")}`,
      PM_INJECT_CONFLICT_DIR: path.join(cwd, ".conductor"),
      PM_INJECT_CONFLICT_MARKER: path.join(cwd, "conflict-fired.marker"),
    }),
    inProcessEnv: null, // handled below by an fs patch, not by env
    async both(cwd, row) {
      // The process route needs a preload; the in-process route patches the shared `fs` object.
      // Both must be attempted, and the non-vacuity marker is asserted BEFORE the equality.
      const marker = path.join(cwd, "conflict-fired.marker");
      const viaProcess = asProcess(cwd, row.args, { env: row.env(cwd) });
      assert.ok(fs.existsSync(marker),
        "the conflict seam never fired on the process route — equality below would be vacuous");
      fs.rmSync(marker, { force: true });
      const restore = injectConflictOnce(path.join(cwd, ".conductor"));
      let viaInProcess;
      try { viaInProcess = await inProcess(cwd, row.args); }
      finally { assert.ok(restore(), "the conflict seam never fired in-process"); }
      return { viaProcess, viaInProcess };
    },
  },
  {
    name: "an unreadable state file — exit 11 for a dispatched verb",
    expected: 11,
    setup: conflictedRepo,
    args: ["add-epic", "--id", "e2", "--lane", "claude-code"],
  },
  {
    name: "an unreadable state file under gate-guard — exit 2, BLOCK (a hook that stopped blocking is a safety regression)",
    expected: 2,
    setup: conflictedRepo,
    args: ["gate-guard", "--platform", "claude-code"],
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/x.js" } }),
  },
  {
    name: "an unreadable state file under commit-nudge — exit 2, which is visible to the agent and blocks nothing",
    expected: 2,
    setup: conflictedRepo,
    args: ["commit-nudge", "--platform", "claude-code"],
    input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "true" } }),
  },
  {
    name: "an unreadable state file under brief — exit 0, because SessionStart shows a non-zero hook's stderr to the human only",
    expected: 0,
    setup: conflictedRepo,
    args: ["brief", "--platform", "claude-code"],
    input: JSON.stringify({ hook_event_name: "SessionStart" }),
    bothOutput: (a, b) => assert.equal(a.stdout, b.stdout,
      "brief's zero-status refusal IS its stdout — the additionalContext payload must be identical on both routes"),
  },
  {
    name: "a gate-guard reconcile block — exit 2 while an epic still owes its reconcile",
    expected: 2,
    setup: owingRepo,
    args: ["gate-guard", "--platform", "claude-code"],
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/x.js" } }),
  },
  {
    name: "an ambiguous rules block — exit 11, a human fixes the file",
    expected: 11,
    setup: ambiguousRulesRepo,
    args: ["write-rules", "--platform", "claude-code"],
  },
  {
    name: "the delegated handoff — main() returns the CHILD's status",
    expected: 9,
    setup: () => fakeCheckout(9),
    args: ["brief", "--platform", "claude-code"],
    env: (cwd) => ({ PM_ENGINE_DELEGATION: cwd }),
    // The child is a process either way; only the status is compared, and the fake prints nothing.
    bothOutput: () => {},
  },
];

for (const row of ROWS) {
  test(`conformance: ${row.name} — the returned status equals the exited status`, async () => {
    if (row.both) {
      const { viaProcess, viaInProcess } = await row.both(row.setup(), row);
      assert.equal(viaInProcess.status, viaProcess.status,
        `IN-PROCESS status ${viaInProcess.status} != EXITED status ${viaProcess.status}. ` +
        `A refusal class whose two routes disagree is a refusal that has stopped refusing`);
      assert.equal(viaProcess.status, row.expected, `the binary's own status drifted: ${viaProcess.stderr}`);
      return;
    }
    // TWO IDENTICAL FIXTURES, one per route, and that is not tidiness: half these classes MUTATE
    // what they are run against (a successful add-epic creates the epic, a conflict bumps the
    // revision), so running both routes against one fixture would have the second observing the
    // first's effect and comparing two different repository states.
    const cwdForProcess = row.setup();
    const cwdForInProcess = row.setup();
    const viaProcess = asProcess(cwdForProcess, row.args, {
      env: row.env ? row.env(cwdForProcess) : {}, input: row.input,
    });
    const viaInProcess = await inProcess(cwdForInProcess, row.args, {
      env: row.env ? row.env(cwdForInProcess) : {}, input: row.input,
    });
    assert.equal(viaInProcess.status, viaProcess.status,
      `IN-PROCESS status ${viaInProcess.status} != EXITED status ${viaProcess.status}. ` +
      `A refusal class whose two routes disagree is a refusal that has stopped refusing. ` +
      `in-process stderr: ${JSON.stringify(viaInProcess.stderr)}`);
    assert.equal(viaProcess.status, row.expected, `the binary's own status drifted: ${viaProcess.stderr}`);
    if (row.bothOutput) row.bothOutput(viaProcess, viaInProcess);
  });
}

// ───────────────────── 2.6 — the delegated child's stdio IS the invocation's ─────────────────────

test("conformance: nothing a DELEGATED child prints reaches the process's own streams", async () => {
  // 2.6's stdio half. The handoff used to spawn with `stdio: "inherit"`, which hands the child the
  // PARENT PROCESS's descriptors — so `main(argv, io)` printing through a child was the one route by
  // which the engine's output still reached the process's own stdout and stderr, whichever streams
  // the caller supplied. The child's bytes must arrive on the streams the INVOCATION names.
  //
  // BOTH DIRECTIONS ARE ASSERTED. Only checking that the caller received them would pass against a
  // `stdio: "inherit"` plus a tee; only checking the leak would pass against a child whose output was
  // dropped. The verb is irrelevant — the handoff owns the whole invocation before dispatch — so the
  // row reuses the delegation row's command line.
  const cwd = fakeCheckout(0, { stdout: "CHILD-STDOUT-MARKER\n", stderr: "CHILD-STDERR-MARKER\n" });
  const { status, out, err, leaked } = await withLeakWatch(["brief", "--platform", "claude-code"], {
    cwd,
    env: { ...baseEnv(cwd), PM_ENGINE_DELEGATION: cwd },
    stdin: { read: () => "", isTTY: false },
  });
  assert.equal(status, 0, "the delegated child's status is still what main() returns");
  assert.equal(out, "CHILD-STDOUT-MARKER\n", "the child's stdout arrives on the CALLER's stdout");
  assert.equal(err, "CHILD-STDERR-MARKER\n", "and its stderr on the caller's stderr");
  assert.doesNotMatch(leaked, /CHILD-STDOUT-MARKER|CHILD-STDERR-MARKER/,
    "and neither reached the PROCESS's own streams — the child inherits the INVOCATION's stdio, " +
    "not the process's, or engine-invocation's guarantee is false for the one route that spawns");
});

test("conformance: the entry point never ends the calling process, whatever it is refused for", async () => {
  // The refusal classes above prove the STATUS. This proves the other half of the requirement —
  // that reaching the assertion at all is possible, for the class whose whole point is stopping a
  // process: a hook block whose in-process route called process.exit would have killed the runner.
  const cwd = owingRepo();
  const io = {
    cwd,
    env: baseEnv(cwd),
    stdin: { read: () => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/x.js" } }), isTTY: false },
    stdout: { write: () => true },
    stderr: { write: () => true },
  };
  assert.equal(await main(["gate-guard", "--platform", "claude-code"], io), 2);
  assert.equal(await main(["not-a-verb"], { ...io, stdin: { read: () => "", isTTY: false } }), 1);
  assert.ok(true, "the process survived both");
});

test("conformance: main() RETURNS its status — it is not a promise", () => {
  // WHY THIS IS A REQUIREMENT AND NOT A STYLE CHOICE. The assertion half runs one process for the
  // whole suite, and 1,624 of the suite's 1,852 `test(...)` callbacks are SYNCHRONOUS. `await` inside
  // a sync callback is a syntax error, so an entry point that answered with a Promise would leave two
  // options, both bad: convert 1,624 callbacks, or keep spawning a child — which is the process
  // boundary the assertion half exists to remove. A sync status is what makes the in-process `run()`
  // of task 5.1 callable at all.
  //
  // engine-invocation says only that the entry point "RETURNS a numeric exit status" and says nothing
  // about how; a synchronous return satisfies it strictly more than an async one does, so this adds
  // a constraint rather than relaxing the spec.
  //
  // THE ASSERTION IS ASSERTED TO DISCRIMINATE. `status instanceof Promise` alone would pass for a
  // thenable that is not a Promise — which is exactly what `async` compiles to at the boundary a
  // caller can see — so the thenable test is what actually fires.
  const cwd = initRepo();
  const io = {
    cwd,
    env: baseEnv(cwd),
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true },
    stderr: { write: () => true },
  };
  const returned = main(["brief", "--platform", "claude-code"], io);
  assert.equal(typeof returned, "number",
    "main() returned a " + Object.prototype.toString.call(returned) + " rather than a numeric " +
    "status; a Promise (or any thenable) cannot be read by the 1,624 synchronous test callbacks " +
    "the assertion half is made of");
  assert.equal(typeof returned.then, "undefined",
    "main() returned a THENABLE — awaiting it would work and reading it as a status would not, " +
    "which is the shape an `async function` produces");
});

test("conformance: nothing the engine prints for an invocation reaches the process's own streams", async () => {
  // engine-invocation states this as a SHALL, and it is the property that makes one process able
  // to serve many invocations without their output interleaving.
  //
  // BOTH HALVES ARE ASSERTED, and the process's own writers are PATCHED-AND-FORWARDED rather than
  // swallowed: a watcher that swallowed them would corrupt the test runner's own output, and one
  // that recorded without forwarding would make the runner's writes look like leaks. So every
  // process-level write is forwarded untouched and also recorded, and the assertion is that the
  // engine's own text is not among what was recorded.
  const cwd = initRepo();
  let out = "", err = "";
  const io = {
    cwd, env: baseEnv(cwd), stdin: { read: () => "", isTTY: false },
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  };
  const realOut = process.stdout.write, realErr = process.stderr.write;
  let leaked = "";
  process.stdout.write = function (chunk, ...rest) { leaked += String(chunk); return realOut.call(this, chunk, ...rest); };
  process.stderr.write = function (chunk, ...rest) { leaked += String(chunk); return realErr.call(this, chunk, ...rest); };
  let accepted, refused;
  try {
    accepted = await main(["add-epic", "--id", "e1", "--lane", "claude-code"], io);
    refused = await main(["add-epic", "--id", "e2", "--not-a-flag"], io);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  assert.equal(accepted, 0, `the accepted invocation returns 0; stderr: ${err}`);
  assert.equal(refused, 1, "the refused invocation returns 1 and the caller survives it");
  assert.match(out + err, /added epic 'e1'/, "the caller's own streams hold the verb's result");
  assert.match(err, /unknown flag --not-a-flag/, "the caller's stderr holds the refusal");
  assert.doesNotMatch(leaked, /conductor:|added epic|unknown flag/,
    "and NOTHING the engine printed for either invocation reached the process's own streams");
});

test("conformance: two invocations in one process act on their own roots", async () => {
  // The two-roots guarantee, at its smallest: the SECOND call must not inherit the first's
  // arguments, environment or working directory. Fails against any captured-at-load root.
  const first = initRepo();
  const second = initRepo();
  const ioFor = (cwd) => ({
    cwd,
    env: baseEnv(cwd),
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });
  assert.equal(await main(["add-epic", "--id", "alpha", "--lane", "claude-code"], ioFor(first)), 0);
  assert.equal(await main(["add-epic", "--id", "beta", "--lane", "claude-code"], ioFor(second)), 0);
  const ids = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"))
    .epics.map(e => e.id).sort();
  assert.deepEqual(ids(first), ["alpha"], "the first root holds exactly the epic its own call created");
  assert.deepEqual(ids(second), ["beta"], "the second root holds exactly the epic its own call created");
});

// ───────────────────────────── 2.5 — the activity log ─────────────────────────────

/** Every event line the activity log holds for `cwd`, across whatever segments exist. */
function activityLines(cwd) {
  const dir = path.join(cwd, ".conductor", "activity");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const f = path.join(dir, name);
    return fs.statSync(f).isFile() ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
  });
}

test("conformance: the engine registers no process exit handler", () => {
  // 2.5 moved the activity log's instrumentation out of `process.on("exit")` and into main()'s own
  // control flow. The exit-handler shape was argued for in a comment that is now false — refusals
  // are THROWN and caught, so the `finally` it feared losing runs on every path — and leaving it
  // would be a defect specific to the assertion half: in one shared process every call would
  // register another listener, none would fire until the runner exited, and main() would have
  // returned long before the diff it owes. A source guard, so the shape cannot come back silently.
  const src = fs.readFileSync(path.join(HERE, "..", "conductor.mjs"), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /process\.on\(\s*["'`]exit["'`]/,
    "the engine must not instrument anything through a process exit handler — main() owns the " +
    "invocation's whole lifetime, and an exit handler outlives it");
});

test("conformance: the activity log is written BY main(), once per invocation, before it returns", async () => {
  const cwd = initRepo();
  run(["set-activity-log", "on"], { cwd });
  const io = () => ({
    cwd, env: baseEnv(cwd), stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true }, stderr: { write: () => true },
  });
  assert.equal(await main(["add-epic", "--id", "e1", "--lane", "claude-code"], io()), 0);
  assert.equal(activityLines(cwd).length, 1,
    "the first invocation's line is on disk the moment main() returns — not at some later process end");
  assert.equal(await main(["add-epic", "--id", "e2", "--lane", "claude-code"], io()), 0);
  assert.equal(activityLines(cwd).length, 2);
  assert.equal(await main(["add-epic", "--id", "e3", "--lane", "claude-code"], io()), 0);
  assert.equal(activityLines(cwd).length, 3,
    "one line per invocation: an exit handler would have produced ZERO here, and three at process end");
});
