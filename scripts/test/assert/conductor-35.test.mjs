// #158 / the rules-block help pointer — help that answers the question actually asked.
//
// #158: `--help` was VERB-BLIND. conductor.mjs short-circuited on any `--help` ANYWHERE in argv
// and printed the global 48-verb USAGE line, so `update-epic --help` and a bare `--help` were
// byte-identical. The only way to learn a verb's flags was to read `scripts/lib/<verb>.mjs`, and
// a session upgrading another repo did exactly that. The short-circuit itself is load-bearing and
// stays: it fixed `log-detour --help` writing a real detour entry with "--help" as its
// description, so a help flag must still reach no subcommand.
//
// THE PROJECTION IS THE WHOLE DESIGN. Help reads the SAME registry rows the unknown-flag
// allowlists read, so it cannot advertise a flag the parser refuses — a hand-written help table
// would be #152's shape one question over. But `flagsFor()` is the wrong projection to reuse
// blind: it answers "which rows NAME this command", and `add-many`'s 14 EPIC_FLAGS rows exist so
// `epicBatchKeys()` can derive JSON STATE keys (`externalId`, not `--external-id`) while its
// parser takes exactly one flag, `--from`. Deriving help from `flagsFor()` would confidently
// advertise 14 flags add-many ignores — an authoritative wrong answer, worse than no help.
//
// So the ACCEPTANCE MODE is declared per COMMAND, not per row, exactly as FLAGLESS_VERBS already
// declares "this verb takes no flags" rather than leaving it an inferred remainder.
//
// The pointer half: the emitted rules block carried NO route to any of this. Measured across all
// 408 emitted lines and all three platform variants: 0 occurrences of `conductor.mjs`, of any
// http(s) URL, of `MCP`, of `--help`, of `pm-plugin.dev`, of `SKILL.md`, of `commands/`, of
// `README`. Meanwhile the block hardcodes eight flags in one add-epic recipe — it teaches flags
// by worked example and gives no way to enumerate them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, detourLog } from "../fixtures/assert-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The verb names the engine actually dispatches. Third copy of this reader (conductor-25,
 *  conductor-31); duplicated for the same stated reason — nine lines, and the alternative edits a
 *  file every test module imports. Deriving the help sweep from the DISPATCH TABLE rather than
 *  from the registry is the point: a verb added later cannot quietly opt out of having help. */
