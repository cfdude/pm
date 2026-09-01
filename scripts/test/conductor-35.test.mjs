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
import { tmpRepo, run, runCombined, detourLog } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  for (const m of table.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// ═══════════════ the projection ═══════════════

test("cliFlagsFor: add-many's CLI surface is --from, not its 14 batch-document keys", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  const cli = cliFlagsFor("add-many");
  assert.deepEqual(cli, ["from"],
    "add-many parses exactly one flag; its EPIC_FLAGS rows are batch STATE keys");
  // The regression this test exists for: the old projection returned 15.
  assert.ok(flagsFor("add-many").length > cli.length,
    "flagsFor must still answer the ALLOWLIST question — this test is about not reusing it for help");
});

test("cliFlagsFor: a normal verb is unchanged by the batch carve-out", async () => {
  const { cliFlagsFor, flagsFor } = await import(CONSTANTS);
  for (const verb of ["update-epic", "add-epic", "set-tracker", "purge-logs", "release"]) {
    assert.deepEqual(cliFlagsFor(verb).sort(), flagsFor(verb).sort(),
      `${verb} is not a batch-key command; its CLI surface is its whole registry surface`);
  }
});

test("every batch-key command is a real dispatched verb", async () => {
  const { BATCH_KEY_COMMANDS } = await import(CONSTANTS);
  const dispatched = dispatchedVerbs();
  for (const c of BATCH_KEY_COMMANDS) {
    assert.ok(dispatched.has(c), `BATCH_KEY_COMMANDS names '${c}', which the engine does not dispatch`);
  }
});

// ═══════════════ the rendered help ═══════════════

test("<verb> --help prints THAT verb's flags, not the global usage line", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["update-epic", "--help"], { cwd });
  assert.match(out, /update-epic/);
  for (const flag of ["--outcome", "--no-deferrals", "--attribute-commit", "--description"]) {
    assert.ok(out.includes(flag), `update-epic --help must list ${flag}`);
  }
  assert.ok(!out.includes("init|render|brief"),
    "a verb-scoped --help must NOT fall back to the global 48-verb usage blob");
});

test("--help still answers globally when no verb is named", () => {
  const cwd = tmpRepo();
  const out = run(["--help"], { cwd });
  assert.ok(out.includes("init|render|brief"), "bare --help keeps the global usage line");
});

test("help declares a flagless verb explicitly rather than printing an empty list", async () => {
  const { FLAGLESS_VERBS } = await import(CONSTANTS);
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const verb of ["integrity", "snapshot", "set-active"]) {
    assert.ok(FLAGLESS_VERBS.includes(verb), `fixture assumes ${verb} is flagless`);
    const out = run([verb, "--help"], { cwd });
    assert.match(out, /takes no flags/i,
      `${verb} --help must SAY it takes none — an empty list reads as "nobody declared this yet"`);
  }
});

test("add-many --help does not advertise the 14 flags its parser ignores", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["add-many", "--help"], { cwd });
  assert.ok(out.includes("--from"), "add-many's one real flag");
  for (const ghost of ["--external-id", "--priority", "--lane", "--add-story"]) {
    assert.ok(!out.includes(ghost),
      `add-many --help must not advertise ${ghost}; the parser refuses it`);
  }
});

test("help marks valueless and repeatable flags so a reader can invoke them correctly", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["update-epic", "--help"], { cwd });
  const line = (f) => out.split("\n").find(l => l.includes(f)) || "";
  assert.match(line("--no-deferrals"), /no value/i, "--no-deferrals takes no value");
  assert.match(line("--attribute-commit"), /repeatable/i, "--attribute-commit is repeatable");
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

test("help still has NO side effect — the #158 short-circuit's original reason", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["log-detour", "--help"], { cwd });
  assert.ok(!detourLog(cwd).includes("--help"),
    "`log-detour --help` must never write a detour entry — the bug the short-circuit fixed");
});

test("help works before /pm:init — an uninitialized repo is exactly where you need it", () => {
  const cwd = tmpRepo();
  const out = run(["update-epic", "--help"], { cwd });
  assert.ok(out.includes("--outcome"), "help must not require an initialized repo");
});

// ═══════════════ the emitted pointer ═══════════════

const POINTER_PATTERNS = [
  [/--help/, "the local, version-exact channel"],
  [/pm-plugin\.dev\/llms\.txt/, "the docs index"],
  [/pm-plugin\.dev\/mcp/, "the no-auth MCP"],
  [/conductor\.mjs/, "the engine binary the reader must invoke"],
];

test("the emitted rules block routes a reader to help, on every platform", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const platform of ["claude-code", "hermes", "codex"]) {
    const out = run(["rules", "--platform", platform], { cwd });
    for (const [re, what] of POINTER_PATTERNS) {
      assert.match(out, re, `${platform}: rules block must point at ${what}`);
    }
  }
});

test("the pointer inoculates against version skew, naming THIS repo's version", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const version = JSON.parse(
    fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8")).version;
  const out = run(["rules"], { cwd });
  assert.ok(out.includes(version),
    "the pointer must name the version THIS repo runs, or the skew warning is abstract");
  assert.match(out, /latest/i, "it must say the site documents the latest release");
});

test("the pointer never cites llms-full.txt", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.ok(!out.includes("llms-full"),
    "llms-full.txt is 367KB — citing it hands the reader a context bomb");
});

test("the emitted pointer stays small — it is paid for in every session of every repo", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  const start = out.split("\n").findIndex(l => /getting help/i.test(l));
  assert.notEqual(start, -1, "the pointer must be a findable section");
  const section = out.split("\n").slice(start).findIndex((l, i) => i > 0 && /^#{1,4} /.test(l));
  const lines = section === -1 ? out.split("\n").length - start : section;
  assert.ok(lines <= 12, `the help pointer is ${lines} lines; budget is 12`);
});

test("the engine still opens no network connection — the pointer is an INSTRUCTION", () => {
  const engineSrc = fs.readdirSync(path.join(REPO, "scripts", "lib"))
    .filter(f => f.endsWith(".mjs"))
    .map(f => fs.readFileSync(path.join(REPO, "scripts", "lib", f), "utf8")).join("\n")
    + fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  for (const forbidden of [/\bfetch\s*\(/, /node:https?\b/, /require\(['"]https?['"]\)/]) {
    assert.ok(!forbidden.test(engineSrc),
      `the engine must never open a connection (matched ${forbidden}) — pm is an instruction layer`);
  }
});
