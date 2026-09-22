// scripts/test/gate-guard-write-paths.test.mjs
// the-guard-covers-every-write-path — the gate guard covers Bash write shapes.
//
// The guard was registered for `Edit|Write|NotebookEdit` only, so an agent blocked on `Edit` wrote
// the same file with `cat > f <<EOF`, `sed -i` or `tee` in one hop, and the block's own message
// claimed "Completing the reconcile gate is the only way through" while that was false as shipped.
//
// 4.1 (0.48.0) moved TWENTY-SEVEN of this file's thirty-three tests to
// `scripts/test/unit/gate-guard-write-paths.test.mjs`: layer 1 over the exported function, the whole
// hook family end to end, the tracker-refresh arm, both "nothing today's behaviour moves" guards,
// the two through-the-hook scenarios and the marker remedy's own row. Over the memory store the
// `owingRepo()` fixture builds the same RECORD in about a millisecond instead of 133 ms — the record
// is the whole of what the guard reads — and each call returns a fresh engine, which is the
// per-test isolation the `fixtureOnce` snapshot's copy was there to provide.
//
// WHAT REMAINS IS THE SIX THAT NEED A PATH, in three groups:
//   1. 1.3's two source scans — the closed list must appear in `gate-guard.mjs` and in NO other
//      engine source, which is a walk over `scripts/` reading every file.
//   2. 2.5's three — an unreadable record is RAW BYTES with a conflict marker in front, and the
//      memory store holds an object; it can answer "unreadable" only through `shapeProblem()`.
//   3. 3.1 — the shipped `hooks/hooks.json` matcher, read from the file so a rollback is visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fixtureOnce } from "../fixtures/fixture-snapshot.mjs";
import { WRITE_SHAPE_LABELS } from "../../lib/gate-guard.mjs";

// ─────────────── 1.3 — the list is defined once ───────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sweptSources = () => ["scripts/conductor.mjs",
  ...fs.readdirSync(path.join(REPO, "scripts", "lib")).filter(f => f.endsWith(".mjs")).sort()
    .map(f => `scripts/lib/${f}`)];

test("1.3 REGRESSION GUARD: the closed shape list has exactly one definition site", () => {
  // A future shape must be added in ONE place. A second copy of any row — a label, the in-place
  // editor family, the copier family or the record pattern — is a list that drifts, and a guard
  // half of whose rows are live is worse than one whose rows are all in view.
  const rows = [
    ...Object.values(WRITE_SHAPE_LABELS).filter(l => l.includes(" ")),   // the multi-word labels
    '["sed", "gsed", "perl", "ruby"]',
    '["cp", "mv", "install", "rsync", "dd", "truncate", "patch"]',
    '["rm", "unlink", "shred"]',
    '["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]',
    "\\.conductor(\\*|\\/(state\\.json\\*?|\\*))?",
  ];
  for (const row of rows) {
    const holders = sweptSources().filter(rel => fs.readFileSync(path.join(REPO, rel), "utf8").includes(row));
    assert.deepEqual(holders, ["scripts/lib/gate-guard.mjs"],
      `the closed list's row ${JSON.stringify(row)} must appear in gate-guard.mjs and in no other ` +
      "engine source — not defined a second time, and not QUOTED VERBATIM either, because a copy " +
      "of a row in prose goes stale the same way a copy in code does. Say it in other words, or " +
      `import the label. Found in: ${holders.join(", ") || "(nowhere — the guard cannot see its own list)"}`);
  }
});

test("1.3 REGRESSION GUARD: the scan reaches real sources — an empty walk would pass vacuously", () => {
  const files = sweptSources();
  assert.ok(files.length >= 20, `expected the engine's whole lib to be swept, walked ${files.length}`);
  assert.ok(files.includes("scripts/lib/gate-guard.mjs"));
});

// ─────────────── 2 — the guard reads the payload it used to drain and discard ───────────────

const guard = (cwd, payload) => {
  return invokeEngine(["gate-guard"], {
    cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
};
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

/** A repo whose live active epic `p` owes a reconcile — pushed `--reconcile`, then popped.
 *
 *  A SNAPSHOT SINCE 0.48.0 (task 3.2/3.4). This file is the one the helper was PROVEN on before any
 *  other file used it, and the reason is in the numbers: the build below is init + two add-epic +
 *  set-active + push + pop, measured at 133 ms, and this file called it a dozen times before 4.1
 *  moved the dozen that could move. What is left is the three 2.5 tests, which CORRUPT the record
 *  after building it, so the snapshot is worth keeping here: the route per test is a COPY, and a test
 *  that mutates the repository cannot reach the next test's. */
const owingRepo = fixtureOnce(() => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ["p", "d"]) run(["add-epic", "--id", id, "--lane", "claude-code", "--title", id], { cwd });
  run(["set-active", "p"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"], { cwd });
  run(["pop-detour", "p"], { cwd });
  return cwd;
}, { name: "pm-owing-guard" });

// ─────────────── 2.5 / 2.6 — the unreadable-state exemption (design D4) ───────────────

const CONFLICT_MARKER = "<<<<<<< HEAD\n";
const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");

/** Every file under `.conductor/` with its bytes, so "wrote nothing" is one comparison. */
function conductorTree(cwd) {
  const dir = path.join(cwd, ".conductor");
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isFile()) out[name] = fs.readFileSync(p).toString("base64");
  }
  return out;
}