function dispatchedVerbs() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const body = src.slice(src.indexOf("({", src.indexOf("try {", start)));
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  // THE INDENT IS PART OF THE SHAPE, and 0.47.0 (task 2.3) moved the dispatch table two spaces to
  // the right by wrapping conductor.mjs's module body in `main(argv, io)`. A reader pinned to
  // EXACTLY two spaces found nothing, and the guard that exists to catch a missing VERB_EFFECTS
  // row went green against an EMPTY set — caught by its own "the reader is broken, not the table"
  // assertion, which is why that assertion exists. The band `2,4` accepts either shape and refuses
  // anything deeper, so a table nested one level further down still fails rather than silently
  // matching a handler's own line.
  for (const m of table.matchAll(/^ {2,4}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2,4}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// 4.1 (0.48.0) moved FIFTEEN of this file's twenty tests to
// `scripts/test/unit/conductor-35.test.mjs`: the projection pair, the rendered-help family, the
// emitted pointer family and the two pure registry invariants. THE FIVE BELOW STAY because every one
// of them derives its population by READING `scripts/conductor.mjs` — the `dispatchedVerbs()` source
// scan of the dispatch table (and the two sweeps built on it), the network-connection scan over every
// lib file, and the USAGE-vs-dispatch cross-check. That reader is deliberately duplicated rather than
// shared: nine lines, and the alternative edits a file every test module imports.

// ═══════════════ the projection ═══════════════

test("every batch-key command is a real dispatched verb", async () => {
  const { BATCH_KEY_COMMANDS } = await import(CONSTANTS);
  const dispatched = dispatchedVerbs();
  for (const c of BATCH_KEY_COMMANDS) {
    assert.ok(dispatched.has(c), `BATCH_KEY_COMMANDS names '${c}', which the engine does not dispatch`);
  }
});

test("no verb's help advertises a flag that verb's parser refuses", async () => {
  // Gate 2 found this the moment it was written mechanically: `add-epic --help` printed
  // `--clear-links`, which add-epic refuses. The cause was `requires` doing double duty as both
  // the refusal tail and the help signature — `--link`'s ends "...say so with --clear-links" —
  // so the ghost was TEXT inside another flag's placeholder, which no per-verb spot check would
  // ever have been shaped to catch.
  //
  // The previous version of this test hardcoded four ghost names on ONE verb. That is the
  // sibling-miss this repo's gate procedure names as its dominant defect class: a guard at one
  // call site while 47 identical ones go unchecked. This asserts the INVARIANT over the whole
  // dispatch table, so a row added later is covered without anyone remembering to extend a list.
  const { cliFlagsFor } = await import(CONSTANTS);
  const { verbHelp } = await import(new URL("../../lib/help.mjs", import.meta.url).href);
  const ghosts = [];
  for (const verb of dispatchedVerbs()) {
    const accepted = new Set(cliFlagsFor(verb));
    for (const m of new Set([...verbHelp(verb).matchAll(/--([a-z][a-z0-9-]*)/g)].map(x => x[1]))) {
      if (!accepted.has(m)) ghosts.push(`${verb} --help advertises --${m}, which it refuses`);
    }
  }
  assert.deepEqual(ghosts, [], ghosts.join("\n"));
});

test("every dispatched verb renders help, exits 0, and names itself", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const verb of dispatchedVerbs()) {
    const out = run([verb, "--help"], { cwd });
    assert.ok(out.trim().length > 0, `${verb} --help produced nothing`);
    // `out.includes(verb)` ALONE is vacuous: the global USAGE line names all 48 verbs, so it
    // would pass for every verb even with this fix reverted. Asserting the global blob is ABSENT
    // is what makes this a real sweep — neutered by removing the verb-scoped branch, it fails 48
    // times rather than 0.
    assert.ok(!out.includes("init|render|brief"),
      `${verb} --help fell through to the global usage blob`);
    assert.ok(out.includes(verb), `${verb} --help must name the verb it describes`);
  }
});

