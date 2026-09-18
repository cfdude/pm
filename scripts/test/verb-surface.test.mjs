// every-verb-refuses-what-it-does-not-read — what every dispatched verb accepts on its command
// line, and the guarantee that a refused command line leaves every file exactly as it was.
//
// The population of every sweep below is the DISPATCH TABLE read out of conductor.mjs, never a
// list typed here: a verb added later is covered by these tests the moment it is dispatched, which
// is the whole reason the check this file guards is bound to that table rather than placed per verb.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ENGINE, EMPTY_CACHE, tmpRepo, run } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** One engine invocation, never throwing: status, stdout and stderr, so a refusal is asserted by
 *  its CAUSE text and not by a non-zero exit alone. Same environment as helpers.mjs run(). */
function engine(args, { cwd, input = "", env = {} } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, input, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, PM_QUIET_ENGINE_BANNER: "1", ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** The files a refused command line must leave byte-identical, `null` where absent. */
const WATCHED = [".conductor/state.json", ".conductor/detours.log", "PROJECT.md", "CLAUDE.md"];
function snap(cwd, extra = []) {
  const out = {};
  for (const rel of [...WATCHED, ...extra]) {
    const p = path.join(cwd, rel);
    out[rel] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  }
  return out;
}

const initialized = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const gitRepoWithoutPm = () => {
  const cwd = tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd });
  return cwd;
};

/** The verbs pm's own hook configuration invokes, read from hooks/hooks.json at test time. */
function hookCommandLines() {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, "hooks", "hooks.json"), "utf8"));
  const lines = [];
  for (const groups of Object.values(cfg.hooks)) {
    for (const g of groups) for (const h of g.hooks) if (h.type === "command") lines.push(h.command);
  }
  assert.ok(lines.length >= 5, `hooks.json yielded only ${lines.length} command lines — the reader is broken`);
  return lines;
}
const hookVerbsInConfig = () => new Set(hookCommandLines().map(l => {
  const m = /conductor\.mjs"?\s+([a-z-]+)/.exec(l);
  assert.ok(m, `cannot read the verb out of hook line: ${l}`);
  return m[1];
}));

/** The verb names the engine actually dispatches, read from conductor.mjs's dispatch object.
 *  DUPLICATED from conductor-31.test.mjs, as that file's own comment prescribes — nine lines, and
 *  hoisting it would edit a file every test module imports. */
function dispatchedVerbs() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const body = src.slice(src.indexOf("({", src.indexOf("try {", start)));
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  for (const m of table.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// ═══════════════ 1.1 — positional arity is declared for every dispatched verb ═══════════════

const validArity = (row, label) => {
  assert.ok(Number.isInteger(row.min) && row.min >= 0, `${label}: min must be a non-negative integer`);
  assert.ok(row.max === Infinity || (Number.isInteger(row.max) && row.max >= row.min),
    `${label}: max must be an integer >= min, or Infinity`);
  assert.equal(typeof row.form, "string", `${label}: form must be a string`);
  assert.ok(row.form.trim().length > 0, `${label}: form must be non-empty — help prints it`);
};

test("VERB_POSITIONALS is set-equal to the dispatch table", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  assert.ok(VERB_POSITIONALS && typeof VERB_POSITIONALS === "object",
    "constants.mjs must export VERB_POSITIONALS");
  const dispatched = dispatchedVerbs();
  assert.ok(dispatched.size >= 30, `the dispatch-table reader yielded only ${dispatched.size} verbs`);
  const declared = new Set(Object.keys(VERB_POSITIONALS));
  assert.deepEqual([...dispatched].filter(v => !declared.has(v)).sort(), [],
    "a dispatched verb declares no positional arity — the check cannot bound what it has not been told");
  assert.deepEqual([...declared].filter(v => !dispatched.has(v)).sort(), [],
    "VERB_POSITIONALS declares a verb the engine does not dispatch");
});

test("every VERB_POSITIONALS row has a valid arity, a form, and boolean markers", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  for (const [verb, row] of Object.entries(VERB_POSITIONALS)) {
    validArity(row, verb);
    assert.equal(typeof row.idFirst, "boolean", `${verb}: idFirst must be a boolean`);
    assert.equal(typeof row.freeText, "boolean", `${verb}: freeText must be a boolean`);
  }
});

test("release carries two forms keyed by its first positional", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  const rel = VERB_POSITIONALS.release;
  assert.equal(rel.min, 1);
  assert.equal(rel.max, 1, "`release <id>` reads exactly one positional");
  assert.ok(rel.byFirst && rel.byFirst.show, "the `show` read form is declared as its own branch");
  validArity(rel.byFirst.show, "release show");
  assert.equal(rel.byFirst.show.max, 2, "`release show [<id>]` reads the keyword and at most one id");
  assert.match(rel.byFirst.show.form, /^show /);
  const others = Object.entries(VERB_POSITIONALS).filter(([v, r]) => v !== "release" && r.byFirst);
  assert.deepEqual(others, [], "release is the one verb whose surface branches on a positional");
});

test("freeText is carried by exactly triage, suggest-lane, log-detour and honcho-memory", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  const free = Object.entries(VERB_POSITIONALS).filter(([, r]) => r.freeText).map(([v]) => v).sort();
  assert.deepEqual(free, ["honcho-memory", "log-detour", "suggest-lane", "triage"]);
});

// ═══════════════ 1.2 — --platform on init and the five hook verbs ═══════════════

const HOOK_VERBS = ["brief", "snapshot", "commit-nudge", "gate-guard", "lesson-advice"];

test("init with an unknown platform creates nothing", () => {
  const cwd = gitRepoWithoutPm();
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# mine\n");
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules\n");
  const before = snap(cwd, [".gitignore"]);
  const r = engine(["init", "--platform", "bogus"], { cwd });
  assert.notEqual(r.status, 0, "an unknown platform must be refused");
  assert.match(r.stderr, /--platform/);
  assert.match(r.stderr, /claude-code\|hermes\|codex/, "the refusal names the known platforms");
  assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false,
    "the refusal must precede init's first write — state.json's existence ends pm's dormancy");
  assert.equal(fs.existsSync(path.join(cwd, "PROJECT.md")), false);
  assert.deepEqual(snap(cwd, [".gitignore"]), before, "CLAUDE.md and .gitignore are untouched");
});

