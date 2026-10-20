// scripts/test/assert/overhead.test.mjs
// pm-overhead-baseline 1.4 / 1.6 -- the FILE rung: what a value test cannot see. Listings and hook rows are read
// from the plugin's own files; `--all-features` leaves every byte of the record where it was; and `overhead`
// opens no path under the spend directory or a transcript directory, tracking on or off.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";
import { hookVerbs, readListings, featureOf, collectSurfaces } from "../../lib/overhead.mjs";
import { invokeEngine } from "../fixtures/assert-harness.mjs";

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repo = () => { const cwd = fs.realpathSync(tmpRepo()); run(["init"], { cwd }); return cwd; };

/** Every file under the repo, as `relative path -> contents`, so byte-identity is a deepEqual. */
function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(root);
  return out;
}

test("1.1 the listings are every shipped command, skill and agent, read from the plugin's files", () => {
  const files = readListings(PLUGIN).map((l) => l.file);
  const onDisk = [
    ...fs.readdirSync(path.join(PLUGIN, "commands")).filter((f) => f.endsWith(".md")).map((f) => `commands/${f}`),
    ...fs.readdirSync(path.join(PLUGIN, "agents")).filter((f) => f.endsWith(".md")).map((f) => `agents/${f}`),
    ...fs.readdirSync(path.join(PLUGIN, "skills")).filter((d) => fs.existsSync(path.join(PLUGIN, "skills", d, "SKILL.md")))
      .map((d) => `skills/${d}/SKILL.md`),
  ];
  assert.deepEqual([...files].sort(), [...onDisk].sort());
  for (const l of readListings(PLUGIN)) assert.ok(l.description.length > 0, `${l.file} has a description`);
});

test("1.1 the hook rows are the verbs hooks/hooks.json invokes", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  const fromFile = new Set();
  for (const entries of Object.values(doc.hooks)) for (const e of entries) for (const h of e.hooks) {
    fromFile.add(/conductor\.mjs"\s+([a-z-]+)/.exec(h.command)[1]);
  }
  assert.deepEqual([...hookVerbs(PLUGIN)].sort(), [...fromFile].sort());
});

test("1.2 every surface of the real plugin in every opt-in configuration has a feature", () => {
  const listings = readListings(PLUGIN);
  const hooks = hookVerbs(PLUGIN);
  const base = { version: 1, revision: 1, active: null, detourStack: [], epics: [] };
  const all = { ...base, tracker: { system: "github-issues", repo: "o/r" }, spendTracking: { enabled: true }, spendGuard: { maxFailedRounds: 2 } };
  for (const state of [base, all]) {
    for (const s of collectSurfaces(state, { listings, hooks, lessons: [] })) assert.notEqual(featureOf(s.id), null, `surface ${s.id} has no feature`);
  }
});

test("1.4 `overhead` and `overhead --all-features` leave state.json, CLAUDE.md and .conductor/ byte-identical", () => {
  const cwd = repo();
  const before = snapshot(cwd);
  const a = run(["overhead"], { cwd });
  const b = run(["overhead", "--all-features"], { cwd });
  const c = run(["overhead", "--all-features", "--json"], { cwd });
  assert.deepEqual(snapshot(cwd), before);
  assert.match(a, /downstream efficiency: not measured by this verb/);
  assert.match(b, /HYPOTHETICAL "all-features"/);
  const j = JSON.parse(c);
  assert.equal(j.hypothetical.name, "all-features");
  for (const f of Object.values(j.features)) assert.equal(f.on, true);
});

test("1.6 `overhead` opens no path under the spend directory or a transcript directory, tracking on or off", () => {
  for (const on of [false, true]) {
    const cwd = repo();
    const cfg = fs.realpathSync(tmpRepo());
    fs.mkdirSync(path.join(cfg, "projects"), { recursive: true });
    if (on) run(["set-spend-tracking", "on"], { cwd });
    fs.mkdirSync(path.join(cwd, ".conductor", "spend"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".conductor", "spend", "rows.jsonl"), '{"messageId":"m1"}\n');
    for (const args of [["overhead"], ["overhead", "--all-features"]]) {
      const { result, touched } = recordFsPaths(() => invokeEngine(args, { cwd, env: { CLAUDE_CONFIG_DIR: cfg } }));
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(touchedUnder(touched, path.join(cwd, ".conductor", "spend")), [], `tracking ${on}: no spend path`);
      assert.deepEqual(touchedUnder(touched, cfg), [], `tracking ${on}: no transcript path`);
    }
  }
});

test("1.6 tracking off: exit 0 with the full report, and the spend surfaces report 0 bytes", () => {
  const cwd = repo();
  const j = JSON.parse(run(["overhead", "--json"], { cwd }));
  assert.equal(j.features.spendTracking.on, false);
  assert.equal(j.features.spendTracking.bytes, 0);
  assert.equal(j.features.spendTracking.perDispatchBytes, 0);
  assert.ok(j.features.listings.surfaces.includes("listing:commands/spend.md"));
});
