// scripts/test/assert/assert-half-has-no-spawn.test.mjs
// 5.2 — THE ASSERTION-HALF GUARD (design D5, suite-certification's "No test in the assertion half
// spawns a process or runs git" — 0.49.0's restatement of the requirement this file enforces).
//
// WHAT IT IS FOR. The assertion half's whole value is that it runs on every commit, on the git
// double, without booting Node or git once per assertion — the runner may start one process per
// FILE, but no TEST starts one. A single `spawnSync` added to one file takes that back for the whole
// half — and the way it happens is not malice, it is a test that needs
// "just one real git call": the file goes on passing, the half goes on passing, and the property the
// half was split out for is gone with nothing to say so. The suite-certification capability states
// the guard as a SHALL for exactly that reason.
//
// IT IS A REGRESSION GUARD, NOT A RED: it passes the moment the directory it walks exists, so it
// lands with 5.1 rather than with a GREEN elsewhere. 5.2's verification is therefore a deliberate
// violation rather than a failing first run — `violations()` is exercised directly by the second
// test below, so the check has been SEEN to fail rather than assumed to be able to.
//
// THE ENFORCEMENT IS THE MODULE SPECIFIER, and that is deliberate. Every spawn in this suite is
// reached through ONE module specifier, so refusing THAT refuses all of them at once and cannot be
// routed around by picking a different function name from the same module. A SECOND check covers the
// bare call names, for the case the specifier does not: a helper re-exporting a spawner under a name
// this file does not know.
//
// THE CALL CHECK REQUIRES A BARE CALL (a `$`/word/dot before the name disqualifies it), because
// `RegExp.prototype.exec(` is not a child process and three files in this half call it. A check that
// fired on those would be weakened the first day, which is how the property it guards gets lost.
//
// COMMENTS ARE STRIPPED, because a guard that a comment can trip is a guard that gets weakened the
// first time someone writes "this file must not spawnSync" in a header. THE STRIPPER IS NOT SOUND
// against adversarial source and does not need to be: it reads this repository's own test files, and
// a false POSITIVE here is a loud failure at the one moment a human is looking.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// INSTALLS the PATH shim as a side effect, and hands back the counter it writes to (G-I4).
import { SHIM_DIR, gitSpawns } from "../fixtures/assert-git-shim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Built from parts so THIS file does not contain the specifier it refuses — otherwise the guard
 *  would be its own first violation, and the workaround ("exempt this one file by name") is the
 *  shape that lets the next exemption through. */
const CHILD_PROCESS_MODULE = ["node", "child_process"].join(":");
const SPAWN_CALLS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec"];

/** Remove comments, keeping string and template contents. Deliberately simple: it tracks quotes and
 *  a line/block comment state, and it treats a regex literal's slashes as ordinary characters (a
 *  regex containing `//` would end the "comment" early and leave the text after it — which can only
 *  ever cause a false POSITIVE here, never a false negative). */
export function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c; i++;
      while (i < src.length) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** The filesystem module, built the same way and for the same reason as the child-process one. */
const FS_MODULE = ["node", "fs"].join(":");

/** THE UNIT RUNG'S SECOND PROHIBITION (0.48.0 task 2.1, design D4). The spec forbids a unit-rung file
 *  to "read, write, create or remove a path", so BOTH sides are named: a predicate that named only
 *  the write side would refuse less than the requirement states, and the read it would miss is a real
 *  one — it is why the seam had to move `render()`'s reads as well as its writes (task 1.3).
 *
 *  The lists are the CALL NAMES, and the check for each requires a BARE call (the same
 *  `(?<![.\\w$])` guard the spawn check uses), so `pattern.exec(`'s sibling shapes do not fire. */
const FS_READ_CALLS = [
  "readFileSync", "readFile", "readdirSync", "readdir", "statSync", "stat", "lstatSync",
  "lstat", "existsSync", "accessSync", "access", "openSync", "open", "readlinkSync",
  "realpathSync", "opendirSync", "createReadStream", "watch", "readSync", "fstatSync",
];
const FS_WRITE_CALLS = [
  "writeFileSync", "writeFile", "appendFileSync", "appendFile", "mkdirSync", "mkdir",
  "rmSync", "rm", "rmdirSync", "unlinkSync", "renameSync", "copyFileSync", "cpSync",
  "fsyncSync", "fsync", "truncateSync", "chmodSync", "symlinkSync", "linkSync", "mkdtempSync",
  "writeSync", "writevSync", "fchmodSync", "utimesSync",
];
export const UNIT_FS_READ_CALLS = FS_READ_CALLS;
export const UNIT_FS_WRITE_CALLS = FS_WRITE_CALLS;

