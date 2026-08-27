// gh-134: the plugin's hooks and slash commands both invoke the engine through
// ${CLAUDE_PLUGIN_ROOT} — the INSTALLED plugin. While pm itself is being developed that
// engine is a release behind the working tree, so a PostToolUse hook re-renders the tracked
// PROJECT.md with output that predates the checkout's changes. These tests pin the handoff:
// when the developer has NAMED their checkout in PM_ENGINE_DELEGATION, the installed engine
// re-execs that checkout's engine and becomes a transparent pass-through.
//
// The opt-in is the security boundary, and half of this file exists to hold it. The four hooks
// evaluate this handoff in EVERY project on the machine, initialized or not, on roughly every
// turn. A project-supplied `.claude-plugin/plugin.json` naming `pm` is two lines of JSON an
// attacker writes, so it can never be what authorizes execution; only an absolute path that
// came from the ENVIRONMENT can.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, EMPTY_CACHE, tmpRepo, fixturePluginRoot } from "./helpers.mjs";

const MARKER = "EXECUTED";

/** A pm-shaped checkout whose engine is a stub that reports how it was invoked AND writes a
 *  marker file, so "was this executed?" is answerable by side effect rather than by absent
 *  stdout — absent stdout is also what a silent, dormant local run produces.
 *  `name`/`version` are the checkout's own plugin.json identity. */
function fakeCheckout({ name = "pm", version = "9.9.9", manifest = true, engine = true, exitCode = 0 } = {}) {
  const dir = tmpRepo();
  if (manifest) {
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version }) + "\n",
    );
  }
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  if (engine) {
    fs.writeFileSync(path.join(dir, "scripts", "conductor.mjs"), `
import fs from "node:fs";
import path from "node:path";
const root = process.env.CLAUDE_PLUGIN_ROOT;
let ver = "none";
try { ver = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version; } catch {}
// The side effect a hostile fixture would produce: proof of arbitrary execution with the
// parent's full environment, written where the test can see it without reading stdout.
fs.writeFileSync(${JSON.stringify(path.join(dir, MARKER))}, String(process.env.HOME || "") + "\\n");
process.stdout.write("CHECKOUT-ENGINE argv=" + process.argv.slice(2).join(" ") + " version=" + ver + "\\n");
process.exit(${exitCode});
`);
  }
  return dir;
}

/** Did the fixture's engine actually run? */
function executed(dir) {
  return fs.existsSync(path.join(dir, MARKER));
}

function runEngine(args, { cwd, env = {} } = {}) {
  return spawnSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    encoding: "utf8",
  });
}

// ───────────────────────── the boundary ─────────────────────────

test("SECURITY: the two-file hostile shape is REFUSED when the opt-in is unset", () => {
  // Exactly what an attacker ships: a .claude-plugin/plugin.json naming `pm` and a
  // scripts/conductor.mjs. No .conductor/, no /pm:init, no user action beyond opening the
  // folder — and the plugin's SessionStart/PreToolUse/PostToolUse/PreCompact hooks all
  // evaluate this path. Nothing the project itself can write may authorize execution.
  const dir = fakeCheckout();
  const r = runEngine(["brief"], { cwd: dir });
  assert.equal(executed(dir), false, "the project's own conductor.mjs must NOT be executed");
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.status, 0);
});

test("SECURITY: an opt-in naming a DIFFERENT checkout does not authorize this one", () => {
  // The realistic misuse the path-naming form is designed against: a developer exports the
  // variable once in a shell profile, so it is set for every project they ever open. It names
  // THEIR checkout, so a hostile repo elsewhere on disk still never matches.
  const mine = fakeCheckout();
  const hostile = fakeCheckout();
  const r = runEngine(["brief"], { cwd: hostile, env: { PM_ENGINE_DELEGATION: mine } });
  assert.equal(executed(hostile), false);
  assert.equal(executed(mine), false, "and it must not run the named checkout against a foreign project either");
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
});

test("SECURITY: an opt-in pointing at a path that does not exist authorizes nothing", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: path.join(dir, "nope") } });
  assert.equal(executed(dir), false);
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
});

// ───────────────────────── the handoff itself ─────────────────────────

test("the installed engine hands off when the project IS the checkout the opt-in names", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief", "--platform", "claude-code"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir } });
  assert.equal(executed(dir), true);
  assert.match(r.stdout, /CHECKOUT-ENGINE/);
  assert.match(r.stdout, /argv=brief --platform claude-code/);
  assert.equal(r.status, 0);
});

test("the handoff repoints CLAUDE_PLUGIN_ROOT at the checkout, so the checkout's own version is what renders", () => {
  const dir = fakeCheckout({ version: "9.9.9" });
  // The installed plugin the hook resolved through — a release behind the checkout. Inheriting
  // it is the whole bug: the checkout engine would then read the INSTALLED plugin.json and
  // render exactly the stale output this issue is about.
  const installed = fixturePluginRoot("0.0.1");
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir, CLAUDE_PLUGIN_ROOT: installed } });
  assert.match(r.stdout, /version=9\.9\.9/);
  assert.doesNotMatch(r.stdout, /version=0\.0\.1/);
});

test("the handoff propagates the checkout engine's exit code (gate-guard is a blocking hook)", () => {
  const dir = fakeCheckout({ exitCode: 9 });
  const r = runEngine(["gate-guard"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir } });
  assert.equal(r.status, 9);
});

// ───────────────────────── each guard, alone ─────────────────────────

test("a named checkout with a manifest but NO scripts/conductor.mjs runs locally", () => {
  // The existsSync guard standing on its own: the manifest is present and names `pm`, and the
  // opt-in authorizes this very directory, so nothing else can be what refuses.
  const dir = fakeCheckout({ engine: false });
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir } });
  assert.equal(executed(dir), false);
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.status, 0);
});

test("a named checkout with a conductor.mjs but no manifest is NOT executed", () => {
  const dir = fakeCheckout({ manifest: false });
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir } });
  assert.equal(executed(dir), false);
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
});

test("a named checkout whose manifest names a different plugin is NOT executed", () => {
  const dir = fakeCheckout({ name: "not-pm" });
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir } });
  assert.equal(executed(dir), false);
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
});

test("the sentinel stops a delegated engine from delegating again", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATION: dir, PM_ENGINE_DELEGATED: "1" } });
  assert.equal(executed(dir), false);
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
});

test("an engine asked to hand off to ITSELF runs locally instead of re-spawning", async () => {
  // The everyday case once a developer exports the opt-in: `node scripts/conductor.mjs` run
  // from inside the very checkout it names. Driven as a unit because from the outside a
  // redundant re-spawn is invisible — same output, same exit code, just one wasted process and
  // a sentinel quietly absorbing what would otherwise recurse.
  const dir = fakeCheckout();
  const { delegateToCheckout } = await import("../lib/self-hosting.mjs");
  const result = delegateToCheckout({
    selfPath: path.join(dir, "scripts", "conductor.mjs"),
    argv: ["brief"],
    root: dir,
    env: { PM_ENGINE_DELEGATION: dir },
  });
  assert.equal(result, null, "null means 'no handoff — carry on locally'");
  assert.equal(executed(dir), false);
});

test("an ordinary project — no scripts/conductor.mjs, no opt-in — is untouched by the handoff", () => {
  const dir = tmpRepo();
  const r = runEngine(["brief"], { cwd: dir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