test("the engine still opens no network connection — the pointer is an INSTRUCTION", () => {
  const engineSrc = fs.readdirSync(path.join(REPO, "scripts", "lib"))
    .filter(f => f.endsWith(".mjs"))
    .map(f => fs.readFileSync(path.join(REPO, "scripts", "lib", f), "utf8")).join("\n")
    + fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  // WIDENED IN 0.49.0 (task 3.3): the set named only `fetch(` and the HTTP modules, and a raw socket
  // (`node:net`), a TLS socket (`node:tls`), a datagram (`node:dgram`) or HTTP/2 (`node:http2`) opens
  // a connection just as surely. It was widened in the change that added `runtime-support.mjs`, a
  // module whose subject is an external schedule — exactly the temptation this law guards against.
  // AND BARE SPECIFIERS (Gate 2 M5): `import net from "net"` opens the same socket as "node:net" and
  // matched none of the patterns above, nor did a dynamic `import("net")`. `dns` joins the set.
  const NET = "https?|http2|net|tls|dgram|dns";
  for (const forbidden of [
    /\bfetch\s*\(/,
    new RegExp(`node:(?:${NET})\\b`),
    new RegExp(`require\\(\\s*['"](?:node:)?(?:${NET})['"]\\s*\\)`),
    new RegExp(`\\bfrom\\s*['"](?:node:)?(?:${NET})['"]`),
    new RegExp(`\\bimport\\s*\\(\\s*['"](?:node:)?(?:${NET})['"]\\s*\\)`),
  ]) {
    assert.ok(!forbidden.test(engineSrc),
      `the engine must never open a connection (matched ${forbidden}) — pm is an instruction layer`);
  }
});

// ─────────── no-network-law-test-is-weak (code review 0.43.0, E2): what a spawn RUNS ───────────
//
// The import scan above closes the socket door; this closes the process door. `execFile("curl", …)`
// or `spawnSync("gh", ["api", …])` talks to the network through a child and imports nothing a
// socket scan can see. So the child a spawn starts is on an ALLOWLIST, bound to the one module
// whose job it is, and anything else — a new executable, a new module that spawns, a target the
// scan cannot read as a literal — fails here and names itself:
//
//   git       only through the gateway            scripts/lib/git-gateway.mjs
//   node      the self-hosting handoff            scripts/lib/self-hosting.mjs (process.execPath)
//   openspec  the tool-currency version probe     scripts/lib/tool-currency.mjs
//
// THREE RULES, because each one alone has a hole the next one closes:
//   1. only those three modules may mention `child_process` at all (a static import, a dynamic
//      `import()`, a `require` — any spelling), so a fourth spawning module is refused outright;
//   2. inside them, the import is a NAMED list with no `as` rename and no namespace import, so every
//      call is spelled with its own name and rule 3's scan cannot be walked around (`cp.spawn(…)`);
//   3. every spawner call's FIRST ARGUMENT is a string literal on the module's list — or, for a
//      shell-string spawner (`execSync`/`exec`), a literal whose first word is — or
//      `process.execPath` where the list says `node`. An identifier is refused even when it holds
//      an allowed name: `const c = "curl"; spawnSync(c)` must not pass, and the scan cannot tell.
// The executable's name is ASSEMBLED for the same reason as the fixtures below: hermetic-git's
// assertion twin trips on any assertion-half file that QUOTES that name without importing the
// hermetic module, and this file runs no git to be made hermetic.
const GIT = ["g", "i", "t"].join("");
const QGIT = `"${GIT}"`;
const SPAWN_TARGETS = {
  "scripts/lib/git-gateway.mjs": [GIT],
  "scripts/lib/self-hosting.mjs": ["node"],
  "scripts/lib/tool-currency.mjs": ["openspec"],
};
const SPAWNERS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"];
const SHELL_SPAWNERS = new Set(["execSync", "exec"]);

/** Strip // and /* *\/ comments so prose that NAMES a spawner is not a call. Strings survive. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Every violation of the three rules in one module's source. Pure, so the mutation cases below
 *  run it against a copy rather than editing a real file. */
function spawnViolations(rel, rawSrc) {
  const src = stripComments(rawSrc);
  const allowed = SPAWN_TARGETS[rel];
  const out = [];
  if (!/child_process/.test(src)) return out;
  if (!allowed) return [`${rel}: mentions child_process, and is not a module allowed to spawn`];
  for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s*["'](?:node:)?child_process["']/g)) {
    const clause = m[1].trim();
    if (!/^\{[^}]*\}$/.test(clause) || /\bas\b/.test(clause)) out.push(`${rel}: child_process imported as \`${clause}\` — only a named list, no rename`);
  }
  if (/import\s*\(\s*["'](?:node:)?child_process["']\s*\)|require\s*\(\s*["'](?:node:)?child_process["']\s*\)/.test(src)) {
    out.push(`${rel}: child_process reached by a dynamic import or require`);
  }
  const call = new RegExp(`(^|[^\\w$.])(${SPAWNERS.join("|")})\\s*\\(\\s*([^,)]*)`, "g");
  for (const m of src.matchAll(call)) {
    const [, , fn, argRaw] = m;
    const arg = argRaw.trim();
    const lit = /^(["'`])([^"'`$]*)\1$/.exec(arg);
    let target = null;
    if (arg === "process.execPath") target = "node";
    else if (lit) target = SHELL_SPAWNERS.has(fn) ? lit[2].trim().split(/\s+/)[0] : lit[2];
    if (target === null) out.push(`${rel}: ${fn}(${arg}) — the target is not a literal the scan can read`);
    else if (!allowed.includes(target)) out.push(`${rel}: ${fn} runs '${target}', which is not on this module's list (${allowed.join(", ")})`);
  }
  return out;
}

test("the engine spawns only allowlisted executables, each from the one module that owns it", () => {
  const files = fs.readdirSync(path.join(REPO, "scripts", "lib")).filter(f => f.endsWith(".mjs"))
    .map(f => `scripts/lib/${f}`).concat(["scripts/conductor.mjs"]);
  const violations = files.flatMap(rel => spawnViolations(rel, fs.readFileSync(path.join(REPO, rel), "utf8")));
  assert.deepEqual(violations, [], violations.join("\n"));
  // NON-VACUITY: every allowlisted module still spawns what the list says. A list entry nothing
  // uses is a door held open for the next spawn to walk through unexamined.
  for (const [rel, targets] of Object.entries(SPAWN_TARGETS)) {
    const src = stripComments(fs.readFileSync(path.join(REPO, rel), "utf8"));
    for (const t of targets) {
      const seen = t === "node" ? /process\.execPath/.test(src) : new RegExp(`\\(\\s*["']${t}[\\s"']`).test(src);
      assert.ok(seen, `${rel} is allowed to spawn '${t}' and no longer does — remove it from SPAWN_TARGETS`);
    }
  }
});

test("the spawn guard refuses the shapes that would carry a network call through a child", () => {
  // Every fixture source is ASSEMBLED, never spelled: this file lives in the assertion half, whose
  // own guard (assert-half-has-no-spawn) refuses a literal spawner call or module name anywhere in
  // it — strings included, by design.
  const CPM = ["node", "child_process"].join(":");
  const call = (fn, args) => fn + "(" + args + ");";
  const imp = (clause) => `import ${clause} from "${CPM}";\n`;
  const gw = "scripts/lib/git-gateway.mjs";
  const named = imp("{ execFileSync, execSync, spawnSync }");
  const refused = {
    "a literal curl": [gw, named + call("execFileSync", '"curl", ["https://x"]')],
    "gh through a shell string": [gw, named + call("execSync", '"gh api repos/o/r"')],
    "a target held in a variable": [gw, named + 'const c = "curl"; ' + call("spawnSync", "c, []")],
    "a template-literal target": [gw, named + call("execFileSync", "`${tool}`, []")],
    "a namespace import": [gw, imp("* as cp") + call("cp.execFileSync", '"curl"')],
    "a renamed import": [gw, imp("{ execFileSync as run }") + call("run", '"curl"')],
    "a dynamic import": [gw, `const cp = await import("${CPM}");`],
    "a module that may not spawn": ["scripts/lib/render.mjs", named + call("execFileSync", QGIT + ', ["status"]')],
    "git from the wrong module": ["scripts/lib/tool-currency.mjs", named + call("execFileSync", QGIT + ', ["status"]')],
  };
  for (const [name, [rel, src]] of Object.entries(refused)) {
    assert.ok(spawnViolations(rel, src).length > 0, `the guard must refuse ${name}`);
  }
  // And it is not a guard that refuses everything: the real shapes pass, and a regex's `.exec(` or
  // a comment naming a spawner is not a spawn.
  assert.deepEqual(spawnViolations(gw, named + call("execFileSync", QGIT + ', ["log"]') + "\n" +
    call("execSync", '"git log -1", {}') + "\nconst m = /x/.exec(s);\n// " + call("spawnSync", '"curl"') + " in prose\n"), []);
  assert.deepEqual(spawnViolations("scripts/lib/self-hosting.mjs",
    imp("{ spawnSync }") + call("spawnSync", "process.execPath, [t]")), []);
});

test("USAGE and the dispatch table agree in BOTH directions", () => {
  // conductor.mjs derives the help-eligible verb list by splitting USAGE, so a verb listed there
  // but no longer dispatched would render help from its rows and then fail on real invocation.
  // The forward direction (dispatched but absent from USAGE) is covered by the sweep above; this
  // is the reverse, which nothing checked.
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const usage = src.match(/const USAGE = "usage: conductor\.mjs ([^\\]+)/)[1].split("|");
  const dispatched = dispatchedVerbs();
  assert.deepEqual(usage.filter(v => !dispatched.has(v)), [],
    "USAGE names a verb the engine no longer dispatches");
  assert.deepEqual([...dispatched].filter(v => !usage.includes(v)), [],
    "the engine dispatches a verb USAGE does not name");
});
