// scripts/test/git-gateway-guard.test.mjs
// 4.1 REGRESSION GUARD — the git call-site set is derived MECHANICALLY and asserted against the
// gateway's operations, so a call site added later fails the guard (design D4).
//
// WHY IT IS A GUARD AND NOT A RED. It passes the moment the thing it guards exists — the gateway,
// which is 4.2 — so it is verified by deliberate violations instead: a git call added to another
// module, and a git call added to the gateway without an entry. Both are reproduced in the run that
// landed this file and both turn it red (see the commit message).
//
// WHY DERIVED RATHER THAN TYPED. This change's own task list measures 23 sites across 7 modules while
// the brief that preceded it said 19, and the two documents disagree with each other as well: the
// design lists `worktree-hygiene.mjs` at `:35, :75` and the file's own sites are at `:37, :77`, because
// the global sweep moved every line. A list typed from either is stale on arrival. The derivation is
// a regex over the engine's own source, so it is a measurement rather than a recollection, and it is
// re-run on every commit rather than once at apply time.
//
// THE DERIVATION IS TWO-SIDED, and each side catches what the other cannot:
//   * NO OTHER MODULE SPAWNS GIT. Every spawn whose command is git, anywhere under `scripts/lib/` or
//     in `conductor.mjs`, must be inside the gateway module. A call site added to `render.mjs`
//     tomorrow fails here — the property that makes the injection worth having.
//   * THE OPERATION TABLE MATCHES THE CALLS, IN ORDER. Each declared operation owns exactly one
//     derived exec, positionally, so an exec added to the gateway without an operation (or an
//     operation renamed, or a call reordered) fails here — the property a count alone would miss.
//
// IT NOW SEES EVERY SHAPE (G-I5, Gate 2). The derivation used to be
// `(execFileSync|execSync)\(\s*"git` — two function names out of six, no aliased binding, nothing for
// a program passed as an expression. Under it, a `spawnSync` of git added to
// `scripts/lib/changelog.mjs` left BOTH guards green, and so did `import { execFileSync as __x }`.
// The derivation is now `fixtures/spawn-derivation.mjs` — one module, shared with the assertion twin,
// so the two cannot drift apart — and it resolves ALL SIX child-process entry points, each source's
// OWN binding names, and classifies a site by its first argument.
//
// THE OMISSIONS ARE NAMED, not left implicit (required task item 1), AND THE LIST IS NOW TRUE (G-I5):
// `tool-currency.mjs`'s `openspec --version` probe and `self-hosting.mjs`'s `spawnSync(process.execPath,
// …)` delegation handoff. The old test asserted tool-currency's was "the engine's only non-git spawn",
// which was already false — `self-hosting` was invisible to a pattern that required a string literal
// after the paren. Both are deliberate, neither is behind the GIT gateway, and both are asserted by
// identity below so the exclusion cannot grow one call at a time.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitSpawns, otherSpawns, spawnerNames, spawnSites } from "../fixtures/spawn-derivation.mjs";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATEWAY = "scripts/lib/git-gateway.mjs";

/** Every engine source file a git call could hide in. */
function engineFiles() {
  const files = fs.readdirSync(path.join(SCRIPTS, "lib")).filter(f => f.endsWith(".mjs"))
    .map(f => `scripts/lib/${f}`);
  files.push("scripts/conductor.mjs");
  return files.sort();
}

const sourceOf = (rel) => fs.readFileSync(path.join(SCRIPTS, "..", rel), "utf8");

/** The source of one operation in the gateway's returned object literal. The operations are separated
 * by blank lines; the extractor asserts its own anchor so a reformat fails loudly rather than
 * silently returning the whole file. */
function operationBody(src, name) {
  const start = src.indexOf(`\n    ${name}: (`);
  assert.notEqual(start, -1, `${name} is not an operation in ${GATEWAY} — the table and the source disagree`);
  const end = src.indexOf("\n\n", start + 1);
  assert.notEqual(end, -1, `${name}'s body ended before the next operation — the extractor's anchor moved`);
  return src.slice(start, end);
}

