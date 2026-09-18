// scripts/test/gate-guard-write-paths.test.mjs
// the-guard-covers-every-write-path — the gate guard covers Bash write shapes.
//
// The guard was registered for `Edit|Write|NotebookEdit` only, so an agent blocked on `Edit` wrote
// the same file with `cat > f <<EOF`, `sed -i` or `tee` in one hop, and the block's own message
// claimed "Completing the reconcile gate is the only way through" while that was false as shipped.
//
// What this file pins, in three layers:
//   1. the closed write-shape list and its exclusions, over the exported function directly;
//   2. the hook's behaviour end to end, over a real fixture repo that owes a reconcile;
//   3. the shipped matcher, and that the list has exactly one definition site.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run } from "./helpers.mjs";
import { writeShape, isEngineInvocation, WRITE_SHAPE_LABELS } from "../lib/gate-guard.mjs";

const LABELS = Object.values(WRITE_SHAPE_LABELS);

// ─────────────── 1.1 — the closed list and its exclusions (design D2) ───────────────

/** Commands that MUST match a shape. A write performed by any of these is a write the reconcile
 *  gate exists to stop, and each was reproduced on the prototype battery before it shipped. */
const BLOCKS = [
  // redirection into a file, in every spelling the shell offers
  "cat > src/x.js <<EOF",
  "printf x >> f",
  "awk '{print}' f > out.txt",
  "cmd &> out.txt",
  "cmd &>> out.txt",
  "cmd >| out.txt",
  "node --test >& out.txt",
  // multi-digit file descriptors: the fd was one optional digit behind a negated class that also
  // excluded digits, so every one of these passed until the cross-spec fix
  "cmd 10>out.txt",
  "exec 10>lockfile",
  "cmd 12>>out.txt",
  "cmd 1>out.txt",
  // in-place stream editors, short and long spellings
  "sed -i '' s/a/b/ f.js",
  "sed --in-place s/a/b/ f.js",
  "sed --in-place=.bak s/a/b/ f.js",
  "perl -i -pe s/a/b/ f.js",
  // tee, copiers, patchers
  "tee -a notes.txt",
  "cp a b",
  "mv a b",
  "truncate -s 0 f",
  "git apply p.patch",
  // destroying the conductor record turns the guard OFF, which is larger than the write it stands
  // in for: gateGuardCheck() returns at isInitialized() once the file is gone
  "rm .conductor/state.json",
  "rm -rf .conductor",
  "rm -rf .conductor/*",
  "rm '.conductor/state.json'",
  'rm "/Users/r/Repos/pm/.conductor/state.json"',
  "rm -rf /Users/r/Repos/pm/.conductor",
  "mv .conductor/state.json /tmp/x",
  "truncate -s 0 .conductor/state.json",
  // a TRAILING GLOB names the record among its expansions — the discriminator is the WRITTEN
  // ARGUMENT, not the file it reaches. The first fix matched the quoted, absolute and `/*` forms
  // and let these through, which turns the guard off just as thoroughly.
  "rm -rf .conductor/state.json*",
  "rm .conductor/state.json*",
  "rm -rf .conductor*",
];