test("init with a valueless platform is refused before it creates anything", () => {
  const cwd = gitRepoWithoutPm();
  const before = snap(cwd, [".gitignore"]);
  const r = engine(["init", "--platform"], { cwd });
  assert.notEqual(r.status, 0, "a valueless --platform must not fall back to the default");
  assert.match(r.stderr, /--platform requires/);
  assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false);
  assert.deepEqual(snap(cwd, [".gitignore"]), before);
});

test("A hook verb refuses an unknown platform", () => {
  const cwd = initialized();
  const before = snap(cwd);
  for (const verb of HOOK_VERBS) {
    const r = engine([verb, "--platform", "nope"], { cwd, input: "{}" });
    assert.notEqual(r.status, 0, `${verb} --platform nope must be refused`);
    assert.match(r.stderr, /--platform must be one of claude-code\|hermes\|codex/,
      `${verb}'s refusal names --platform and the known platforms`);
    assert.doesNotMatch(r.stdout, /hookSpecificOutput/, `${verb} must print no hook output`);
    assert.deepEqual(snap(cwd), before, `${verb}'s refusal must write nothing`);
  }
});

test("A hook verb's help names the flag its hook passes", () => {
  const cwd = initialized();
  for (const verb of HOOK_VERBS) {
    const out = run([verb, "--help"], { cwd });
    assert.match(out, /--platform/, `${verb} --help must name --platform — hooks.json passes it`);
    assert.doesNotMatch(out, /takes no flags/, `${verb} --help must not claim the verb takes no flags`);
  }
});

test("the hook marker on VERB_EFFECTS is exactly the verbs hooks/hooks.json invokes", async () => {
  const { VERB_EFFECTS } = await import(new URL("../lib/verb-effects.mjs", import.meta.url).href);
  const marked = Object.entries(VERB_EFFECTS).filter(([, e]) => e.hook === true).map(([v]) => v).sort();
  assert.deepEqual(marked, [...hookVerbsInConfig()].sort());
  assert.deepEqual(marked, [...HOOK_VERBS].sort());
});

// ═══════════════ 1.3 — --force is one argvLevel row, derived from VERB_EFFECTS ═══════════════

test("--force is accepted by exactly the mutating verbs, and the argvLevel rows are exactly force", async () => {
  const { cliFlagsFor, VERB_FLAGS, EPIC_FLAGS } = await import(CONSTANTS);
  const { VERB_EFFECTS } = await import(new URL("../lib/verb-effects.mjs", import.meta.url).href);
  const wrong = [];
  for (const [verb, e] of Object.entries(VERB_EFFECTS)) {
    const has = cliFlagsFor(verb).includes("force");
    if (e.effect === "mutates" && !has) wrong.push(`${verb} mutates and does not accept --force`);
    if (e.effect !== "mutates" && has) wrong.push(`${verb} is ${e.effect} and accepts --force`);
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
  assert.deepEqual([...EPIC_FLAGS, ...VERB_FLAGS].filter(r => r.argvLevel).map(r => r.flag), ["force"],
    "force is the one argv-level flag, declared as ONE row — never a parallel list");
});

test("A mutating verb's help names --force", () => {
  const cwd = initialized();
  assert.match(run(["add-epic", "--help"], { cwd }), /--force/);
});

test("claim and unclaim are not refused for carrying --force", () => {
  const cwd = initialized();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const c = engine(["claim", "e1", "--session", "s", "--force"], { cwd });
  assert.doesNotMatch(c.stderr, /unknown flag/, "claim must not refuse --force as an undeclared flag");
  assert.equal(c.status, 0, c.stderr);
  const u = engine(["unclaim", "e1", "--session", "s", "--force"], { cwd });
  assert.doesNotMatch(u.stderr, /unknown flag/, "unclaim must not refuse --force as an undeclared flag");
  assert.equal(u.status, 0, u.stderr);
});

// ═══════════════ 2.1 — help tokens: the pre-dispatch check's first decision ═══════════════

const ARGV_SURFACE = new URL("../lib/argv-surface.mjs", import.meta.url).href;
const line = (...tokens) => ["node", "conductor.mjs", ...tokens];

test("checkCommandLine: a help token is recognised before it is classified as a flag", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  assert.equal(checkCommandLine("remove-epic", line("remove-epic", "e2", "--help"), { initialized: true }).kind, "help");
  assert.equal(checkCommandLine("set-active", line("set-active", "e2", "-h"), { initialized: true }).kind, "help");
  assert.equal(checkCommandLine("update-epic", line("update-epic", "--help"), { initialized: true }).kind, "help");
});

test("checkCommandLine: a value-bearing declared flag consumes a non-flag-shaped next token, so -h there is its value", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const v = checkCommandLine("add-epic", line("add-epic", "--id", "h1", "--title", "-h", "--lane", "claude-code"), { initialized: true });
  assert.equal(v.kind, "ok", "`-h` after --title is the title, not a help request");
});

test("checkCommandLine: --help directly after a value-bearing flag that took no value is refused, naming both", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const v = checkCommandLine("add-epic", line("add-epic", "--id", "h1", "--title", "--help", "--lane", "claude-code"), { initialized: true });
  assert.equal(v.kind, "refuse");
  assert.match(v.message, /--title/);
  assert.match(v.message, /'--help'/);
  assert.match(v.message, /--title=--help/, "the = form is the escape, as valuelessFlagError() says");
});

test("checkCommandLine: a valueless flag never consumes the next token", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  assert.equal(checkCommandLine("remove-epic", line("remove-epic", "p", "--cascade", "-h"), { initialized: true }).kind, "help",
    "`-h` after a valueless flag is in a non-value position");
});

test("checkCommandLine: a --leading token that is not flag-shaped is a positional on a free-text verb", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const v = checkCommandLine("triage", line("triage", "--story <n> is 1-indexed"), { initialized: true });
  assert.equal(v.kind, "ok");
  assert.deepEqual(v.positionals, ["--story <n> is 1-indexed"]);
});

