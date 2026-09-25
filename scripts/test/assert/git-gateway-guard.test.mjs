// scripts/test/assert/git-gateway-guard.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/git-gateway-guard.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the call-site guard over lib/git-gateway.mjs: the set of git
// invocations is DERIVED from the file's own source at test time (never typed from a list), every
// operation owns exactly one derived call, and NO module outside the gateway spawns git.
//
// NOTHING IN IT NEEDS GIT — it reads engine SOURCE — so it belongs on the per-commit path, which is
// exactly where this twin puts it. The two halves now share ONE derivation
// (`fixtures/spawn-derivation.mjs`) rather than carrying a copy each: the copies were the defect
// (G-I5, Gate 2). `(execFileSync|execSync)\(\s*"git` matched two of the six child-process entry
// points, nothing for an aliased binding, and nothing for a program passed as an expression — so
// a `spawnSync` of git added to a library module left BOTH guards green, and `self-hosting.mjs`'s
// `spawnSync(process.execPath, …)` was invisible to the "only non-git spawn" claim.
//
// The samples in the discrimination test below are ASSEMBLED FROM PARTS, because 5.2's guard is a
// text scan over this directory and a file that spelled a spawn call would be refused by the guard
// sitting beside it.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_OPERATIONS } from "../../lib/git-gateway.mjs";
import { gitSpawns, otherSpawns, spawnerNames, spawnSites } from "../fixtures/spawn-derivation.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LIB = path.join(ROOT, "scripts", "lib");
const GATEWAY = path.join(LIB, "git-gateway.mjs");
const ENGINE = path.join(ROOT, "scripts", "conductor.mjs");

const libFiles = () => fs.readdirSync(LIB).filter(f => f.endsWith(".mjs")).sort();
const read = (p) => fs.readFileSync(p, "utf8");

/** Every engine source file a git call could hide in, same set the functional half derives. */
function engineSources() {
  return [...libFiles().map((f) => [f, path.join(LIB, f)]), ["conductor.mjs", ENGINE]];
}

test("gateway: no engine module outside the gateway spawns git — the call sites are DERIVED, not listed", () => {
  const outside = [];
  let gitTotal = 0;
  for (const [name, file] of engineSources()) {
    const sites = gitSpawns(read(file));
    gitTotal += sites.length;
    if (path.basename(file) === "git-gateway.mjs") continue;
    outside.push(...sites.map((s) => `${name}: ${s.call}`));
  }
  assert.deepEqual(outside, [],
    "every git invocation must live in lib/git-gateway.mjs, so a caller can be handed a double; a " +
    "call site anywhere else is a site the fake cannot answer and the assertion half cannot run");
  assert.equal(gitTotal, 23,
    `the derivation found ${gitTotal} git invocations across the engine — ${GATEWAY}'s own count, ` +
    "not a number in a document");
});

test("gateway: the derived call count matches the declared table — a site added without an operation fails", () => {
  const src = read(GATEWAY);
  const body = src.slice(src.indexOf("export function realGit"), src.indexOf("export const GIT_OPERATIONS"));
  const derived = gitSpawns(body, spawnerNames(src));
  assert.equal(derived.length, GIT_OPERATIONS.length,
    `git-gateway.mjs holds ${derived.length} spawn sites and the declared table names ` +
    `${GIT_OPERATIONS.length} operations — they move together`);
});

test("gateway: nothing imports it — callers are HANDED it, through the invocation", () => {
  const importers = [];
  for (const [name, file] of engineSources()) {
    if (/from\s+["'][^"']*git-gateway\.mjs["']/.test(read(file))) importers.push(name);
  }
  assert.deepEqual(importers.sort(), ["invocation.mjs"],
    "a module that imported the gateway could not be given a double without monkey-patching; " +
    "lib/invocation.mjs is the ONE importer, and every other caller reaches it through gitOps()");
});

test("gateway: every declared operation is a named function on the gateway object", () => {
  const src = read(GATEWAY);
  for (const { name } of GIT_OPERATIONS) {
    assert.match(src, new RegExp(`^\\s*${name}:`, "m"),
      `${name} is declared in GIT_OPERATIONS but has no operation in realGit()`);
  }
});

test("gateway: the non-git spawns are EXACTLY the two the omission names", () => {
  // The git filter above is blind to a non-git spawn, so the exclusion is asserted as a CLOSED SET by
  // identity. The claim this replaces — "the only non-git spawn is tool-currency's openspec probe" —
  // was already false when it was written: `self-hosting.mjs` spawns this process's own node by
  // absolute path, which a pattern requiring a string literal after the paren could not see.
  const others = [];
  for (const [name, file] of engineSources()) {
    for (const arg of otherSpawns(read(file))) others.push(`${name}: ${arg}`);
  }
  assert.deepEqual(others, [
    "self-hosting.mjs: process.execPath",
    'tool-currency.mjs: "openspec"',
  ],
    "the engine's non-git spawns are the delegation handoff and the openspec version probe; a third " +
    "one is a call site nothing covers and must be a written decision rather than a passing accident");
});

test("gateway: the derivation DISCRIMINATES — every shape the old pattern missed is seen", () => {
  // The samples are built from parts, for two reasons that are both this half's own rules: 5.2's
  // guard refuses a file that spells a spawn call, and 5.7's narrowing is only safe while no
  // assertion-half file quotes the string its double stands in for. Neither rule is weakened here;
  // the literals are assembled instead, which is what those guards' own bodies do.
  const call = (name, arg) => `${name}(${arg});`;
  const cp = ["node", "child_process"].join(":");
  const imp = (bind) => `import { ${bind} } from "${cp}";\n`;
  const GIT = ["g", "i", "t"].join("");
  const argv = `"${GIT}", ["rev-parse", "HEAD"]`;
  const argvExpected = `"${GIT}"`;
  assert.deepEqual(gitSpawns(imp("spawnSync") + call("spawnSync", argv)).map((s) => s.arg), [argvExpected],
    "the spawnSync argv form — invisible before this fix");
  assert.deepEqual(gitSpawns(imp("execFileSync as __x") + call("__x", `"${GIT}", ["status"]`)).map((s) => s.arg), [argvExpected],
    "an ALIASED binding — the imported name never appears at the call site");
  assert.deepEqual(gitSpawns(`import * as ns from "${cp}";\n` + call("ns.spawn", argv)).map((s) => s.arg), [argvExpected],
    "a namespace import");
  assert.deepEqual(gitSpawns(`const { execFileSync: sh } = require("${cp}");\n` + call("sh", argv)).map((s) => s.arg), [argvExpected],
    "a destructured require");
  assert.deepEqual(gitSpawns(imp("execSync") + call("execSync", `"${GIT} log -1"`)).map((s) => s.arg), [`"${GIT} log -1"`],
    "the shell-string form");
  // And the two shapes it must NOT fire on, or it would be weakened the first day.
  assert.deepEqual(gitSpawns("const m = pattern.exec(line);"), [],
    "RegExp.prototype.exec is not a child process");
  assert.deepEqual(gitSpawns(imp("execFileSync") + call("execFileSync", '"openspec", ["--version"]')), [],
    "a non-git spawn is not a git spawn — it is the named omission the test above asserts");
  assert.deepEqual(spawnSites("const a = 1;"), [],
    "a source that never mentions child_process has no spawn sites, whatever it contains");
});
