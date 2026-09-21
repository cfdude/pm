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
//   * NO OTHER MODULE SPAWNS GIT. Every `execFileSync`/`execSync` whose command is git, anywhere under
//     `scripts/lib/` or in `conductor.mjs`, must be inside the gateway module. A call site added to
//     `render.mjs` tomorrow fails here — the property that makes the injection worth having.
//   * THE OPERATION TABLE MATCHES THE CALLS, IN ORDER. Each declared operation owns exactly one
//     derived exec, positionally, so an exec added to the gateway without an operation (or an
//     operation renamed, or a call reordered) fails here — the property a count alone would miss.
//
// THE ONE OMISSION IS NAMED, not left implicit (required task item 1): `tool-currency.mjs`'s
// `execFileSync("openspec", ["--version"])` is the engine's only non-git spawn and is deliberately
// not behind this gateway, which is over GIT. The derivation's filter is what excludes it, and the
// test asserts that exactly one such non-git spawn exists so the exclusion cannot quietly grow.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY = "scripts/lib/git-gateway.mjs";

/** Every engine source file a git call could hide in. */
function engineFiles() {
  const files = fs.readdirSync(path.join(SCRIPTS, "lib")).filter(f => f.endsWith(".mjs"))
    .map(f => `scripts/lib/${f}`);
  files.push("scripts/conductor.mjs");
  return files.sort();
}

/** A spawn whose COMMAND is git. `execSync` takes a shell string and `execFileSync` an argv array, and
 *  the pattern covers both: after the opening paren, a string literal beginning with `git` — the whole
 *  command for the first, the program for the second. Nothing else in the engine interpolates a value
 *  into that position, and the assertion below would fail on one that did. */
const GIT_SPAWN = /(execFileSync|execSync)\(\s*"git/;
const ANY_SPAWN = /(execFileSync|execSync)\(\s*"[^"]*"/;

/** The git spawns in one source, as `{ index, call }` — the call being the matched text, which is what
 *  ties a derived site to the operation that owns it. */
function gitSpawns(src) {
  const out = [];
  const re = new RegExp(GIT_SPAWN.source, "g");
  let m;
  while ((m = re.exec(src)) !== null) out.push({ index: m.index, call: m[0] });
  return out;
}

/** The source of one operation in the gateway's returned object literal. The operations are separated
 *  by blank lines; the extractor asserts its own anchor so a reformat fails loudly rather than
 *  silently returning the whole file. */
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
    const src = fs.readFileSync(path.join(SCRIPTS, "..", rel), "utf8");
    for (const site of gitSpawns(src)) found.push({ rel, ...site });
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
  const src = fs.readFileSync(path.join(SCRIPTS, "..", GATEWAY), "utf8");
  const { GIT_OPERATIONS } = await import("../lib/git-gateway.mjs");
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
    assert.match(operationBody(src, op.name), GIT_SPAWN,
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
    const src = fs.readFileSync(path.join(SCRIPTS, "..", rel), "utf8");
    if (/from\s+["'][^"']*git-gateway\.mjs["']/.test(src)) importers.push(rel);
  }
  assert.deepEqual(importers, ["scripts/lib/invocation.mjs"],
    "the git gateway may be imported by lib/invocation.mjs alone — every other caller is handed it " +
    "as part of the invocation, so the assertion half can substitute a double by plain injection");

  // And the callers really do go through the accessor rather than through a captured object: every
  // module that used to spawn git now names `gitOps()`.
  for (const rel of ["scripts/lib/git.mjs", "scripts/lib/created-at.mjs", "scripts/lib/subcommands.mjs",
    "scripts/lib/commit-watch.mjs", "scripts/lib/worktree-hygiene.mjs", "scripts/lib/tool-currency.mjs",
    "scripts/lib/constants.mjs"]) {
    const src = fs.readFileSync(path.join(SCRIPTS, "..", rel), "utf8");
    assert.match(src, /gitOps\(\)/, `${rel} must reach git through the invocation's gateway`);
  }
});

test("gateway: the one non-git spawn is exactly the one the omission names", () => {
  // The sweep's filter is `git`, so every other spawn is invisible to it. Asserting the exclusion is
  // a SIZE rather than a hope: a second non-git spawn — an `openspec` subcommand, a `git` spelled
  // through a variable — is a call site the gateway deliberately does not cover and the guard would
  // otherwise never see.
  const others = [];
  for (const rel of engineFiles()) {
    if (rel === GATEWAY) continue;
    const src = fs.readFileSync(path.join(SCRIPTS, "..", rel), "utf8");
    const re = new RegExp(ANY_SPAWN.source, "g");
    let m;
    while ((m = re.exec(src)) !== null) others.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(others, ['scripts/lib/tool-currency.mjs: execFileSync("openspec"'],
    "the engine's only non-git spawn is tool-currency.mjs's `openspec --version` probe — the gateway " +
    "is over GIT, and that probe is a named omission rather than a miss");
});