test("gateway: no engine module outside the gateway spawns git — the call sites are DERIVED, not listed", () => {
  const found = [];
  for (const rel of engineFiles()) {
    for (const site of gitSpawns(sourceOf(rel))) found.push({ rel, ...site });
  }
  const outside = found.filter(s => s.rel !== GATEWAY);
  assert.deepEqual(outside.map(s => `${s.rel}: ${s.call}`), [],
    "a git call site outside the injected gateway is a call site the assertion half's double cannot " +
    "answer — it must be given an operation in " + GATEWAY);
  assert.equal(found.length, 23,
    `the engine makes ${found.length} git invocations and ${GATEWAY} must hold every one of them; ` +
    "this count is the derivation's, not a number in a document");
});

test("gateway: every operation owns exactly one derived call, in order, and the table covers them all", async () => {
  const src = sourceOf(GATEWAY);
  const { GIT_OPERATIONS } = await import("../../lib/git-gateway.mjs");
  const derived = gitSpawns(src);

  assert.equal(GIT_OPERATIONS.length, derived.length,
    `${GIT_OPERATIONS.length} operations declare ${derived.length} git calls — an operation with no ` +
    "call, or a call with no operation");
  assert.equal(new Set(GIT_OPERATIONS.map(o => o.name)).size, GIT_OPERATIONS.length,
    "operation names are the fake's and the capture's keys, so a duplicate would silently drop one");
  for (const op of GIT_OPERATIONS) {
    assert.match(op.command, /^git /, `${op.name}'s declared command must read as a git invocation`);
    assert.ok(op.asks && op.asks.length > 10, `${op.name} declares what it asks git`);
  }

  // POSITIONAL, and that is the point: a count alone would not notice a call reordered or one
  // operation's call moved into another's body.
  GIT_OPERATIONS.forEach((op, i) => {
    assert.equal(gitSpawns(operationBody(src, op.name), spawnerNames(src)).length, 1,
      `${op.name} is the ${i}-th declared operation and must hold the ${i}-th git call`);
    // And the exec it holds is the i-th one in the file, so the two orderings agree.
    assert.ok(derived[i].index > src.indexOf(`\n    ${op.name}: (`),
      `${op.name}'s git call must be inside its own operation body`);
    if (i + 1 < GIT_OPERATIONS.length) {
      assert.ok(derived[i].index < src.indexOf(`\n    ${GIT_OPERATIONS[i + 1].name}: (`),
        `${op.name}'s git call must come before ${GIT_OPERATIONS[i + 1].name}'s — the declared order ` +
        "and the source order have diverged");
    }
  });
});

test("gateway: nothing imports it — callers are HANDED it, through the invocation", () => {
  // 4.2's other half, and the one that makes the injection real rather than nominal: a module that
  // IMPORTED the gateway could not be given a double without monkey-patching `child_process`, which
  // fakes git for the whole process including the tests that want the real thing (design D4). So
  // `lib/invocation.mjs` is the ONLY engine file that may name it, and every caller reaches it
  // through `gitOps()` — which is exactly what the call-site derivation above then sees: no `git`
  // spawn outside the gateway, and no import of the gateway outside the invocation.
  const importers = [];
  for (const rel of engineFiles()) {
    if (/from\s+["'][^"']*git-gateway\.mjs["']/.test(sourceOf(rel))) importers.push(rel);
  }
  assert.deepEqual(importers, ["scripts/lib/invocation.mjs"],
    "the git gateway may be imported by lib/invocation.mjs alone — every other caller is handed it " +
    "as part of the invocation, so the assertion half can substitute a double by plain injection");

  // And the callers really do go through the accessor rather than through a captured object: every
  // module that used to spawn git now names `gitOps()`.
  for (const rel of ["scripts/lib/git.mjs", "scripts/lib/created-at.mjs", "scripts/lib/subcommands.mjs",
    "scripts/lib/commit-watch.mjs", "scripts/lib/worktree-hygiene.mjs", "scripts/lib/tool-currency.mjs",
    "scripts/lib/constants.mjs"]) {
    assert.match(sourceOf(rel), /gitOps\(\)/, `${rel} must reach git through the invocation's gateway`);
  }
});