/** Every reason this source may not live in the assertion half — and, where `rung` names the unit
 *  rung, every reason it may not live THERE. Empty means it may.
 *
 *  `rung` is a parameter rather than a second function because the spawn/child-process half applies
 *  to BOTH rungs and only the filesystem half is unit-specific; two functions would have to
 *  duplicate the first half or call each other. */
export function violations(name, src, rung = null) {
  const code = stripComments(src);
  const found = [];
  if (code.includes(CHILD_PROCESS_MODULE)) {
    found.push(`${name} reaches ${CHILD_PROCESS_MODULE} — a child process in the assertion half`);
  }
  for (const call of SPAWN_CALLS) {
    if (new RegExp(`(?<![.\\w$])${call}\\s*\\(`).test(code)) {
      found.push(`${name} calls ${call}( — a child process in the assertion half`);
    }
  }
  if (rung === "unit") {
    if (code.includes(FS_MODULE)) {
      found.push(`${name} reaches ${FS_MODULE} — the unit rung performs no filesystem work at all`);
    }
    for (const [label, calls] of [["reads", FS_READ_CALLS], ["writes", FS_WRITE_CALLS]]) {
      for (const call of calls) {
        // TWO SHAPES, because the unit rung's violation is a BARE call or an `fs.`-RECEIVER call
        // and neither alone covers the other: `fs.writeFileSync(...)` is what every engine module
        // writes and would slip past a bare-call-only predicate, while a general member call would
        // refuse `store.read(...)` — a call the rung's own tests make by design, because the
        // in-memory store's artifact read is spelled exactly that way.
        if (new RegExp(`(?<![.\\w$])${call}\\s*\\(|(?<![.\\w$])fs\\.${call}\\s*\\(`).test(code)) {
          found.push(`${name} calls ${call}( — the unit rung ${label} no path`);
        }
      }
    }
  }
  return found;
}

test("5.2 the assertion half spawns no child process and runs no git", () => {
  const files = fs.readdirSync(HERE).filter(f => f.endsWith(".test.mjs")).sort();
  // A guard that walked an empty directory would pass and prove nothing, and an empty directory is
  // exactly what a botched move leaves behind.
  assert.ok(files.length > 40, `the assertion half holds ${files.length} files; a walk over an empty or nearly-empty directory is not a check`);
  const found = files.flatMap(f => violations(f, fs.readFileSync(path.join(HERE, f), "utf8")));
  assert.deepEqual(found, [],
    "no test in the assertion half starts a process: it runs on the git double and starts no engine subprocess. A " +
    "file that needs real git belongs in scripts/test/functional/ — it runs on the trigger there, " +
    "which is what makes a real git call affordable. Do not weaken this guard: add the test to the " +
    "functional half instead, or extend fixtures/fake-git.mjs if the call is scenery.");
});

test("G-I4 the assertion half makes ZERO real git calls — a PATH shim counts them", () => {
  // THE SOURCE SCAN ABOVE CANNOT SEE THIS ONE (Gate 2, G-I4). It refuses a spawn WRITTEN in a file
  // in this half; it is blind to a test that calls a lib function directly, because then
  // `invocation()` answers with the live PROCESS_CONTEXT, `gitOps()` builds the REAL gateway, and
  // `git symbolic-ref` runs three modules away from the call. Exactly that was live in
  // `conductor-33.test.mjs` and the reviewer proved it with a `git` shim exiting 128: 1237/1237
  // still passed, because a shim that merely fails is tolerated by every caller.
  //
  // So the enforcement is a shim that does not fail anything — it COUNTS, and an `exit` listener
  // installed with it fails the process's file when the count is not zero.
  //
  // RE-SCOPED FOR PER-FILE ISOLATION (0.49.0, design D3 row 2). THE PER-PROCESS EXIT LISTENER IS THE
  // MECHANISM: the runner gives every file its own process, every rung file installs the shim itself
  // (the walk below refuses one that does not), and each process's listener fails its own file —
  // verified on Node 22, 24 and 26 that such a file is reported `✖ <file> … 'test failed'` and the run
  // exits 1. What this test reads DIRECTLY is therefore THIS process only: that the shim is first on
  // PATH here, and that this file has made no real git call so far. It no longer speaks for "the half
  // up to this point", because no other file shares its process.
  assert.equal(process.env.PATH.split(path.delimiter)[0], SHIM_DIR,
    "the git shim must be first on PATH in THIS process, or a real `git` is reachable and this " +
    "guard counts nothing");
  const spawns = gitSpawns();
  assert.deepEqual(spawns, [],
    `this file's process ran ${spawns.length} real git invocation(s): ${spawns.join(" | ")}. ` +
    "The half runs on the injected double; a real git call means something reached the gateway " +
    "through the PROCESS context instead of through an installed invocation.");
});

