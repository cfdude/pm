// gh-134: the plugin's hooks and slash commands both invoke the engine through
// ${CLAUDE_PLUGIN_ROOT} — the INSTALLED plugin. While pm itself is being developed that
// engine is a release behind the working tree, so a PostToolUse hook re-renders the tracked
// PROJECT.md with output that predates the checkout's changes. These tests pin the handoff:
// when the project being worked in IS a pm checkout, the installed engine re-execs the
// checkout's engine and becomes a transparent pass-through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, EMPTY_CACHE, tmpRepo, fixturePluginRoot } from "./helpers.mjs";

/** A pm-shaped checkout whose engine is a stub that reports how it was invoked.
 *  `name` and `version` are the checkout's own plugin.json identity. */
function fakeCheckout({ name = "pm", version = "9.9.9", manifest = true, exitCode = 0 } = {}) {
  const dir = tmpRepo();
  if (manifest) {
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version }) + "\n",
    );
  }
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "conductor.mjs"), `
import fs from "node:fs";
import path from "node:path";
const root = process.env.CLAUDE_PLUGIN_ROOT;
let ver = "none";
try { ver = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version; } catch {}
process.stdout.write("CHECKOUT-ENGINE argv=" + process.argv.slice(2).join(" ") + " version=" + ver + "\\n");
process.exit(${exitCode});
`);
  return dir;
}

function runEngine(args, { cwd, env = {} } = {}) {
  return spawnSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    encoding: "utf8",
  });
}

test("the installed engine hands off to the checkout's engine when the project is a pm checkout", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief", "--platform", "claude-code"], { cwd: dir });
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
  const r = runEngine(["brief"], { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: installed } });
  assert.match(r.stdout, /version=9\.9\.9/);
  assert.doesNotMatch(r.stdout, /version=0\.0\.1/);
});

test("the handoff propagates the checkout engine's exit code (gate-guard is a blocking hook)", () => {
  const dir = fakeCheckout({ exitCode: 9 });
  const r = runEngine(["gate-guard"], { cwd: dir });
  assert.equal(r.status, 9);
});

test("a project with a conductor.mjs but no pm manifest is NOT executed", () => {
  const dir = fakeCheckout({ manifest: false });
  const r = runEngine(["brief"], { cwd: dir });
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.stdout.trim(), "");
});

test("a project whose manifest names a different plugin is NOT executed", () => {
  const dir = fakeCheckout({ name: "not-pm" });
  const r = runEngine(["brief"], { cwd: dir });
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.stdout.trim(), "");
});

test("the sentinel stops a delegated engine from delegating again", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief"], { cwd: dir, env: { PM_ENGINE_DELEGATED: "1" } });
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.stdout.trim(), "");
});

test("PM_NO_ENGINE_DELEGATION is an escape hatch", () => {
  const dir = fakeCheckout();
  const r = runEngine(["brief"], { cwd: dir, env: { PM_NO_ENGINE_DELEGATION: "1" } });
  assert.doesNotMatch(r.stdout, /CHECKOUT-ENGINE/);
  assert.equal(r.stdout.trim(), "");
});

test("an ordinary project — no scripts/conductor.mjs — is untouched by the handoff", () => {
  const dir = tmpRepo();
  const r = runEngine(["brief"], { cwd: dir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
