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

// 4.1 (0.48.0) moved TWO of this file's tests to `scripts/test/unit/state-file-refuses-to-guess.test.mjs`
// — the oversized-TTL input refusal and the no-op-save guard. What remains is the UNREADABLE-FILE
// family, which the memory store cannot express: it holds an object and answers "unreadable" only
// through `shapeProblem()`, never through bytes that fail to parse.

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The concurrency cases (16 concurrent writers, the fsync-before-rename, the lock-breakers race, the
// FIFO at the lock path, the unreadable lock) each need real parallel processes and a real
// filesystem race; the detached-claim case needs a detached checkout. They are functional-only by
// subject (design D5). The refusal family above is the part of that surface a pre-commit gate can
// see break on every commit.

// ─────────────── 0.49.0 task 5.1 — cfdude/pm#220: EVERY AWAITED CHILD IS BOUNDED ───────────────
//
// THE DEFECT. The functional twin's `spawnAll` resolved only when a child CLOSED, with no bound — so a
// hung child hung the functional half forever (on Node 18 one hung for about 13 minutes). suite-
// certification now requires that a test waiting ASYNCHRONOUSLY on a child's close or exit event bound
// the wait, and that a SOURCE CHECK refuse a helper that does not, so a sibling of a fixed helper
// cannot reintroduce the hang unnoticed. Synchronous spawns are outside the requirement by its own text.
//
// THE CHECK, over every `scripts/test/**/*.mjs`: each wait on a child's close/exit event — in all three
// forms, `<child>.on(…)`, `<child>.once(…)`, and the events module's `once(<child>, …)` promise form
// (bare or `events.once`) — must sit in a FUNCTION that also arms a timer (`setTimeout(`) and kills
// the child (`.kill(`). `process.on("exit")` is not a child and is not a wait. Comments are stripped.
//
// ITS TOKENS AND SAMPLES ARE BUILT FROM PARTS (the pattern assert-half-has-no-spawn uses): a scan whose
// own source spelled the shape would refuse itself, and exempting this file by name is the first
// exemption of many.

import { fileURLToPath } from "node:url";

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS = ["cl" + "ose", "ex" + "it"].join("|");
const Q = `["'\`]`;
/** `<receiver>.on|once("close"|"exit"` — the receiver is captured so `process` can be excluded. */
const LISTENER = new RegExp(`([\\w$.\\]\\)]+)\\s*\\.\\s*(?:on|once)\\s*\\(\\s*${Q}(?:${EVENTS})${Q}`, "g");
/** `once(<child>, "close"|"exit")` / `events.once(…)` — the promise form. */
const PROMISE_ONCE = new RegExp(`(?<![\\w$])(?:events\\s*\\.\\s*)?${"on" + "ce"}\\s*\\(\\s*[\\w$.]+\\s*,\\s*${Q}(?:${EVENTS})${Q}`, "g");

/** `src` with every comment BLANKED — each comment character replaced by a space, every newline kept —
 *  so an index into the result is an index into the source and its line is the source's line. String
 *  and template contents are kept (a regex literal's slashes are ordinary characters; that can only
 *  cause a false POSITIVE here, never a false negative). */
function blankComments(src) {
  let out = "", i = 0;
  const blank = (t) => t.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); const e = j < 0 ? src.length : j; out += blank(src.slice(i, e)); i = e; continue; }
    if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); const e = j < 0 ? src.length : j + 2; out += blank(src.slice(i, e)); i = e; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < src.length) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i++] === c) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Every function body in `code` (comments already blanked), as `[start, end)` spans of its braces:
 *  `function … {`, and an arrow's `=> {`. Strings are skipped when matching braces. */
function functionSpans(code) {
  const spans = [];
  const opener = /\bfunction\b[^{]*\{|=>\s*\{/g;
  for (const m of code.matchAll(opener)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open, q = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    spans.push([open, i + 1]);
  }
  return spans;
}

/** Every UNBOUNDED wait on a child's close/exit in `src`, as `name:line` strings. */
export function unboundedWaits(name, src) {
  const code = blankComments(src);
  const spans = functionSpans(code);
  const sites = [];
  for (const m of code.matchAll(LISTENER)) {
    if (/(^|\.)process$/.test(m[1])) continue;             // the process's own exit, not a child's
    sites.push(m.index);
  }
  for (const m of code.matchAll(PROMISE_ONCE)) sites.push(m.index);
  const found = [];
  for (const at of sites) {
    const inner = spans.filter(([s, e]) => s <= at && at < e).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
    const body = inner ? code.slice(inner[0], inner[1]) : code;
    const bounded = /\bsetTimeout\s*\(/.test(body) && /\.kill\s*\(/.test(body);
    if (!bounded) found.push(`${name}:${lineOf(code, at)}`);
  }
  return found;
}

/** The 1-based line of `index` — blankComments keeps every character's position. */
function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

function testSources(dir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...testSources(path.join(dir, ent.name), r));
    else if (ent.name.endsWith(".mjs")) out.push([r, path.join(dir, ent.name)]);
  }
  return out;
}

test("5.1 #220: every asynchronous wait on a child's close or exit is bounded by a timer that kills it", () => {
  const files = testSources(TEST_ROOT);
  assert.ok(files.length > 150, `the scan reached ${files.length} files under scripts/test; a scan of nearly nothing is not a check`);
  const found = files.flatMap(([rel, p]) => unboundedWaits(`scripts/test/${rel}`, fs.readFileSync(p, "utf8")));
  assert.deepEqual(found, [],
    "these helpers wait on a child's close/exit event with no bound, so a hung child hangs the run " +
    "forever (#220). Arm a timer in the same function that kills the child and fails the test naming " +
    "the invocation and the bound — the shape functional/verb-surface.test.mjs's 30 s wait uses.");
});

test("5.1 the unbounded-wait scan DISCRIMINATES — each form is refused unbounded and accepted bounded", () => {
  const ev = "cl" + "ose";
  const unbounded = [
    `function a(c) { return new Promise((r) => { c.${"on"}("${ev}", r); }); }`,
    `function b(c) { return new Promise((r) => { c.${"on" + "ce"}("${"ex" + "it"}", r); }); }`,
    `async function d(c) { await ${"on" + "ce"}(c, "${ev}"); }`,
    `async function e(c) { await events.${"on" + "ce"}(c, "${ev}"); }`,
  ];
  for (const src of unbounded) {
    assert.equal(unboundedWaits("x.mjs", src).length, 1, `an unbounded wait must be refused: ${src}`);
  }
  const bounded = `function f(c) { return new Promise((r) => { const t = setTimeout(() => c.kill("SIGKILL"), 30000); ` +
    `c.${"on"}("${ev}", (s) => { clearTimeout(t); r(s); }); }); }`;
  assert.deepEqual(unboundedWaits("x.mjs", bounded), [], "a wait whose function arms a killing timer is bounded");
  assert.deepEqual(unboundedWaits("x.mjs", `process.${"on"}("${"ex" + "it"}", () => {});`), [],
    "the process's own exit listener is not a wait on a child");
  assert.deepEqual(unboundedWaits("x.mjs", `// c.${"on"}("${ev}", r);\nconst a = 1;\n`), [],
    "a comment naming the shape is not a wait");
});