// ─────────────── 0.49.0 task 2.1 — EVERY RUNG FILE INSTALLS THE RUN-TIME COUNTER ITSELF ───────────────
//
// THE COUNTER ABOVE IS PER PROCESS. While the half shared one process, the shim one file installed
// covered every file after it — and 13 file-rung files imported neither the shim nor a harness that
// installs it, relying on the unit rung (handed first, every file importing `unit-harness`) to have
// done it for them. Once the runner gives every file its own process, those 13 would run with the real
// `git` reachable and nothing counting (design D3 row 1). So every rung file installs it ITSELF: a
// direct import of the shim, or an import of one of the two harnesses that import it.
//
// THE MATCH IS ON AN IMPORT STATEMENT, NOT A MENTION: comments are stripped first, and the statement
// must open a line with `import` and may span lines (`import { a,\n  b } from "…harness.mjs"`, the
// shape `assert/conductor-33.test.mjs` uses) — a line-based match could not see the specifier there.

/** The specifiers that install the shim at import time, built from parts so this file's own import of
 *  the shim is not the only evidence a sample could lean on. */
const SHIM_INSTALLERS = ["assert-git-shim", "assert-harness", "unit-harness"].map((m) => `../fixtures/${m}.mjs`);

/** True when `src` installs the git shim at import time: an `import` statement (side-effect or
 *  named, one line or several) whose specifier is the shim or one of the two harnesses. */
export function installsShim(src) {
  const code = stripComments(src);
  const escaped = SHIM_INSTALLERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^\\s*import\\s*(?:[^;]*?\\bfrom\\s*)?["'](?:${escaped})["']`, "m").test(code);
}

test("2.1 every file in both rungs installs the git shim itself — the counter is per process", () => {
  const rungs = [["unit", UNIT], ["assert", HERE]];  // UNIT is declared below; read at run time
  const files = rungs.flatMap(([rung, dir]) =>
    fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => [`${rung}/${f}`, path.join(dir, f)]));
  assert.ok(files.length > 100, `both rungs hold ${files.length} files; a walk over nearly nothing is not a check`);
  const missing = files.filter(([, p]) => !installsShim(fs.readFileSync(p, "utf8"))).map(([n]) => n);
  assert.deepEqual(missing, [],
    `these rung files do not install the run-time git counter: ${missing.join(", ")}. Under the ` +
    "runner's per-file isolation each file is its own process, so a file that relies on another file " +
    'having installed the shim runs with the real `git` reachable and nothing counting. Add `import ' +
    '"../fixtures/assert-git-shim.mjs";` as its first import (or import one of the two harnesses).');
});

test("2.1 the shim-install walk DISCRIMINATES — imports install it, a mention in a comment does not", () => {
  const spec = (m) => `"../fixtures/${m}.mjs"`;
  const SHIM = "assert-git-shim";
  // Installs: a side-effect import, a named import, each harness, and a TWO-LINE import.
  assert.equal(installsShim(`import ${spec(SHIM)};\nimport { test } from "node:test";\n`), true,
    "a side-effect import of the shim installs it");
  assert.equal(installsShim(`import { SHIM_DIR } from ${spec(SHIM)};\n`), true, "a named import installs it");
  assert.equal(installsShim(`import { run } from ${spec(["assert", "harness"].join("-"))};\n`), true,
    "the file-rung harness installs it");
  assert.equal(installsShim(`import { memoryEngine } from ${spec(["unit", "harness"].join("-"))};\n`), true,
    "the unit-rung harness installs it");
  assert.equal(installsShim(`import { tmpRepo, run,\n  readState } from ${spec(["assert", "harness"].join("-"))};\n`), true,
    "a TWO-LINE import installs it — the shape assert/conductor-33 uses, which a line-based match misses");
  // Does not install: nothing at all, a mention only in comments, and an unrelated fixture.
  assert.equal(installsShim(`import { test } from "node:test";\n`), false, "no import installs nothing");
  assert.equal(installsShim(`// import ${spec(SHIM)};\n/* import ${spec(SHIM)}; */\nconst a = 1;\n`), false,
    "a comment naming the shim is NOT an install");
  assert.equal(installsShim(`import { x } from ${spec("helpers")};\n`), false,
    "an unrelated fixture does not install the shim");
});

