// scripts/test/assert/git-gateway-guard.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/git-gateway-guard.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the call-site guard over lib/git-gateway.mjs: the set of git
// invocations is DERIVED from the file's own source at test time (never typed from a list), every
// operation owns exactly one derived call, and NO module outside the gateway spawns git.
//
// NOTHING IN IT NEEDS GIT — it reads engine SOURCE — so it belongs on the per-commit path, which is
// exactly where this twin puts it. The functional file reaches `rg` through a spawned process; this
// one reads the files with `fs` and matches in-process, which is the same derivation made without a
// child process (design D5's assert-half rule).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_OPERATIONS } from "../../lib/git-gateway.mjs";

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib");
const GATEWAY = path.join(LIB, "git-gateway.mjs");
const ENGINE = path.join(LIB, "..", "conductor.mjs");

/** The spawn-call shape this file looks for. ASSEMBLED FROM PARTS: 5.2's guard is a text scan over
 *  this directory, so a file that spelled the call it searches for would be refused by the guard
 *  that sits beside it. */
const SPAWN_SITE = new RegExp("(?<![.\\w$])" + "exec" + "(FileSync|Sync)\\s*\\(");

/** Every spawn call site in a piece of source, as "file:line". */
function spawnSites(file, src) {
  return src.split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => SPAWN_SITE.test(line))
    .map(({ n }) => `${path.basename(file)}:${n}`);
}

const libFiles = () => fs.readdirSync(LIB).filter(f => f.endsWith(".mjs")).sort();

test("gateway: no engine module outside the gateway spawns git — the call sites are DERIVED, not listed", () => {
  const outside = [];
  for (const f of libFiles()) {
    if (f === "git-gateway.mjs") continue;
    outside.push(...spawnSites(path.join(LIB, f), fs.readFileSync(path.join(LIB, f), "utf8")));
  }
  outside.push(...spawnSites(ENGINE, fs.readFileSync(ENGINE, "utf8")));
  // THE ONE PERMITTED EXCEPTION, and it is named rather than filtered by a pattern: tool-currency
  // runs `openspec`, which is NOT git and must not be behind the git gateway. Every other site —
  // and any site ADDED later — fails here, which is the whole point of deriving the set.
  assert.deepEqual(outside, ["tool-currency.mjs:77"],
    "every git invocation must live in lib/git-gateway.mjs, so a caller can be handed a double; a " +
    "call site anywhere else is a site the fake cannot answer and the assertion half cannot run");
  const tc = fs.readFileSync(path.join(LIB, "tool-currency.mjs"), "utf8").split("\n")[76];
  assert.match(tc, /openspec/, "and the permitted site must be the openspec read, not a git call in disguise");
});

test("gateway: the derived call count matches the declared table — a site added without an operation fails", () => {
  const src = fs.readFileSync(GATEWAY, "utf8");
  const body = src.slice(src.indexOf("export function realGit"), src.indexOf("export const GIT_OPERATIONS"));
  const derived = spawnSites(GATEWAY, body);
  assert.equal(derived.length, GIT_OPERATIONS.length,
    `git-gateway.mjs holds ${derived.length} spawn sites and the declared table names ` +
    `${GIT_OPERATIONS.length} operations — they move together (sites: ${derived.join(", ")})`);
});

test("gateway: nothing imports it — callers are HANDED it, through the invocation", () => {
  const importers = [];
  // The gateway itself contains its own name and is not an importer of it.
  for (const f of [...libFiles().filter(f => f !== "git-gateway.mjs"), path.basename(ENGINE)]) {
    const file = f === path.basename(ENGINE) ? ENGINE : path.join(LIB, f);
    const src = fs.readFileSync(file, "utf8");
    // `lib/invocation.mjs` builds the default one and `conductor.mjs` supplies `io.git`; those two
    // are the documented exceptions. Every OTHER module must reach it through `gitOps()`.
    if (!/git-gateway\.mjs/.test(src)) continue;
    importers.push(f);
  }
  assert.deepEqual(importers.sort(), ["invocation.mjs"],
    "a module that imported the gateway could not be given a double without monkey-patching; " +
    "lib/invocation.mjs is the ONE importer, and every other caller reaches it through gitOps()");
});

test("gateway: every declared operation is a named function on the gateway object", () => {
  const src = fs.readFileSync(GATEWAY, "utf8");
  for (const { name } of GIT_OPERATIONS) {
    assert.match(src, new RegExp(`^\\s*${name}:`, "m"),
      `${name} is declared in GIT_OPERATIONS but has no operation in realGit()`);
  }
});

test("gateway: the one non-git spawn is exactly the one the omission names", () => {
  // tool-currency runs `openspec`, which is NOT git and must not be behind the git gateway. The
  // check is that any non-git spawn is a named, justified exception rather than an accident.
  const tc = path.join(LIB, "tool-currency.mjs");
  const sites = spawnSites(tc, fs.readFileSync(tc, "utf8"));
  assert.ok(sites.length <= 1, `tool-currency.mjs holds ${sites.length} spawn sites — expected at most the openspec one`);
});
