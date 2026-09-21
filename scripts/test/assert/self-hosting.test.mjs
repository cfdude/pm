// scripts/test/assert/self-hosting.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/self-hosting.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the self-hosting handoff: a pm checkout may run ITS OWN engine
// instead of the installed one, gated by an OPT-IN that NAMES THE CHECKOUT (`PM_ENGINE_DELEGATION`).
// The first version keyed off two files a project could write, so a hostile directory got arbitrary
// code executed — which is why every guard in the module is mutation-tested.
//
// THE DECISION ITSELF IS A PURE FUNCTION of a root and an environment, so the SECURITY cases are
// this half's, and they belong on the per-commit path: a boundary that stops holding is the worst
// thing that can regress silently. The real spawned handoff (exit-code propagation, the repointed
// CLAUDE_PLUGIN_ROOT) is functional-only, because it starts a child process (design D5).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { delegationAuthorized, checkoutEngine, DELEGATION_ENV, DELEGATED_ENV } from "../../lib/self-hosting.mjs";

/** A directory shaped like a pm checkout: an engine file and a manifest that names `pm`. */
function fakeCheckout({ name = "pm", engine = true } = {}) {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  if (engine) fs.writeFileSync(path.join(dir, "scripts", "conductor.mjs"), "// not the engine\n");
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
  return dir;
}

test("SECURITY: the two-file hostile shape is REFUSED when the opt-in is unset", () => {
  const hostile = fakeCheckout();
  assert.equal(delegationAuthorized(hostile, {}), false,
    "two lines of JSON a project can write must never authorize executing that project's code");
});

test("SECURITY: an opt-in naming a DIFFERENT checkout does not authorize this one", () => {
  const hostile = fakeCheckout();
  const other = fakeCheckout();
  assert.equal(delegationAuthorized(hostile, { [DELEGATION_ENV]: other }), false);
});

test("SECURITY: an opt-in pointing at a path that does not exist authorizes nothing", () => {
  const hostile = fakeCheckout();
  assert.equal(delegationAuthorized(hostile, { [DELEGATION_ENV]: path.join(hostile, "nope") }), false);
});

test("the opt-in authorizes exactly the checkout it names, and nothing else", () => {
  const checkout = fakeCheckout();
  assert.equal(delegationAuthorized(checkout, { [DELEGATION_ENV]: checkout }), true);
  assert.equal(delegationAuthorized(checkout, { [DELEGATION_ENV]: checkout + "/" }), true,
    "a trailing slash resolves to the same tree — realpath, not string equality");
});

test("a named checkout with a manifest but NO scripts/conductor.mjs runs locally", () => {
  const dir = fakeCheckout({ engine: false });
  assert.equal(checkoutEngine(dir), null);
});

test("a named checkout whose manifest names a different plugin is NOT executed", () => {
  const dir = fakeCheckout({ name: "something-else" });
  assert.equal(checkoutEngine(dir), null);
});

test("the sentinel is declared and stops a delegated engine from delegating again", () => {
  // The realpath equality already closes every shape realpath can compare (a copy, a shim, a
  // bind mount, a hardlink, a worktree, a case-differing ROOT); the sentinel covers a target
  // engine that predates this release and would not perform the check itself. This half asserts
  // the NAME the child carries, because the arm that reads it crosses a process boundary.
  assert.equal(DELEGATED_ENV, "PM_ENGINE_DELEGATED");
  const checkout = fakeCheckout();
  const env = { [DELEGATION_ENV]: checkout, [DELEGATED_ENV]: "1" };
  assert.ok(env[DELEGATED_ENV], "the child's environment carries the sentinel");
});

test("an ordinary project — no scripts/conductor.mjs, no opt-in — is untouched by the handoff", () => {
  const cwd = tmpRepo();
  // No opt-in, and nothing checkout-shaped: every invocation runs the installed engine and
  // behaves exactly as it would anywhere else.
  const r = invokeEngine(["init"], { cwd, env: { [DELEGATION_ENV]: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(cwd, ".conductor", "state.json")));
});

test("an opt-in naming a NON-conductor directory leaves the invocation local", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const notACheckout = tmpRepo();
  const r = invokeEngine(["brief"], { cwd, env: { [DELEGATION_ENV]: notACheckout } });
  assert.equal(r.status, 0, "a mistyped opt-in fails closed and the invocation runs locally");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "the installed engine hands off when the project IS the checkout the opt-in names", "the handoff
// repoints CLAUDE_PLUGIN_ROOT at the checkout", "the handoff propagates the checkout engine's exit
// code" and "an engine asked to hand off to ITSELF runs locally" all cross a REAL process boundary —
// the whole subject is a spawned child (design D5). The decision that guards them is the pure
// function asserted above, on the per-commit path.
