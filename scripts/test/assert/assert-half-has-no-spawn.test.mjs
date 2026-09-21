// scripts/test/assert/assert-half-has-no-spawn.test.mjs
// 5.2 — THE ASSERTION-HALF GUARD (design D5, suite-certification's "The assertion half spawns no
// process and runs no git").
//
// WHAT IT IS FOR. The assertion half's whole value is that it runs in ONE process on every commit,
// on the git double, without booting Node once per assertion. A single `spawnSync` added to one file
// takes that back for the whole half — and the way it happens is not malice, it is a test that needs
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

/** Every reason this source may not live in the assertion half. Empty means it may. */
export function violations(name, src) {
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
  return found;
}

test("5.2 the assertion half spawns no child process and runs no git", () => {
  const files = fs.readdirSync(HERE).filter(f => f.endsWith(".test.mjs")).sort();
  // A guard that walked an empty directory would pass and prove nothing, and an empty directory is
  // exactly what a botched move leaves behind.
  assert.ok(files.length > 40, `the assertion half holds ${files.length} files; a walk over an empty or nearly-empty directory is not a check`);
  const found = files.flatMap(f => violations(f, fs.readFileSync(path.join(HERE, f), "utf8")));
  assert.deepEqual(found, [],
    "the assertion half runs in ONE process, on the git double, and starts no engine subprocess. A " +
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
  // installed with it fails the whole half when the count is not zero. That listener is what makes
  // this hold for the files that run AFTER this one; the assertion here is the same fact, read
  // directly, so a spawn is reported as a named test failure as well as a process status.
  assert.equal(process.env.PATH.split(path.delimiter)[0], SHIM_DIR,
    "the git shim must be first on PATH, or a real `git` is reachable and this guard counts nothing");
  const spawns = gitSpawns();
  assert.deepEqual(spawns, [],
    `the assertion half ran ${spawns.length} real git invocation(s) up to this point: ${spawns.join(" | ")}. ` +
    "The half runs in one process on the injected double; a real git call means something reached " +
    "the gateway through the PROCESS context instead of through an installed invocation.");
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
