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
import { execFileSync, spawnSync } from "node:child_process";
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