/** Commands that MUST NOT match. A guard that blocks these is a guard that gets routed around. */
const ALLOWS = [
  "rg foo 2>/dev/null",
  "cmd >&2",
  "cmd >&-",
  "cmd > /dev/null 2>&1",
  "node --test 2>&1 | tail",
  "cmd 10>&1",                       // a multi-digit fd DUPLICATION stays a duplication
  "git status --short",
  "diff <(a) <(b)",
  "for f in *; do echo $f; done",
  "curl -s url | jq .",
  "tee /dev/null",
  "[ 3 -gt 2 ] && echo yes",
  // the arrow: this repository mandates `rg`, whose patterns carry it routinely
  "rg 'foo->bar' src/",
  "git log --format='%h -> %s'",
  'echo "a -> b"',
  // the lock remedy the engine itself prints, and the glob that cannot expand to the record
  "rm .conductor/state.json.lock",
  "rm -r .conductor/state.json.lock",
  "rm '.conductor/state.json.lock'",
  "rm .conductor/state.json.*",
  "rm -rf .conductor/state.json.*",
  "rm -rf .conductorish",
  // touch and mkdir create without content — not the skip this gate exists to stop
  "touch src/x.js",
  "mkdir -p src",
  // every engine invocation the gate names as its own exit, in BOTH spellings pm emits
  'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile p --detour d --verdict valid --amendments none',
  "node scripts/conductor.mjs pop-detour p",
  'node "$ENGINE" drop-detour p --reason "stale frame"',
  'node "$ENGINE" record-gate-review e --gate 2 --verdict pass',
  'node scripts/conductor.mjs update-epic e --notes "lane: claude-code not openspec -> small"',
  'node scripts/conductor.mjs record-reconcile p --detour d --verdict invalidated --amendment "story 3 -> story 4"',
];

test("1.1 every recognized write shape is matched", () => {
  for (const cmd of BLOCKS) {
    const label = writeShape(cmd);
    assert.ok(label, `expected a write shape for: ${cmd}`);
    assert.ok(LABELS.includes(label),
      `the return value must be a FIXED label from the closed list, got ${JSON.stringify(label)} for: ${cmd}`);
  }
});

test("1.1 no read-only command, lock remedy or engine invocation is matched", () => {
  for (const cmd of ALLOWS) {
    assert.equal(writeShape(cmd), null, `expected no write shape for: ${cmd}`);
  }
});

test("1.1 the return value carries no text taken from the command", () => {
  // A "no substring of the input" assertion is unsatisfiable — a single character of the command is
  // a substring of it. What is checkable is that the label is one of the closed set's members, and
  // that it holds neither the target path nor the unusual sequence written into it.
  const odd = "zq7-marker-zq7";
  const label = writeShape(`cat > src/${odd}/x.js <<EOF`);
  assert.equal(label, WRITE_SHAPE_LABELS.redirect);
  assert.ok(!label.includes(odd), "the label must not carry the command's own text");
  assert.ok(!label.includes("src/"), "the label must not carry the target path");
  for (const cmd of BLOCKS) assert.ok(LABELS.includes(writeShape(cmd)));
});

test("1.1 the labels are a frozen closed set", () => {
  assert.ok(Object.isFrozen(WRITE_SHAPE_LABELS), "the label table is the closed list's single site");
  assert.ok(LABELS.every(l => typeof l === "string" && l.length > 0));
  assert.equal(new Set(LABELS).size, LABELS.length, "no two rows share a label");
});

// ─────────────── 1.1b — the engine-invocation exemption's only falsifiable surface ───────────────
//
// Under the list as it stands NO command-word row is reachable from a `node`-led segment: the arm
// reads the segment's LEADING word, which for an engine invocation is always the runtime. So the
// exemption cannot change any command's outcome today and a case-based check of the guard's exit
// codes cannot fail when its CALL SITE is removed. The predicate itself is therefore asserted
// directly, so that DELETING it is detectable — and the `gate-integrity` delta carries the forward
// commitment that any future row keyed on something other than the leading command word must
// re-establish reachability before it ships.

test("1.1b the engine-invocation predicate recognizes both spellings pm emits", () => {
  assert.equal(typeof isEngineInvocation, "function",
    "the predicate is EXPORTED because it is the exemption's only falsifiable surface");
  const engine = [
    ["node", ['"${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs"', "pop-detour", "p"]],
    ["node", ['"$ENGINE"', "record-reconcile", "p", "--detour", "d"]],
    ["node", ["${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs", "update-epic", "e"]],
    ["node", ["scripts/conductor.mjs", "status"]],
  ];
  for (const [word, rest] of engine) {
    assert.equal(isEngineInvocation(word, rest), true, `expected an engine invocation: node ${rest.join(" ")}`);
  }
});