test("5.2 the guard DISCRIMINATES — each shape it refuses is refused for the stated reason", () => {
  // 5.2's required verification, kept as a test rather than a one-off run: a check nobody has seen
  // fail is a check that may be comparing nothing.
  // The sample sources are BUILT FROM PARTS so that this file does not contain the tokens it
  // refuses. A guard that exempted itself by name would be the first exemption of many.
  const SPAWN = ["spawnSync", "execFileSync"].map(w => w);
  const src = (w) => "import { " + w + " } from \"" + CHILD_PROCESS_MODULE + "\";";
  for (const w of SPAWN) {
    assert.match(violations("x.test.mjs", src(w)).join(" "), /node[:_]child_process/,
      `a static import of the child_process module must be refused (${w})`);
  }
  // The call-name check fires on its own, on a BARE call.
  assert.match(violations("x.test.mjs", "const r = " + "spawnSync" + "([\"git\", [\"rev-parse\"]]);").join(" "), /calls spawnSync/, "a bare " + "spawnSync" + " call must be refused");
  // ...and NOT on a method of the same name, which is a regex, not a process.
  assert.deepEqual(violations("x.test.mjs", "const m = pattern.exec(line);"), [],
    "RegExp.prototype.exec( is not a child process; a guard that fired on it would be weakened the first day");
  // And a COMMENT is not a violation — the failure mode that would get this guard deleted rather
  // than obeyed the first time a file documents the rule.
  assert.deepEqual(violations("x.test.mjs", "// this file must never " + "spawnSync" + "( anything\n/* nor use " + CHILD_PROCESS_MODULE + " */\nconst a = 1;\n"), [],
    "a comment naming the rule must not be a violation");
  assert.deepEqual(violations("x.test.mjs", 'import { run } from "../fixtures/assert-harness.mjs";\nrun(["init"]);\n'), []);
});

// ─────────────────────── 2.1 — THE UNIT RUNG'S OWN PROHIBITION (0.48.0, design D4) ───────────────────────
//
// A unit-rung file SHALL perform no filesystem work at all: it SHALL NOT import the filesystem module,
// SHALL NOT read, write, create or remove a path, and SHALL NOT flush a file to disk
// (suite-certification's "No test in the assertion half spawns a process or runs git", whose UNIT
// RUNG paragraph this is the enforcement of).
//
// WHY IT IS A SEPARATE WALK FROM THE ONE ABOVE. The two checks are the same FUNCTION and different
// SUBJECTS: the half's walk hands `violations()` no rung, because a spawn is a violation anywhere in
// the half; this walk names the unit rung, which adds the filesystem predicates. Keeping them as one
// walk would have to decide the rung per file from its path — which is what `homeOf()` does, and
// deriving it here would be a second copy of that rule.

const UNIT = path.join(HERE, "..", "unit");