test("argv-surface.mjs imports constants.mjs and verb-effects.mjs only", () => {
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "argv-surface.mjs"), "utf8");
  const imports = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map(m => m[1]).sort();
  assert.deepEqual(imports, ["./constants.mjs", "./verb-effects.mjs"],
    "the pre-dispatch path must pull in no verb module");
});

test("A trailing help token does not remove an epic", () => {
  const cwd = initialized();
  run(["add-epic", "--id", "e2", "--lane", "claude-code"], { cwd });
  const before = snap(cwd);
  const r = engine(["remove-epic", "e2", "--help"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /remove-epic/, "it prints remove-epic's help");
  assert.doesNotMatch(r.stderr, /removed/);
  assert.deepEqual(snap(cwd), before, "e2 is still in state.json and nothing else moved");
});

test("A trailing help token does not append to the detour log", () => {
  const cwd = initialized();
  run(["log-detour", "first"], { cwd });
  const before = snap(cwd);
  const r = engine(["log-detour", "x", "--help"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /log-detour/);
  assert.deepEqual(snap(cwd), before, "detours.log is byte-identical");
});

test("A help token does not disarm the gate guard", () => {
  const cwd = initialized();
  run(["set-gate-guard", "on"], { cwd });
  const before = snap(cwd);
  const r = engine(["set-gate-guard", "off", "--help"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /set-gate-guard/);
  assert.deepEqual(snap(cwd), before);
  assert.equal(JSON.parse(before[".conductor/state.json"]).gateGuard, true, "the fixture armed the guard");
});

test("A short help token after a positional does not move the active pointer", () => {
  const cwd = initialized();
  run(["add-epic", "--id", "e2", "--lane", "claude-code"], { cwd });
  const before = snap(cwd);
  const r = engine(["set-active", "e2", "-h"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /set-active/);
  assert.deepEqual(snap(cwd), before);
  assert.equal(JSON.parse(before[".conductor/state.json"]).active, null);
});

test("REGRESSION GUARD: A help token in a value position is still refused", () => {
  const cwd = initialized();
  const before = snap(cwd);
  const r = engine(["add-epic", "--id", "h1", "--title", "--help", "--lane", "claude-code"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--title/);
  assert.match(r.stderr, /--help/);
  assert.deepEqual(snap(cwd), before, "no epic is created");
});

test("REGRESSION GUARD: A help token first after the verb is still that verb's help", () => {
  const cwd = initialized();
  const r = engine(["update-epic", "--help"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /update-epic/);
  assert.match(r.stdout, /--outcome/);
});

test("REGRESSION GUARD: A hook verb's help still works without pm", () => {
  for (const verb of ["brief", "gate-guard"]) {
    const cwd = gitRepoWithoutPm();
    const r = engine([verb, "--help"], { cwd, input: "{}" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(verb));
    assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false, `${verb} --help created .conductor/`);
  }
});

// ═══════════════ 2.2 — undeclared flags on every dispatched verb ═══════════════

/** Every file under `dir` by relative path and content — the whole tree, so "writes nothing" covers
 *  state.json's lock files, the render stamp, the rules file and .gitignore without a list here. */
function treeSnapshot(dir) {
  const out = {};
  const walk = (p, rel) => {
    for (const name of fs.readdirSync(p).sort()) {
      if (name === ".git") continue;
      const full = path.join(p, name);
      if (fs.lstatSync(full).isDirectory()) walk(full, `${rel}${name}/`);
      else out[`${rel}${name}`] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

const PUSH = ["push-detour", "e1", "--detour", "other", "--reason", "blocked", "--reconcile"];

/** The base fixture every baseline starts from: three epics, an external id, and an openspec change
 *  carrying two spec files (so record-cross-spec-review has a spec set to hash). Built ONCE per
 *  distinct list of pre-steps and copied per case, timestamps preserved so verify-state sees no drift. */
const templates = new Map();
function fixture(pre = []) {
  const key = JSON.stringify(pre);
  if (!templates.has(key)) {
    const cwd = tmpRepo();
    for (const cap of ["alpha", "beta"]) {
      const d = path.join(cwd, "openspec", "changes", "xs", "specs", cap);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "spec.md"), "# spec\n");
    }
    fs.writeFileSync(path.join(cwd, "openspec", "changes", "xs", "tasks.md"), "- [ ] one\n");
    fs.writeFileSync(path.join(cwd, "batch.json"),
      JSON.stringify({ epics: [{ id: "batched", title: "B", lane: "claude-code" }] }));
    run(["init"], { cwd });
    run(["add-epic", "--id", "e1", "--lane", "claude-code", "--priority", "P1"], { cwd });
    run(["add-epic", "--id", "other", "--lane", "claude-code", "--priority", "P1"], { cwd });
    run(["add-epic", "--id", "ext", "--lane", "claude-code", "--external-id", "7"], { cwd });
    for (const step of pre) run(step, { cwd });
    run(["render"], { cwd });
    templates.set(key, cwd);
  }
  const copy = tmpRepo();
  fs.cpSync(templates.get(key), copy, { recursive: true, preserveTimestamps: true });
  return copy;
}

/** A working invocation of EVERY dispatched verb. Completeness is asserted against the dispatch
 *  table below; each is first asserted to exit 0 on its own, so a broken fixture can never read as
 *  a refusal in the sweeps that append to it. Fixtures from the proposal's sweep.mjs. */
const SEED_AUTO_DETOUR_ROW = (cwd) => {
  // retract-detour's baseline needs an automatic row to retract. No verb writes one in a repository
  // without git, so the row is seeded as the file holds it; `abcdef1` resolves to nothing here, which
  // is the pruned-commit matching path.
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.appendFileSync(path.join(cwd, ".conductor", "detours.log"),
    "2026-09-01T00:00:00.000Z\tabcdef1\tAUTO-DETOUR\te1\tseeded\n");
};
const DISPATCH_BASELINE = {
  init: { args: ["init"] },
  render: { args: ["render"] },
  brief: { args: ["brief"] },
  snapshot: { args: ["snapshot"] },
  "commit-nudge": { args: ["commit-nudge"], input: "{}" },
  sync: { args: ["sync"] },
  "log-detour": { args: ["log-detour", "x"] },
  "retract-detour": { seed: SEED_AUTO_DETOUR_ROW, args: ["retract-detour", "abcdef1", "--reason", "x"] },
  "push-detour": { args: PUSH },
  "pop-detour": { pre: [PUSH], args: ["pop-detour"] },
  "drop-detour": { pre: [PUSH], args: ["drop-detour", "e1", "--reason", "not coming back"] },
  "honcho-memory": { args: ["honcho-memory", "push", "e1", "why"] },
  "add-epic": { args: ["add-epic", "--id", "n1", "--lane", "claude-code"] },
  "add-many": { args: ["add-many", "--from", "batch.json"] },
  "update-epic": { args: ["update-epic", "e1", "--priority", "P2"] },
  "remove-epic": { args: ["remove-epic", "other"] },
  reorder: { args: ["reorder", "other", "e1"] },
  "set-active": { args: ["set-active", "e1"] },
  "clear-active": { args: ["clear-active"] },
  "set-tracker": { args: ["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"] },
  "set-lane-routing": { args: ["set-lane-routing", "--add", "cache:claude-code"] },
  "suggest-lane": { args: ["suggest-lane", "fix typo"] },
  triage: { args: ["triage", "a caching bug"] },
  "set-autonomy": { args: ["set-autonomy", "e1", "--level", "off"] },
  "record-reconcile": { pre: [PUSH, ["pop-detour"]], args: ["record-reconcile", "e1", "--detour", "other", "--verdict", "valid"] },
  "record-gate-review": { args: ["record-gate-review", "e1", "--gate", "2", "--verdict", "fail"] },
  "record-cross-spec-review": { pre: [["release", "r1", "--intent", "x", "--member", "xs"]],
    args: ["record-cross-spec-review", "r1", "--verdict", "pass", "--reviewer", "me"] },
  "record-tracker-refresh": { args: ["record-tracker-refresh", "ext", "--verdict", "unchanged", "--external-updated-at", "2026-08-01T00:00:00.000Z"] },
  "set-review-mode": { args: ["set-review-mode", "--mode", "standard"] },
  release: { args: ["release", "r1", "--intent", "x"] },
  "set-gate-guard": { args: ["set-gate-guard", "on"] },
  "gate-guard": { args: ["gate-guard"], input: "{}" },
  "lesson-advice": { args: ["lesson-advice"], input: "{}" },
  "plan-hierarchy": { args: ["plan-hierarchy", "--parent", "e1"] },
  claim: { args: ["claim", "e1", "--session", "s"] },
  unclaim: { pre: [["claim", "e1", "--session", "s"]], args: ["unclaim", "e1", "--session", "s"] },
  owners: { args: ["owners"] },
  activity: { args: ["activity"] },
  "set-activity-log": { args: ["set-activity-log", "on"] },
  "purge-logs": { args: ["purge-logs", "--keep", "5"] },
  "verify-worktrees": { args: ["verify-worktrees"] },
  // Declared `expectsFailure` in VERB_EFFECTS: its job is to fail on drift. A copied fixture's
  // state.json mtime is not guaranteed to survive the copy to the precision the render stamp
  // compares, so the copy is re-rendered first (`local`) and it takes its own non-drift exit, 0.
  "verify-state": { local: [["render"]], args: ["verify-state"] },
  "verify-specs": { args: ["verify-specs"] },
  integrity: { args: ["integrity"] },
  changesets: { args: ["changesets"] },
  "recover-created-at": { args: ["recover-created-at"] },
  "unconsidered-outcomes": { args: ["unconsidered-outcomes"] },
  upgrade: { args: ["upgrade"] },
  changelog: { args: ["changelog", "--since", "0.0.1"] },
  rules: { args: ["rules"] },
  "write-rules": { args: ["write-rules"] },
  "rules-target": { args: ["rules-target"] },
};

test("DISPATCH_BASELINE covers exactly the dispatch table", () => {
  const dispatched = dispatchedVerbs();
  const covered = new Set(Object.keys(DISPATCH_BASELINE));
  assert.deepEqual([...dispatched].filter(v => !covered.has(v)).sort(), [],
    "a dispatched verb has no working invocation here, so no sweep below reaches it");
  assert.deepEqual([...covered].filter(v => !dispatched.has(v)).sort(), []);
});

test("every DISPATCH_BASELINE invocation exits 0 on its own", () => {
  const failed = [];
  for (const [verb, b] of Object.entries(DISPATCH_BASELINE)) {
    const cwd = fixture(b.pre); if (b.seed) b.seed(cwd);
    for (const step of b.local || []) run(step, { cwd });
    const r = engine(b.args, { cwd, input: b.input || "" });
    if (r.status !== 0) failed.push(`${verb} exited ${r.status}: ${r.stderr.trim().split("\n").slice(-2).join(" | ")}`);
  }
  assert.deepEqual(failed, [], failed.join("\n"));
});

test("Every dispatched verb refuses an undeclared flag and writes nothing", () => {
  const wrong = [];
  for (const [verb, b] of Object.entries(DISPATCH_BASELINE)) {
    const cwd = fixture(b.pre); if (b.seed) b.seed(cwd);
    for (const step of b.local || []) run(step, { cwd });
    const before = treeSnapshot(cwd);
    const r = engine([...b.args, "--zzz-undeclared"], { cwd, input: b.input || "" });
    if (r.status === 0) wrong.push(`${verb}: exited 0`);
    if (!new RegExp(`unknown flag --zzz-undeclared for ${verb}\\b`).test(r.stderr)) {
      wrong.push(`${verb}: the refusal does not name --zzz-undeclared and the verb: ${r.stderr.trim().split("\n")[0]}`);
    }
    try { assert.deepEqual(treeSnapshot(cwd), before); } catch { wrong.push(`${verb}: a file changed`); }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("A help token after every verb's working invocation prints help and writes nothing", () => {
  // The population the 0.41.0 narrowing of #187 stopped protecting: 14 verbs performed their write
  // on a trailing --help. docs/lessons/narrowing-a-guard-retests-what-it-protected.md.
  const wrong = [];
  for (const [verb, b] of Object.entries(DISPATCH_BASELINE)) {
    for (const token of ["--help", "-h"]) {
      const cwd = fixture(b.pre); if (b.seed) b.seed(cwd);
      for (const step of b.local || []) run(step, { cwd });
      const before = treeSnapshot(cwd);
      const r = engine([...b.args, token], { cwd, input: b.input || "" });
      if (r.status !== 0) wrong.push(`${verb} ${token}: exited ${r.status}: ${r.stderr.trim().split("\n")[0]}`);
      try { assert.deepEqual(treeSnapshot(cwd), before); } catch { wrong.push(`${verb} ${token}: a file changed`); }
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("A typo'd flag on the reconcile write-back records nothing", () => {
  const cwd = fixture([PUSH, ["pop-detour"]]);
  const before = snap(cwd);
  const r = engine(["record-reconcile", "e1", "--detour", "other", "--verdict", "invalidated", "--amendmnts", "a;b"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --amendmnts for record-reconcile/);
  assert.deepEqual(snap(cwd), before, "no reconcile verdict is recorded on the link");
});

test("A typo'd autonomy flag writes no autonomy block", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["set-autonomy", "e1", "--levle", "autonomous"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --levle for set-autonomy/);
  assert.deepEqual(snap(cwd), before);
  assert.equal(JSON.parse(before[".conductor/state.json"]).epics.find(e => e.id === "e1").autonomy, undefined);
});

test("A read-only verb refuses an undeclared flag", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["unconsidered-outcomes", "--bogus"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --bogus for unconsidered-outcomes/);
  assert.equal(r.stdout, "", "it prints no report");
  assert.deepEqual(snap(cwd), before);
});

test("A read-only verb refuses --force", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["integrity", "--force"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --force for integrity/);
  assert.equal(r.stdout, "", "it prints no audit");
  assert.deepEqual(snap(cwd), before);
});

test("A batch key is not a command-line flag", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["add-many", "--from", "batch.json", "--external-id", "X"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --external-id for add-many/);
  assert.deepEqual(snap(cwd), before, "no epic from the batch is created");
});

test("An id given as a flag is diagnosed as the positional", () => {
  const cwd = fixture();
  run(["add-epic", "--id", "e2", "--lane", "claude-code"], { cwd });
  const before = snap(cwd);
  const r = engine(["remove-epic", "--id", "e2"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--id/);
  assert.ok(r.stderr.includes("remove-epic <id>"), `the message shows the positional form: ${r.stderr}`);
  assert.ok(r.stderr.includes("remove-epic e2"), "and rewrites the line the caller meant");
  assert.deepEqual(snap(cwd), before, "e2 is still in state.json");
});

test("REGRESSION GUARD: A hook verb stays dormant in a repository without pm", () => {
  for (const verb of HOOK_VERBS) {
    const cwd = gitRepoWithoutPm();
    const r = engine([verb, "--bogus"], { cwd, input: "{}" });
    assert.equal(r.status, 0, `${verb} --bogus must stay silent without pm: ${r.stderr}`);
    assert.equal(r.stdout, "", `${verb} printed output without pm`);
    assert.equal(r.stderr, "", `${verb} printed an error into a project that never ran init`);
    assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false);
  }
});

test("REGRESSION GUARD: a refused gate-guard hook line drains a large payload (no EPIPE)", async () => {
  // ASYNC spawn and stdin.end(), which is how Claude Code feeds a hook — never spawnSync with
  // `input`. On macOS spawnSync with a large `input` hangs about 1 run in 100 even for a minimal
  // script containing no pm code (measured: it hung the pre-commit suite for 436 s once), while async
  // spawn plus stdin.end() hung 0 times in 2300. The old form tested the platform, not the drain.
  // The timeout turns a hang into a failure instead of a wedged suite.
  const cwd = fixture();
  const payload = JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x", content: "y".repeat(200 * 1024) } });
  assert.ok(Buffer.byteLength(payload) >= 128 * 1024);
  const r = await new Promise((resolve) => {
    const child = spawn("node", [ENGINE, "gate-guard", "--bogus"], {
      cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, PM_QUIET_ENGINE_BANNER: "1" },
    });
    let stderr = "";
    let writeError = null;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdout.resume();
    child.stdin.on("error", (e) => { writeError = e; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, stderr, writeError }); });
    child.stdin.end(payload);
  });
  assert.equal(r.signal, null, "the hook did not finish within 30 s");
  assert.equal(r.writeError, null, `the writer saw ${r.writeError && r.writeError.code}`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag --bogus for gate-guard/);
});

// ═══════════════ 2.3 — --force reaches the verbs that carried their own allowlists ═══════════════

test("--force is not refused on a mutating verb that validates its own flags", () => {
  // Not refused AS CARRYING AN UNDECLARED FLAG — what the forced write then does is
  // state-write-guard's to define, and nothing here asserts it.
  const cases = [
    [[], ["add-epic", "--id", "f1", "--lane", "claude-code", "--force"]],
    [[], ["update-epic", "e1", "--title", "x", "--force"]],
    [[], ["release", "r1", "--intent", "x", "--force"]],
    [[], ["record-gate-review", "e1", "--gate", "2", "--verdict", "fail", "--force"]],
    [[["release", "r1", "--intent", "x", "--member", "xs"]],
      ["record-cross-spec-review", "r1", "--verdict", "pass", "--reviewer", "me", "--force"]],
  ];
  const wrong = [];
  for (const [pre, args] of cases) {
    const cwd = fixture(pre);
    const r = engine(args, { cwd });
    if (/unknown flag/.test(r.stderr)) wrong.push(`${args[0]}: ${r.stderr.trim().split("\n")[0]}`);
    else if (r.status !== 0) wrong.push(`${args[0]} exited ${r.status}: ${r.stderr.trim().split("\n").pop()}`);
    if (args[0] === "add-epic" && r.status === 0) {
      assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).epics.some(e => e.id === "f1"),
        "f1 is in state.json");
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

// ═══════════════ 2.4 — surplus positionals, and the canonical argv every verb reads ═══════════════

const lastDetourText = (cwd) => {
  const rows = fs.readFileSync(path.join(cwd, ".conductor", "detours.log"), "utf8").trim().split("\n");
  return rows[rows.length - 1].split("\t").pop();
};

/** How many positionals each baseline carries, counted by hand rather than by the classifier under
 *  test: the fill below depends on it. */
const POSITIONAL_COUNTS = {
  "log-detour": 1, "retract-detour": 1, "push-detour": 1, "drop-detour": 1, "honcho-memory": 3, "update-epic": 1, "remove-epic": 1, reorder: 2,
  "set-active": 1, "suggest-lane": 1, triage: 1, "set-autonomy": 1, "record-reconcile": 1,
  "record-gate-review": 1, "record-cross-spec-review": 1, "record-tracker-refresh": 1, release: 1,
  "set-gate-guard": 1, claim: 1, unclaim: 1, "set-activity-log": 1,
};
for (const verb of Object.keys(DISPATCH_BASELINE)) if (!(verb in POSITIONAL_COUNTS)) POSITIONAL_COUNTS[verb] = 0;

test("Every verb with a bounded arity refuses a stray positional and writes nothing", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  const wrong = [];
  let checked = 0;
  for (const [verb, b] of Object.entries(DISPATCH_BASELINE)) {
    if (VERB_POSITIONALS[verb].max === Infinity) continue;
    checked++;
    const cwd = fixture(b.pre); if (b.seed) b.seed(cwd);
    for (const step of b.local || []) run(step, { cwd });
    // A baseline may use fewer positionals than the maximum (`pop-detour` takes an optional one), so
    // fill up to the maximum first: `zzzstray` is then the first token beyond it on every verb.
    const count = POSITIONAL_COUNTS[verb];
    const fill = Array.from({ length: Math.max(0, VERB_POSITIONALS[verb].max - count) }, () => "zzzfill");
    const before = treeSnapshot(cwd);
    const r = engine([...b.args, ...fill, "zzzstray"], { cwd, input: b.input || "" });
    if (r.status === 0) wrong.push(`${verb}: exited 0`);
    if (!/'zzzstray' is an extra argument/.test(r.stderr)) {
      wrong.push(`${verb}: the refusal does not name zzzstray: ${r.stderr.trim().split("\n")[0]}`);
    }
    try { assert.deepEqual(treeSnapshot(cwd), before); } catch { wrong.push(`${verb}: a file changed`); }
  }
  assert.ok(checked >= 40, `only ${checked} verbs swept`);
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("An unquoted multi-word title is refused, not truncated", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["add-epic", "--id", "t1", "--lane", "claude-code", "--title", "My", "Title"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /'Title' is an extra argument/);
  assert.deepEqual(snap(cwd), before, "no epic t1 exists");
});

test("The same truncation is refused on update", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["update-epic", "e1", "--title", "My", "Title"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /'Title' is an extra argument/);
  assert.deepEqual(snap(cwd), before, "e1's title is unchanged");
});

test("A verb that reads one text positional refuses a second", () => {
  const cwd = fixture();
  const r = engine(["suggest-lane", "fix", "a", "typo"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /'a' is an extra argument/);
  assert.doesNotMatch(r.stdout, /"lane"/, "no routing for `fix` alone");
});

test("A value given to a valueless flag is refused by name", () => {
  const cwd = fixture();
  run(["add-epic", "--id", "p", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "kid", "--lane", "claude-code", "--parent", "p"], { cwd });
  const before = snap(cwd);
  const r = engine(["remove-epic", "p", "--cascade", "yes"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /'yes' is an extra argument/);
  assert.match(r.stderr, /--cascade takes no value/);
  assert.deepEqual(snap(cwd), before, "p and its child are still in state.json");
});

test("An inline value on a valueless flag is refused", () => {
  const cwd = fixture();
  run(["add-epic", "--id", "p", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "kid", "--lane", "claude-code", "--parent", "p"], { cwd });
  const before = snap(cwd);
  const r = engine(["remove-epic", "p", "--cascade=true"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--cascade takes no value/);
  assert.deepEqual(snap(cwd), before);
  const f = engine(["add-epic", "--id", "f1", "--lane", "claude-code", "--force=1"], { cwd });
  assert.notEqual(f.status, 0);
  assert.match(f.stderr, /--force takes no value/);
  assert.deepEqual(snap(cwd), before, "no epic f1");
});

test("A dash-leading token that is not a flag is refused where no free text is read", () => {
  const cwd = fixture();
  run(["add-epic", "--id", "e9", "--lane", "claude-code"], { cwd });
  run(["claim", "e9", "--session", "s"], { cwd });
  const before = treeSnapshot(cwd);
  const r = engine(["claim", "--repo", "--session", "s", "--Steal"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --Steal for claim/);
  assert.equal(fs.existsSync(path.join(cwd, ".conductor", "session-claim.json")), false, "no repository claim");
  const u = engine(["unclaim", "e9", "--session", "s", "--Steal"], { cwd });
  assert.notEqual(u.status, 0);
  assert.match(u.stderr, /unknown flag --Steal for unclaim/);
  assert.deepEqual(treeSnapshot(cwd), before, "the claim on e9 is untouched");
});

test("A refusal escapes the caller's control characters, so no echoed token starts a line of its own", () => {
  // Every pre-dispatch refusal quotes caller text back. A newline in that text must not let it print
  // a line the engine never wrote — a fabricated hint, or an invocation the reader would run. The
  // same invariant regressionRefusal() (update-epic.mjs) holds, with the same escaper.
  const cwd = fixture();
  run(["add-epic", "--id", "p", "--lane", "claude-code"], { cwd });
  const before = snap(cwd);
  const ESCAPED_NEWLINE = "\\" + "u000a";
  const FORGED = "  update-epic p --status archived --outcome delivered --no-deferrals";
  const HINT = "  --cascade takes no value.";
  const cases = [
    [["add-epic", "--id", "x", "--lane", "claude-code", `a\n${FORGED}`], FORGED, /is an extra argument/],
    [["add-epic", "--id", "x", "--title", "t", `b\n${HINT}`], HINT, /If '.*' belongs to --title's value/],
    [["claim", "--repo", "--session", "s", `--Steal\n${FORGED}`], FORGED, /unknown flag --Steal/],
    [["remove-epic", "p", `--cascade=1\n${FORGED}`], FORGED, /--cascade takes no value — /],
    [["remove-epic", "--id", `p\n${FORGED}`], FORGED, /takes its epic id POSITIONALLY/],
    [["add-epic", "--id", "x", "--lane", "claude-code", "--title", `--lane=a\n${FORGED}`], FORGED, /--title requires a value/],
  ];
  for (const [args, forged, cause] of cases) {
    const r = engine(args, { cwd });
    assert.notEqual(r.status, 0, `${args[0]} is refused`);
    assert.match(r.stderr, cause);
    assert.equal(r.stderr.split("\n").some(l => l.startsWith(forged)), false,
      `caller text printed a line of its own for ${args[0]}: ${r.stderr}`);
    assert.ok(r.stderr.includes(ESCAPED_NEWLINE), `the newline is shown escaped: ${r.stderr}`);
    assert.deepEqual(snap(cwd), before, "nothing was written");
  }
});

test("A verb that takes no positionals refuses one", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["set-review-mode", "--mode", "thorough", "extra"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /'extra' is an extra argument/);
  assert.deepEqual(snap(cwd), before, "the review mode is unchanged");
});

test("--force does not leak into a joined text", () => {
  const cwd = fixture();
  const r = engine(["log-detour", "fixed", "it", "--force"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lastDetourText(cwd), "fixed it");
  const h = engine(["honcho-memory", "push", "e1", "why", "--force"], { cwd });
  assert.equal(h.status, 0, h.stderr);
  assert.equal(h.stdout.trim(), "paused e1 for why");
});

test("--force before a positional does not displace it", () => {
  const cwd = fixture();
  run(["add-epic", "--id", "e2", "--lane", "claude-code"], { cwd });
  const r = engine(["set-active", "--force", "e2"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).active, "e2");
  run(["set-gate-guard", "on"], { cwd });
  const g = engine(["set-gate-guard", "--force", "off"], { cwd });
  assert.equal(g.status, 0, g.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).gateGuard, false);
});

test("checkCommandLine: a --leading token that is not flag-shaped is an undeclared flag on a verb without free text", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const v = checkCommandLine("claim", line("claim", "--repo", "--session", "s", "--Steal"), { initialized: true });
  assert.equal(v.kind, "refuse");
  assert.match(v.message, /unknown flag --Steal for claim/);
});

test("checkCommandLine: canonical argv puts positionals first, keeps flag order, and argv-level flags last", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const v = checkCommandLine("update-epic",
    line("update-epic", "--force", "--attribute-commit", "a", "e1", "--attribute-commit=b", "--title", "t"), { initialized: true });
  assert.equal(v.kind, "ok");
  assert.deepEqual(v.canonicalArgv,
    ["e1", "--attribute-commit", "a", "--attribute-commit=b", "--title", "t", "--force"]);
});

test("REGRESSION GUARD: A verb that joins its positionals still accepts many", () => {
  const cwd = fixture();
  const r = engine(["log-detour", "fixed", "the", "render", "stamp"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lastDetourText(cwd), "fixed the render stamp");
});

test("REGRESSION GUARD: A dash-leading text positional is still a positional", () => {
  const cwd = fixture();
  const r = engine(["triage", "--story <n> is 1-indexed"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ask, "--story <n> is 1-indexed");
});

// ═══════════════ 2.5 — pm's own hook configuration passes the check it ships with ═══════════════

/** Shell-split one hooks.json command line after substituting ${CLAUDE_PLUGIN_ROOT}. */
function hookArgv(command) {
  const s = command.split("${CLAUDE_PLUGIN_ROOT}").join(REPO);
  const out = []; let cur = null, q = null;
  for (const c of s) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === "\"" || c === "'") { q = c; cur = cur ?? ""; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? "") + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

test("REGRESSION GUARD: A hook verb accepts its hook configuration's command line", () => {
  const cwd = fixture();
  const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
  const wrong = [];
  for (const command of hookCommandLines()) {
    const [bin, script, ...args] = hookArgv(command);
    assert.equal(bin, "node", `hook line does not run node: ${command}`);
    assert.equal(script, ENGINE, `hook line does not run this engine: ${command}`);
    const r = engine(args, { cwd, input: payload });
    if (r.status !== 0 || /unknown flag|extra argument|takes no value|--platform/.test(r.stderr)) {
      wrong.push(`${args.join(" ")} -> exit ${r.status}: ${r.stderr.trim().split("\n")[0]}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("REGRESSION GUARD: every flag a hook line passes is declared, and every hook verb's line passes --platform", async () => {
  const { cliFlagsFor } = await import(CONSTANTS);
  const { VERB_EFFECTS } = await import(new URL("../lib/verb-effects.mjs", import.meta.url).href);
  const passesPlatform = new Set();
  for (const command of hookCommandLines()) {
    const [, , verb, ...rest] = hookArgv(command);
    for (const t of rest.filter(x => x.startsWith("--"))) {
      const name = t.slice(2).split("=")[0];
      assert.ok(cliFlagsFor(verb).includes(name), `hooks.json passes --${name} to ${verb}, which does not declare it`);
      if (name === "platform") passesPlatform.add(verb);
    }
  }
  for (const [verb, e] of Object.entries(VERB_EFFECTS)) {
    if (e.hook === true) assert.ok(passesPlatform.has(verb), `hook verb ${verb}'s hook line does not pass --platform`);
  }
});

// ═══════════════ 3.1 — bare set-lane-routing writes nothing ═══════════════

test("A bare set-lane-routing leaves the record unchanged", () => {
  const cwd = fixture();
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).laneRouting, undefined,
    "the fixture has no lane routing");
  const before = treeSnapshot(cwd);
  const r = engine(["set-lane-routing"], { cwd });
  assert.notEqual(r.status, 0, "an invocation with no operation must not report success");
  assert.match(r.stderr, /--add/);
  assert.match(r.stderr, /--remove/);
  assert.match(r.stderr, /--clear/);
  assert.deepEqual(treeSnapshot(cwd), before, "state.json is byte-identical — no empty overrides block");
});

// ═══════════════ 3.2 — update-epic's disposition flags join the not-archiving refusal ═══════════════

const epicOf = (cwd, id) =>
  JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).epics.find(e => e.id === id);

test("An outcome without an archive is refused by name", () => {
  const cwd = fixture();
  const before = treeSnapshot(cwd);
  const r = engine(["update-epic", "e1", "--outcome", "killed", "--reason", "no"], { cwd });
  assert.notEqual(r.status, 0, "the flags are dropped otherwise, behind a false 'nothing changed'");
  assert.match(r.stderr, /--outcome/);
  assert.match(r.stderr, /--reason/);
  assert.match(r.stderr, /recorded only when an epic is ARCHIVED/);
  assert.deepEqual(treeSnapshot(cwd), before);
  const e1 = epicOf(cwd, "e1");
  assert.notEqual(e1.status, "archived");
  assert.ok(!e1.disposition, "e1 carries no disposition");
});

test("A handoff target without an archive is refused by name", () => {
  const cwd = fixture();
  const before = snap(cwd);
  const r = engine(["update-epic", "e1", "--carried-to", "other"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--carried-to/);
  assert.deepEqual(snap(cwd), before, "state.json is byte-identical");
});

test("REGRESSION GUARD: The disposition flags still record at the archive", () => {
  const cwd = fixture();
  const r = engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed", "--reason", "no", "--no-deferrals"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const e1 = epicOf(cwd, "e1");
  assert.equal(e1.status, "archived");
  assert.equal(e1.disposition.outcome, "killed");
  assert.equal(e1.disposition.reason, "no");
});

// ═══════════════ 3.3 — help reads the declarations the check enforces ═══════════════

test("remove-epic --help names its positional form on the first line", () => {
  const cwd = initialized();
  const first = run(["remove-epic", "--help"], { cwd }).split("\n")[0];
  assert.match(first, /remove-epic <id>/, `the first line must show the positional form: ${first}`);
});

test("set-active --help says it has no flags of its own before listing --force", () => {
  const cwd = initialized();
  const out = run(["set-active", "--help"], { cwd });
  const own = out.search(/no flags of its own/);
  const force = out.indexOf("--force");
  assert.notEqual(own, -1, `set-active --help must say it has no flags of its own:\n${out}`);
  assert.notEqual(force, -1, "…and still list the argv-level flag it accepts");
  assert.ok(own < force, "the statement comes before the argv-level flag");
  assert.doesNotMatch(out, /takes no flags/, "it accepts --force, so it does not take NO flags");
});

test("REGRESSION GUARD: A read-only verb's help does not offer --force", () => {
  const cwd = initialized();
  assert.doesNotMatch(run(["integrity", "--help"], { cwd }), /--force/);
});

// ═══════════════ Gate 2 follow-up — an argv-level flag is never a positional ═══════════════

test("An argv-level flag with no positional is not read as one: set-gate-guard --force and set-activity-log --force behave as their bare forms", () => {
  // Gate 2: the canonical rewrite puts `--force` at process.argv[3] when the line carries no
  // positional, and a verb reading argv[3] took it as its positional — `set-gate-guard --force`
  // printed usage where bare `set-gate-guard` READS the guard.
  const cwd = fixture();
  run(["set-gate-guard", "on"], { cwd });
  for (const verb of ["set-gate-guard", "set-activity-log"]) {
    const before = snap(cwd);
    const bare = engine([verb], { cwd });
    const forced = engine([verb, "--force"], { cwd });
    assert.deepEqual(
      { status: forced.status, stdout: forced.stdout, stderr: forced.stderr },
      { status: bare.status, stdout: bare.stdout, stderr: bare.stderr },
      `${verb} --force must behave exactly as bare ${verb}`);
    assert.deepEqual(snap(cwd), before, `${verb} --force writes nothing the bare form does not`);
  }
});

test("An undeclared flag on a free-text verb is refused with the quote-the-whole-value hint", async () => {
  // `log-detour fixed --no-verify usage` was accepted as text before this change and is refused now;
  // the refusal must tell the caller the fix, as the surplus-positional refusal already does.
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const lines = [
    ["log-detour", "fixed", "--no-verify", "usage"],
    ["honcho-memory", "push", "e1", "skip", "--no-verify"],
    ["triage", "--no-verify", "flag"],
    ["suggest-lane", "a", "--no-verify"],
  ];
  for (const tokens of lines) {
    const v = checkCommandLine(tokens[0], line(...tokens), { initialized: true });
    assert.equal(v.kind, "refuse", tokens.join(" "));
    assert.match(v.message, /unknown flag --no-verify for /);
    assert.match(v.message, /'--no-verify'.*quote the whole value/, `${tokens[0]} must carry the hint:\n${v.message}`);
    assert.match(v.message, /Nothing was written\.$/);
  }
  const bounded = checkCommandLine("set-active", line("set-active", "e1", "--no-verify"), { initialized: true });
  assert.equal(bounded.kind, "refuse");
  assert.doesNotMatch(bounded.message, /quote the whole value/, "a verb without free text gets no quoting hint");
});

// ═══════════════ emitted-commands-run-as-written 1.2 — every refusal carries a class ═══════════════
// The emitted-invocation sweep compares a doc marker's declared class with the engine's refusal.
// Refusal MESSAGES are prose other changes edit; the class is the stable value a test compares.

test("checkCommandLine: every refusal kind carries its class", async () => {
  const { checkCommandLine } = await import(ARGV_SURFACE);
  const cases = [
    ["unknown-flag", line("activity", "--bogus")],
    ["extra-positional", line("set-activity-log", "on", "extra")],
    ["id-as-flag", line("remove-epic", "--id", "e2")],
    ["value-on-valueless-flag", line("remove-epic", "e2", "--cascade=true")],
    ["help-in-value-position", line("add-epic", "--id", "h1", "--title", "--help")],
  ];
  for (const [cls, argv] of cases) {
    const r = checkCommandLine(argv[2], argv, { initialized: true });
    assert.equal(r.kind, "refuse", `${argv.slice(2).join(" ")} is refused`);
    assert.equal(r.class, cls, `${argv.slice(2).join(" ")} is refused with class ${cls}; got ${r.class}`);
  }
});