test("1.1b the predicate is not an exemption for a spelling pm never emits", () => {
  const notEngine = [
    ["node", ["--test", "scripts/test/x.test.mjs"]],       // a test flag, not a verb
    ["node", ["-e", "require('fs').writeFileSync('x','q')"]],
    ["node", ['"$ENGINE"']],                                // no verb follows
    ["rm", ['"$ENGINE"', "status"]],                        // not a runtime
    ["node", ["other.mjs", "status"]],                      // not the engine
  ];
  for (const [word, rest] of notEngine) {
    assert.equal(isEngineInvocation(word, rest), false, `expected NOT an engine invocation: ${word} ${rest.join(" ")}`);
  }
});

test("1.1b the exemption covers the command-word arm only — a redirection still blocks", () => {
  assert.equal(writeShape("node scripts/conductor.mjs status > out.txt"), WRITE_SHAPE_LABELS.redirect,
    "an exemption that swallowed redirections would make prefixing a command with an engine " +
    "invocation a one-line bypass of the whole gate");
  assert.equal(writeShape('node "$ENGINE" drop-detour p --reason "x" >> log.txt'), WRITE_SHAPE_LABELS.redirect);
});

test("1.1b an UNFILLED command template blocks, and the filled command passes", () => {
  // Accepted and PRE-EXISTING (design D7): `<id>`/`<sha>` are input redirections, so an unfilled
  // template is already broken at the shell. The block removes nothing that would otherwise run.
  assert.ok(writeShape('node "$ENGINE" update-epic <id> --attribute-commit <sha>'));
  assert.equal(writeShape('node "$ENGINE" update-epic e --attribute-commit abc1234'), null);
});


// ─────────────── 1.3 — the list is defined once ───────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
    "\\.conductor(\\*|\\/(state\\.json\\*?|\\*))?",
  ];
  for (const row of rows) {
    const holders = sweptSources().filter(rel => fs.readFileSync(path.join(REPO, rel), "utf8").includes(row));
    assert.deepEqual(holders, ["scripts/lib/gate-guard.mjs"],
      `the closed list's row ${JSON.stringify(row)} must be defined in gate-guard.mjs and nowhere ` +
      `else; found in: ${holders.join(", ") || "(nowhere — the guard cannot see its own list)"}`);
  }
});

test("1.3 REGRESSION GUARD: the scan reaches real sources — an empty walk would pass vacuously", () => {
  const files = sweptSources();
  assert.ok(files.length >= 20, `expected the engine's whole lib to be swept, walked ${files.length}`);
  assert.ok(files.includes("scripts/lib/gate-guard.mjs"));
});

// ─────────────── 2 — the guard reads the payload it used to drain and discard ───────────────

const guard = (cwd, payload) => {
  const r = spawnSync("node", [ENGINE, "gate-guard"], {
    cwd, encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
};
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

/** A repo whose live active epic `p` owes a reconcile — pushed `--reconcile`, then popped. */
function owingRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ["p", "d"]) run(["add-epic", "--id", id, "--lane", "claude-code", "--title", id], { cwd });
  run(["set-active", "p"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "it touched shared code", "--reconcile"], { cwd });
  run(["pop-detour", "p"], { cwd });
  return cwd;
}

test("2.1 a heredoc redirection is blocked while a reconcile is owed, and the block names the shape", () => {
  const cwd = owingRepo();
  const r = guard(cwd, bash("cat > src/x.js <<EOF\nq\nEOF"));
  assert.equal(r.status, 2, `expected a block, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /still owes a reconcile/);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.redirect),
    `the block must name the matched shape's fixed label; stderr was:\n${r.stderr}`);
});

test("2.1 an in-place stream editor is blocked", () => {
  const cwd = owingRepo();
  const r = guard(cwd, bash("sed -i '' s/a/b/ src/x.js"));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.inPlace), r.stderr);
});