test("2.1 the unit rung performs no filesystem work at all, and is a rung of the half", () => {
  const files = fs.readdirSync(UNIT).filter(f => f.endsWith(".test.mjs")).sort();
  // ─── 2.5 — THE NON-VACUITY ASSERTION, AND ITS NUMBER IS THIS RUNG'S OWN ───
  //
  // A walk over an EMPTY directory passes and proves nothing, and an empty rung runs zero tests while
  // EVERY floor still passes — the floor's declared count is enumerated from the same empty set, so
  // both sides collapse together and nothing notices. That is the shape the file rung's `> 40` was
  // written for (assert/assert-half-has-no-spawn.test.mjs's first test), and THIS NUMBER IS NOT
  // THAT ONE (I11): 40 is the FILE rung's floor, and the unit rung starts, per design D7, with a
  // handful of hand-written proofs — one per verb family that uses the store. Written with the file
  // rung's 40, this check could not go green on a young rung, which is the opposite of what it is
  // for. It states the rung's ACTUAL starting count and the rule that RAISES it:
  //
  //   RAISE THIS NUMBER whenever a unit-rung file is added. It is a floor, not a ceiling: the rung
  //   is meant to grow as test 4.1's migration moves value-observing tests onto it, and a number left
  //   at its first value while the rung grows still catches the one thing it is here for — a rung
  //   that has been emptied, moved, or silently stopped being walked.
  assert.ok(files.length >= 63,
    `the unit rung holds ${files.length} file(s); it started with three hand-written proofs (design ` +
    "D7: a state verb, a render verb and an append-only log verb) and RAISES this floor as it fills. " +
    "RAISED TO 14 BY 4.1'S BATCH 2 (255 unitTest declarations), 24 BY BATCH 3 (414), 33 BY BATCH 4 " +
    "(515, the worklist's first thirty rows), 43 BY BATCH 5 (rows 31-40), 58 BY BATCH 6 (rows 41-50) " +
    "AND 63 BY BATCH 7 (rows 51-60): a number left below the rung's real size is still doing its job; " +
    "a walk over an empty rung is not");
  const found = files.flatMap(f => violations(f, fs.readFileSync(path.join(UNIT, f), "utf8"), "unit"));
  assert.deepEqual(found, [],
    "a unit-rung file asks the engine for the VALUES it decided and gets them through the store it " +
    "supplies; a test that reads or writes a path belongs on the FILE rung (scripts/test/assert/), " +
    "and the rung exists because that is where the half's 12,524 fsyncs per run come from. If the " +
    "test genuinely needs bytes on disk, move the FILE, do not weaken this guard.");
  // It is still the ASSERTION half, so the spawn prohibition above applies to it as well — asserted
  // here rather than assumed, since this walk does not go through the half's own.
  const spawned = files.flatMap(f => violations(f, fs.readFileSync(path.join(UNIT, f), "utf8")));
  assert.deepEqual(spawned, [], "the unit rung is a rung of the assertion half, not a third half");
});

test("2.1 the filesystem predicate DISCRIMINATES — reads and writes are both refused, comments are not", () => {
  // 2.1's required discrimination, kept as a test rather than a one-off run: a check nobody has seen
  // fail is a check that may be comparing nothing. The sample sources are BUILT FROM PARTS so this
  // file does not contain the tokens it refuses — a guard that exempted itself by name would be the
  // first exemption of many.
  const fsImport = "import f from \"" + FS_MODULE + "\";";
  assert.match(violations("x.test.mjs", fsImport, "unit").join(" "), new RegExp(FS_MODULE),
    "an import of the filesystem module must be refused");

  const write = "const fd = " + "writeFileSync" + "(\"a\", \"b\");";
  assert.match(violations("x.test.mjs", write, "unit").join(" "), /calls writeFileSync/,
    "a WRITE must be refused");

  const read = "const t = " + "readFileSync" + "(\"a\", \"utf8\");";
  assert.match(violations("x.test.mjs", read, "unit").join(" "), /calls readFileSync/,
    "and a READ must be refused — a write-only predicate would refuse less than the requirement states, " +
    "and the read it would miss is render()'s pre-image, which is why the seam moved reads too");

  const flush = "fs." + "fsyncSync" + "(0);";
  assert.match(violations("x.test.mjs", flush, "unit").join(" "), /calls fsyncSync/,
    "and a durability flush, which is the whole cost the rung exists to remove");

  // A COMMENT naming any of them is NOT a violation — the failure mode that would get this guard
  // deleted rather than obeyed the first time a file documents the rule.
  const comment = "// this file must never " + "readFileSync" + "( a path\n/* nor reach " + FS_MODULE + " */\nconst a = 1;\n";
  assert.deepEqual(violations("x.test.mjs", comment, "unit"), [],
    "a comment naming the rule must not be a violation");

  // AND THE RUNG IS WHAT DECIDES: the same source is clean for the half at large, where a file-rung
  // test reads and writes by design.
  assert.deepEqual(violations("x.test.mjs", read, null), [],
    "the filesystem predicates are the UNIT rung's; the file rung exists to read paths");
});