/** An owing repo whose `state.json` a merge left conflict markers in. */
function conflictedRepo() {
  const cwd = owingRepo();
  fs.writeFileSync(statePath(cwd), CONFLICT_MARKER + fs.readFileSync(statePath(cwd), "utf8"));
  return cwd;
}

/** Every remedy the unreadable-state message itself prints, as a shell command. */
const REMEDIES = [
  "git checkout --ours .conductor/state.json",
  "git checkout --theirs .conductor/state.json",
  "git show abc1234:.conductor/state.json > .conductor/state.json",
  "git restore .conductor/state.json",
  "mv .conductor/state.json .conductor/state.json.damaged",
];

test("2.5 every remedy the unreadable-state message prints stays runnable", () => {
  // Wedge-freedom no longer rests on "Bash is not matched" — it rests on THIS exemption. The
  // exemption is unconditional for an affirmed Bash call carrying a command, whatever its shape,
  // because one remedy the message hands you (`git show <rev>:… > …`) is itself a redirection into
  // a file and `mv` is a command-word row.
  const cwd = conflictedRepo();
  const before = conductorTree(cwd);
  for (const command of REMEDIES) {
    const r = guard(cwd, bash(command));
    assert.equal(r.status, 0, `a remedy the message names must stay runnable: ${command}\n${r.stderr}`);
    assert.equal(r.stderr, "", `an allow prints nothing; got: ${r.stderr}`);
  }
  assert.deepEqual(conductorTree(cwd), before, "the guard writes nothing over an unreadable record");
});

test("2.5 an editing tool still blocks over an unreadable record", () => {
  // The carve-out is for Bash and nothing else: exiting 0 for an editing tool would silently
  // disable the one block this plugin makes unconditional, exactly when the record saying whether
  // a reconcile is owed cannot be read.
  const cwd = conflictedRepo();
  const r = guard(cwd, { tool_name: "Edit", tool_input: { file_path: "src/x.js" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\.conductor\/state\.json/);
  for (const payload of ["{}", "", "not json", JSON.stringify({ tool_name: "Frobnicate" })]) {
    assert.equal(guard(cwd, payload).status, 2, `an unidentified tool blocks: ${JSON.stringify(payload)}`);
  }
});

test("2.5 a Bash payload with no readable command does not inherit the exemption", () => {
  // 2.8c's other half, which only becomes meaningful once the exemption exists: the same principle
  // that governs an unidentified tool governs an undecidable Bash call — there is nothing to decide
  // from, and every remedy the message names is a command.
  const cwd = conflictedRepo();
  for (const payload of [
    { tool_name: "Bash" },
    { tool_name: "Bash", tool_input: null },
    { tool_name: "Bash", tool_input: "rg foo" },
    { tool_name: "Bash", tool_input: { command: 7 } },
  ]) {
    const r = guard(cwd, payload);
    assert.equal(r.status, 2, `expected the unreadable-state block for ${JSON.stringify(payload)}`);
    assert.match(r.stderr, /\.conductor\/state\.json/);
  }
});

// ─────────────── 3.1 — the matcher, which is where the whole defect lived ───────────────

test("3.1 the shipped hook configuration registers the gate guard for Bash", () => {
  // The engine change is INERT without this: an unmatched tool never reaches the verb, which is why
  // rolling this change back is reverting one string. Read from the shipped file, not from a
  // remembered value.
  const doc = JSON.parse(fs.readFileSync(path.join(REPO, "hooks", "hooks.json"), "utf8"));
  const entry = (doc.hooks.PreToolUse || []).find(e =>
    (e.hooks || []).some(h => String(h.command).includes("gate-guard")));
  assert.ok(entry, "exactly one PreToolUse entry drives the gate guard");
  for (const tool of ["Bash", "Edit", "Write", "NotebookEdit"]) {
    assert.match(tool, new RegExp(`^(?:${entry.matcher})$`),
      `the gate guard's matcher must cover ${tool}; it is \`${entry.matcher}\``);
  }
});