test("2.1 the block message carries a label, not the command", () => {
  const cwd = owingRepo();
  const odd = "zq7-marker-zq7";
  const r = guard(cwd, bash(`cat > src/${odd}/x.js <<EOF`));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(WRITE_SHAPE_LABELS.redirect), r.stderr);
  assert.ok(!r.stderr.includes(odd), "no text taken from the command reaches the message");
  assert.ok(!r.stderr.includes("src/"), "not the target path either");
});

test("2.1 the block states the obligation the check cannot enforce", () => {
  // The check is incomplete by construction — `eval`, a variable-built path, a script by name and an
  // interpreter given inline source all pass — so the message carries the instruction the mechanism
  // cannot. Today's "Completing the reconcile gate is the only way through" is DROPPED: this change
  // does not make it true either.
  const cwd = owingRepo();
  const r = guard(cwd, bash("cat > src/x.js <<EOF"));
  assert.match(r.stderr, /Bash write is forbidden/i);
  assert.ok(!/only way through/.test(r.stderr),
    "the sentence this change does not make true must be gone, not re-justified");
});

test("2.8b REGRESSION GUARD: the guard setting does not reach the Bash arm of the reconcile block", () => {
  // Pins the property against the natural wrong implementation, in which the reconcile and tracker
  // arms share one flag-gated shape check. A switch that silenced Bash writes here would be a bypass
  // for the whole reconcile gate — which is the defect this change closes.
  const cwd = owingRepo();
  run(["set-gate-guard", "off"], { cwd });
  assert.equal(guard(cwd, bash("cat > src/x.js <<EOF")).status, 2, "`set-gate-guard off` must not reach it");
  assert.equal(guard(cwd, { tool_name: "Edit", tool_input: {} }).status, 2);
});

test("2.8c a payload naming Bash with no readable command blocks", () => {
  // An undecidable Bash call takes the block, never the allow — the same principle that governs an
  // unidentifiable tool. Fails against the natural wrong implementation, in which
  // `tool_name === "Bash"` alone selects the allow path.
  const cwd = owingRepo();
  for (const payload of [
    { tool_name: "Bash" },
    { tool_name: "Bash", tool_input: null },
    { tool_name: "Bash", tool_input: "rg foo" },
    { tool_name: "Bash", tool_input: { command: 7 } },
    { tool_name: "Bash", tool_input: { command: null } },
  ]) {
    const r = guard(cwd, payload);
    assert.equal(r.status, 2, `expected a block for ${JSON.stringify(payload)}: ${r.stderr}`);
    assert.match(r.stderr, /still owes a reconcile/);
  }
});

test("2.3 a read-only Bash command is not blocked while a reconcile is owed", () => {
  const cwd = owingRepo();
  for (const command of [
    "rg foo 2>/dev/null",
    "cmd > /dev/null 2>&1",
    "git status --short",
    "node --test 2>&1 | tail",
    "rg 'foo->bar' src/",
    "rm .conductor/state.json.lock",
  ]) {
    const r = guard(cwd, bash(command));
    assert.equal(r.status, 0, `expected an allow for ${command}: ${r.stderr}`);
    assert.equal(r.stderr, "", `an allow prints nothing; got: ${r.stderr}`);
    assert.equal(r.stdout, "", "gate-guard's stdout is protocol surface — an allow is silence");
  }
});

test("2.3 every engine invocation the gate names as its own exit stays runnable", () => {
  // The gate names engine invocations as the way through it, so a gate that blocked one would have
  // no exit — and the sibling change's frame-drop verb relies on that holding as the list grows.
  const cwd = owingRepo();
  for (const command of [
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile p --detour d --verdict valid --amendments none',
    'node "$ENGINE" pop-detour p',
    'node "$ENGINE" update-epic p --notes "lane: claude-code not openspec -> small"',
    'node "$ENGINE" record-gate-review p --gate 2 --verdict pass',
  ]) {
    assert.equal(guard(cwd, bash(command)).status, 0, `the gate must not block its own exit: ${command}`);
  }
  // …and the exemption is not a bypass: a redirection in the same segment still blocks.
  assert.equal(guard(cwd, bash('node "$ENGINE" status > out.txt')).status, 2);
});

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