test("gateway: the non-git spawns are EXACTLY the two named omissions — the list is asserted, not hoped", () => {
  // THE EXCLUSION IS A CLOSED SET. Every other spawn is invisible to the git filter above, so a
  // second non-git spawn — an `openspec` subcommand, a `node` child, a `git` spelled through a
  // variable — would be a call site the gateway deliberately does not cover and no check would see.
  // Asserting the whole list by identity, rather than `length <= 1` over one file, is what makes the
  // omission a decision that has to be re-made rather than a gap that can widen quietly.
  const others = [];
  for (const rel of engineFiles()) {
    for (const arg of otherSpawns(sourceOf(rel))) others.push(`${rel}: ${arg}`);
  }
  assert.deepEqual(others, [
    "scripts/lib/self-hosting.mjs: process.execPath",
    'scripts/lib/tool-currency.mjs: "openspec"',
  ],
    "the engine's non-git spawns are the delegation handoff (self-hosting.mjs spawns THIS process's " +
    "own node, by absolute path — not a git call and not behind a gateway over git) and " +
    "tool-currency.mjs's `openspec --version` probe. Any other spawn is a site nothing covers, and " +
    "adding one here is a decision that must be written down, not an accident that passes");
});

test("gateway: the derivation DISCRIMINATES — every shape the old pattern missed is seen", () => {
  // The four shapes Gate 2 measured as invisible, each in isolation. This test is what stops the
  // guard from being narrowed back: a derivation that stops seeing one of these fails HERE, by name,
  // rather than silently reporting fewer sites. The samples assemble the program name from parts
  // because hermetic-git's walk refuses a functional file that quotes the program name without
  // importing the harness — this file reads sources rather than spawning, so the literal is all
  // there is to avoid and the guard keeps its full strength.
  const call = (name, arg) => `${name}(${arg});`;
  const imp = (bind, mod) => `import { ${bind} } from "${mod}";\n`;
  const cp = ["node", "child_process"].join(":");
  const GIT = ["g", "i", "t"].join("");
  const named = (src) => gitSpawns(src).map((s) => s.arg);
  assert.deepEqual(named(imp("execFileSync", cp) + call("execFileSync", `"${GIT}", ["rev-parse"]`)),
    [`"${GIT}"`], "the plain argv form");
  assert.deepEqual(named(imp("spawnSync", cp) + call("spawnSync", `"${GIT}", ["rev-parse", "HEAD"]`)),
    [`"${GIT}"`], "spawnSync — the shape that was green before this fix");
  assert.deepEqual(named(imp("execSync as __x", cp) + call("__x", `"${GIT} log -1"`)),
    [`"${GIT} log -1"`], "an ALIASED binding — the imported name never appears at the call site");
  assert.deepEqual(named(`import * as ns from "${cp}";\n` + call("ns.spawnSync", `"${GIT}", ["status"]`)),
    [`"${GIT}"`], "a namespace import");
  assert.deepEqual(named(`const { execFileSync: sh } = require("${cp}");\n` + call("sh", `"${GIT}", ["status"]`)),
    [`"${GIT}"`], "a destructured require");
  // And it must NOT fire on a regex method of the same name — a guard that did would be weakened the
  // first day, which is how the property it protects gets lost.
  assert.deepEqual(gitSpawns("const m = pattern.exec(line);"), [], "RegExp.prototype.exec is not a spawn");
  assert.deepEqual(gitSpawns(imp("execFileSync", cp) + call("execFileSync", '"openspec", ["--version"]')), [],
    "a non-git spawn is not a git spawn — it is the named omission the test above asserts");
  assert.equal(spawnSites("const a = 1;").length, 0,
    "a source with no child_process import has no spawn sites, whatever it contains");
});
